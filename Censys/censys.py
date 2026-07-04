import os
import sys
import json
import argparse

def find_ips(data):
    """递归查找所有 key 字段的值（IP地址）"""
    ips = []
    if isinstance(data, dict):
        for k, v in data.items():
            if k == "key":
                ips.append(v)
            else:
                ips.extend(find_ips(v))
    elif isinstance(data, list):
        for item in data:
            ips.extend(find_ips(item))
    return ips

def process_file(filepath, port=None):
    """处理单个文件，返回提取到的 IP 列表"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError:
        print(f"错误: '{filepath}' 不是合法的 JSON 格式。")
        return []
    except Exception as e:
        print(f"读取出错 '{filepath}': {e}")
        return []

    ips = find_ips(data)
    if port:
        return [f"{ip}:{port}" for ip in ips]
    return ips

def main():
    parser = argparse.ArgumentParser(description='从 JSON 中提取 IP 并导出')
    parser.add_argument('-f', '--file', help='导入需要处理的 JSON 文件')
    parser.add_argument('-o', '--output', help='导出处理好的文件 (支持 .csv 和 .txt)')
    parser.add_argument('-p', '--port', type=int, help='指定端口，输出格式为 ip:port')

    args = parser.parse_args()

    # 获取要处理的文件列表
    if args.file:
        if not os.path.exists(args.file):
            print(f"错误: 文件 '{args.file}' 不存在。")
            sys.exit(1)
        files = [args.file]
    else:
        print("错误: 请使用 -f 指定需要处理的 JSON 文件。")
        sys.exit(1)

    # 处理所有文件并收集结果
    all_results = []
    for filename in files:
        if not args.output:
            print(f"--- 文件: {filename} ---")
        results = process_file(filename, args.port)
        all_results.extend(results)

    if args.output:
        try:
            with open(args.output, 'w', encoding='utf-8') as f:
                if args.output.lower().endswith('.csv'):
                    f.write("ip\n")
                    for line in all_results:
                        f.write(f"{line}\n")
                else:
                    for line in all_results:
                        f.write(f"{line}\n")
            print(f"结果已保存到: {args.output} (共 {len(all_results)} 条)")
        except Exception as e:
            print(f"写入文件出错: {e}")
            sys.exit(1)
    else:
        for line in all_results:
            print(line)

if __name__ == "__main__":
    main()
