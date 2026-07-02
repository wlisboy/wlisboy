import argparse
import csv
import sys
from datetime import datetime
from dateutil import parser
import requests
import urllib3

# 禁用 verify=False 触发的 InsecureRequestWarning 警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def fetch_announced_prefixes(asn):
    """从 RIPE Stat API 获取指定 ASN"""
    url = "https://stat.ripe.net/data/announced-prefixes/data.json"
    params = {
        "resource": f"AS{asn}",
        "starttime": "1970-01-01T00:00",
    }

    print(f"[*] 正在从 RIPE Stat 获取 AS{asn} 的原始数据...\n")
    headers = {
    # UA建议从：https://tool.ip138.com/useragent 获取
        "User-Agent": "UA",
    }

    try:
        # verify=False 用于兼容本地过旧的 OpenSSL 库
        response = requests.get(
            url, params=params, headers=headers, timeout=20, verify=False
        )
        response.raise_for_status()
        data = response.json()
        prefixes = data.get("data", {}).get("prefixes", [])
        print(f"[+] 成功获取到 {len(prefixes)} 条原始记录。")
        return prefixes
    except Exception as e:
        print(f"[-] 获取数据失败: {e}")
        return []


def filter_by_ip_version(prefixes, ip_version):
    """根据 IP 版本过滤 prefix（IPv4 用 '.'，IPv6 用 ':'）"""
    if ip_version == 4:
        return [p for p in prefixes if ":" not in p.get("prefix", "")]
    elif ip_version == 6:
        return [p for p in prefixes if ":" in p.get("prefix", "")]
    return prefixes


def process_prefixes(prefixes, filter_date=None):
    """处理、过滤并按 Last Seen 降序排序"""
    valid_records = []

    for item in prefixes:
        prefix = item.get("prefix")
        timelines = item.get("timelines", [])

        if not timelines or not prefix:
            continue

        try:
            last_segment = timelines[-1]
            last_seen_str = last_segment.get("endtime")
            last_seen_dt = parser.isoparse(last_seen_str)
        except Exception:
            continue

        # 过滤方式：只要路由的最后活跃日期 >= 用户输入的过滤日期，即保留
        if filter_date and last_seen_dt.date() < filter_date.date():
            continue

        valid_records.append(
            {
                "prefix": prefix,
                "last_seen_dt": last_seen_dt,
                "last_seen_str": last_seen_str,
            }
        )

    return sorted(valid_records, key=lambda x: x["last_seen_dt"], reverse=True)


def parse_user_date(time_str):
    """解析用户输入的日期字符串，统一转化为纯日期对象"""
    if not time_str:
        return None

    try:
        # 自动识别 20260701 或 2026-07-01
        dt = parser.parse(time_str)
        return dt
    except Exception:
        print(f"[-] 错误: 无法解析的日期格式 '{time_str}'，请使用如 20260701 的格式。")
        sys.exit(1)


def save_to_csv(records, filename):
    """将过滤结果持久化写入到本地 CSV 文件"""
    try:
        with open(filename, mode="w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["Prefix", "Last Seen (UTC)"])
            for row in records:
                writer.writerow([row["prefix"], row["last_seen_str"]])
        print(f"[+] {len(records)} 条结果将保存至文件: {filename}")
        return True
    except Exception as e:
        print(f"[-] 保存 CSV 文件失败: {e}")
        return False


if __name__ == "__main__":
    arg_parser = argparse.ArgumentParser(description="RIPE Stat ASN Prefix 查询与过滤工具")
    
    arg_parser.add_argument("-a", "--asn", required=True, type=int, metavar="", help="目标自治系统号 (ASN)")
    group = arg_parser.add_mutually_exclusive_group()
    group.add_argument("-4", "--ipv4", action="store_true", default=False, help="仅获取 IPv4 Prefix")
    group.add_argument("-6", "--ipv6", action="store_true", default=False, help="仅获取 IPv6 Prefix")
    arg_parser.add_argument("-t", "--time", type=str, default=None, metavar="", help="过滤的起始日期 (例如: 20260701)")
    arg_parser.add_argument("-o", "--output", type=str, default=None, metavar="", help="输出本地 CSV 的文件名 (例如: result.csv)")

    args = arg_parser.parse_args()

    if (args.ipv4 or args.ipv6) and not args.time:
        arg_parser.error("指定 -4/-6 时必须同时使用 -t 指定时间过滤 (例如: -4 -t 20260701)")

    target_date = parse_user_date(args.time)
    
    raw_prefixes = fetch_announced_prefixes(args.asn)

    if raw_prefixes:
        # 根据 -4/-6 参数过滤 IP 版本
        ip_version = 4 if args.ipv4 else (6 if args.ipv6 else None)
        if ip_version:
            raw_prefixes = filter_by_ip_version(raw_prefixes, ip_version)
            print(f"[*] 已过滤为仅 IPv{ip_version}，剩余 {len(raw_prefixes)} 条记录。")

        result = process_prefixes(raw_prefixes, target_date)
    else:
        result = []

    print(f"[+] 满足时间过滤条件并排序后的 Prefix 数量: {len(result)}")
    if not result:
        print("[*] 未找到符合指定日期过滤条件的记录。")

    # 指定 -o 时始终写入文件（结果为空也会生成空文件，同名文件自动覆盖）
    if args.output:
        save_to_csv(result, args.output)
        print("")

    # 控制台预览前 50 条数据
    if result:
        print(f"{'Prefix':<25} | {'Last Seen (UTC)':<25}")
        print("-" * 60)
        for row in result[:50]:
            print(f"{row['prefix']:<25} | {row['last_seen_str']:<25}")

        if len(result) > 50:
            print(f"\n... 还有 {len(result) - 50} 条记录未列出;若指定 -o 参数已全部写入 CSV 文件")
