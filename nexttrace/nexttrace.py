import sys
import os
import re
import csv
import argparse
import subprocess

# 校验 nexttrace.exe 所在目录
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# nexttrace 单次探测超时（秒），防止个别 IP 静默丢包导致任务卡死
TRACE_TIMEOUT = 120

# 允许的输入文件后缀
INPUT_ALLOWED_EXTS = (".txt",)
# 允许的输出文件后缀
OUTPUT_ALLOWED_EXTS = (".csv", ".txt")

# CSV 表头常量
CSV_HEADERS = ["IP/域名", "归属运营商", "线路类型", "判定依据", "经过的所有AS号"]

# 精品线路判定规则表：(运营商, 线路类型, 判定依据, 特征 ASN 列表)
ROUTE_RULES = [
    ("中国电信", "CN2 GIA/GT", "检测到 AS4809", ["AS4809"]),
    ("中国电信", "CN2", "检测到 AS4812", ["AS4812"]),
    ("中国联通", "CUII（A网）", "检测到 AS9929", ["AS9929"]),
    ("中国移动", "CMIN2", "检测到 AS58807", ["AS58807"]),
    ("中国移动", "CMI", "检测到 AS58453", ["AS58453"]),
]


def resolve_nexttrace_path():
    """返回脚本同级目录下的 nexttrace.exe 路径"""
    local_exe = os.path.join(SCRIPT_DIR, "nexttrace.exe")
    if os.path.isfile(local_exe):
        return local_exe

    # 获取 nexttrace.exe
    print("[-] 未在脚本同级目录下找到 nexttrace.exe")
    print("[-] 请访问 https://github.com/nxtrace/NTrace-core/releases/latest 下载最新版本，")
    print(f"[-] 将 nexttrace.exe 放入脚本同级目录后重试: {SCRIPT_DIR}")
    sys.exit(1)


def run_nexttrace(exe_path, ip):
    """调用 nexttrace 命令获取路由追踪结果

    批量模式通过 -q 1 每跳仅发 1 个包，成倍缩短多目标测试等待耗时。
    """
    cmd = [exe_path, "-C", "-g", "cn", "-q", "1", ip]
    result = subprocess.run(cmd, capture_output=True, timeout=TRACE_TIMEOUT,
                            text=True, encoding="utf-8", errors="ignore")
    return result.stdout


def analyze_route(output_text):
    """解析 nexttrace 返回的文本，判定运营商及线路级别"""
    text = output_text.upper()

    # 按路由跳顺序提取出现过的所有 AS 号并去重
    asn_list = list(dict.fromkeys(re.findall(r'AS\d+', text)))
    asn_str = "/".join(asn_list) if asn_list else "未知"

    # 命中规则按 ASN 集合匹配（set 成员判断 O(1)）
    asn_set = set(asn_list)
    matched = [(isp, line_type, reason)
               for isp, line_type, reason, keywords in ROUTE_RULES
               if any(kw in asn_set for kw in keywords)]

    if matched:
        return ("/".join(dict.fromkeys(m[0] for m in matched)),
                " / ".join(dict.fromkeys(m[1] for m in matched)),
                "；".join(dict.fromkeys(m[2] for m in matched)),
                asn_str)

    return "非精品线路", "普通线路/骨干网", "路由未检测到相关 ASN 特征", asn_str


def parse_candidate_from_line(line):
    """从输入行解析出候选目标（去注释、去空行、取首个字段）"""
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    # 去掉行内注释，取首个字段作为目标
    return line.split("#")[0].split()[0]


class ResultWriter:
    """按输出文件后缀切换写出格式的统一结果写出器

    - .csv：标准 CSV（utf-8-sig，适配 Windows Excel）
    - .txt：制表符分隔的纯文本表格（utf-8）
    """

    def __init__(self, output_path):
        self.is_csv = os.path.splitext(output_path)[1].lower() == ".csv"
        # CSV 用 utf-8-sig 防 Excel 乱码；txt 用 utf-8 即可
        encoding = "utf-8-sig" if self.is_csv else "utf-8"
        self._fh = open(output_path, 'w', newline='', encoding=encoding)
        if self.is_csv:
            self._csv = csv.writer(self._fh, delimiter=',')
            self._csv.writerow(CSV_HEADERS)
        else:
            # 纯文本表头：制表符分隔，便于直接阅读
            self._fh.write("\t".join(CSV_HEADERS) + "\n")

    def write_row(self, target, isp, line_type, reason, asns):
        """控制输出为行"""
        row = [target, isp, line_type, reason, asns]
        if self.is_csv:
            self._csv.writerow(row)
        else:
            self._fh.write("\t".join(row) + "\n")

    def flush(self):
        """实时写入"""
        self._fh.flush()

    def close(self):
        self._fh.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()
        return False


def check_extension(path, allowed_exts, label):
    """校验文件后缀，合法返回 None，否则返回错误提示字符串"""
    ext = os.path.splitext(path)[1].lower()
    if ext not in allowed_exts:
        return f"[-] 错误: 文件后缀格式错误 ({label}需为 {'/'.join(allowed_exts)}): '{path}'"
    return None


def test_batch_ips(exe_path, file_path, output_path):
    """批量从文件读取 IP或域名并按 -o 后缀导出为 CSV 或 TXT"""
    if not os.path.exists(file_path):
        print(f"[-] 错误: 找不到输入文件 '{file_path}'")
        sys.exit(1)

    # 提取目标列表（去注释/空行后取首字段）
    with open(file_path, 'r', encoding='utf-8') as f:
        targets = [c for c in (parse_candidate_from_line(line) for line in f) if c]

    if not targets:
        print(f"[-] 提示: 文件 '{file_path}' 中未读取到有效ip或域名")
        sys.exit(1)

    print(f"[+] 成功加载 {len(targets)} 个目标，开始批量测试...")
    print(f"[+] 结果将保存至: {output_path}")
    print("-" * 60)

    try:
        # 按输出后缀自动选择 CSV / TXT 格式
        with ResultWriter(output_path) as writer:
            for index, target in enumerate(targets, 1):
                print(f"[{index}/{len(targets)}] IP: {target} ... ", end="", flush=True)

                try:
                    output_text = run_nexttrace(exe_path, target)
                    isp, line_type, reason, asns = analyze_route(output_text)
                    writer.write_row(target, isp, line_type, reason, asns)
                    print(f"【{isp} -> {line_type}】")
                except subprocess.TimeoutExpired:
                    writer.write_row(target, "测试超时", "未知", f"探测超过 {TRACE_TIMEOUT} 秒", "")
                    print(f"超时跳过 (>{TRACE_TIMEOUT}s)")
                except Exception as e:
                    writer.write_row(target, "测试异常", "未知", str(e), "")
                    print(f"异常失败 (原因: {str(e)})")

                writer.flush()  # 实时写入

    except OSError:
        print(f"[-] 错误: 无法写入文件 '{output_path}'，请检查文件是否被打开或占用")
        sys.exit(1)

    print("-" * 60)
    print(f"[+] 批量测试完成，结果已生成: {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="NextTrace 线路批量智能测试与精品网判定工具 (基于 NTrace-core 核心)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""使用示例（支持 .csv 与 .txt 两种格式）:
        python nexttrace.py -f ip_list.txt -o report.csv
        python nexttrace.py -f ip_list.txt -o report.txt
        """
    )

    parser.add_argument("-f", "--file", help="存放待测试 IP 列表的文本文件路径 (.txt)")
    parser.add_argument("-o", "--output", help="导出的报表文件路径 (.csv 或 .txt)")

    args = parser.parse_args()

    if not args.file:
        # 未提供输入文件，打印 Help
        parser.print_help()
        return

    # 批量测试模式必须提供 -o 输出路径
    if not args.output:
        print("[-] 错误: 在批量测试模式下 (-f)，您必须通过 -o 参数提供输出文件路径 (.csv 或 .txt)")
        sys.exit(1)

    # 校验输入/输出文件后缀格式
    errors = [
        err for err in (check_extension(args.file, INPUT_ALLOWED_EXTS, "输入文件"),
                        check_extension(args.output, OUTPUT_ALLOWED_EXTS, "输出文件"))
        if err
    ]
    if errors:
        for err in errors:
            print(err)
        sys.exit(1)

    # 校验输入/输出文件同名检测
    in_stem = os.path.splitext(os.path.normcase(os.path.abspath(args.file)))[0]
    out_stem = os.path.splitext(os.path.normcase(os.path.abspath(args.output)))[0]
    if in_stem == out_stem:
        print(f"[-] 错误: 输出文件与输入文件重名，请更换输出文件名称 (输入: '{args.file}'，输出: '{args.output}')")
        sys.exit(1)

    exe_path = resolve_nexttrace_path()  # 确认 nexttrace.exe 可用
    test_batch_ips(exe_path, args.file, args.output)


if __name__ == "__main__":
    main()
