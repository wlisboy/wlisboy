import base64
import re
import sys
import requests
import argparse

_ID_KEY = "Mm9kbGtzTVNMUEZOVzg0NTAza3N1OTl2bnd1ZAo="


class _HelpParser(argparse.ArgumentParser):
    def error(self, message):
        message = message.replace("not allowed with argument", "不允许与参数同时使用").replace("expected one argument", "仅允许一个参数使用")
        self.exit(2, f"\n错误: {message}\n")


def get_latest_version():
    url = "https://www.internetdownloadmanager.com/news.html"
    r = requests.get(url, timeout=10)
    r.raise_for_status()

    html = r.text

    match = re.search(r"version\s+(\d+\.\d+)\s+build\s+(\d+)", html, re.I)

    if not match:
        return None

    return f"{match.group(1)} build {match.group(2)}"


def build_links(version):
    if not version:
        return None, None, None, None

    nums = re.findall(r"\d+", version)
    if len(nums) < 3:
        return None, None, None, None

    v_link = f"{nums[0]}{nums[1]}build{nums[2]}"

    _id = base64.b64decode(_ID_KEY).decode().strip()

    web_url = f"https://download.internetdownloadmanager.com/download/idman{v_link}.exe"
    web_url_mirror = f"https://mirror2.internetdownloadmanager.com/download/idman{v_link}.exe"
    full = f"https://download.internetdownloadmanager.com/commerce/{_id}/idman{v_link}f.exe"
    full_mirror = f"https://mirror2.internetdownloadmanager.com/commerce/{_id}/idman{v_link}f.exe"

    return web_url, web_url_mirror, full, full_mirror


def cmd_info(version):
    print("最新版本号:", version)


def cmd_list(web_url, full):
    print("web版:", web_url)
    print("full版:", full)


def cmd_best(web_url_mirror, full_mirror):
    print("web版:", web_url_mirror)
    print("full版:", full_mirror)


def main():
    args_raw = sys.argv[1:]
    processed = []
    hist_ver = None
    i = 0
    while i < len(args_raw):
        if args_raw[i] in ("-v", "--version"):
            if i + 1 < len(args_raw):
                i += 1
                parts = []
                while i < len(args_raw) and not args_raw[i].startswith("-"):
                    parts.append(args_raw[i])
                    i += 1
                if parts:
                    hist_ver = " ".join(parts)
                else:
                    processed.append("-i")
            else:
                processed.append("-i")
                i += 1
        else:
            processed.append(args_raw[i])
            i += 1

    if hist_ver:
        processed += ["--hist-ver", hist_ver]
        if any(x in args_raw for x in ("-h", "--help", "-i", "--info")):
            print("错误: -v 带版本号时只允许与 -l 或 -b 配合使用")
            return

    parser = _HelpParser(
        description="运行参数",
        formatter_class=argparse.RawTextHelpFormatter,
        add_help=False,
        conflict_handler="resolve",
    )

    parser.add_argument("-v", "--version", action="store_true",
                        help="指定版本号与 -l 或 -b 配合使用,\n"
                             "如 -v 6.42 Build 64 -l 或 -v 6.42 Build 64 -b,\n"
                             "可前往 https://www.internetdownloadmanager.com/news.html 获取版本号")

    parser.add_argument("--hist-ver", type=str, help=argparse.SUPPRESS)

    group = parser.add_mutually_exclusive_group()
    group.add_argument("-h", "--help", action="help", help="显示帮助信息")
    group.add_argument("-i", "--info", action="store_true", help="查询最新版本号")
    group.add_argument("-l", "--list", action="store_true", help="列出默认下载地址")
    group.add_argument("-b", "--best", action="store_true", help="列出加速下载地址")

    args = parser.parse_args(processed)

    if hist_ver and not args.list and not args.best:
        args.info = True
        hist_ver = None

    if args.version and not hist_ver:
        args.info = True

    if not any([args.version, args.info, args.list, args.best, hist_ver]):
        parser.print_help()
        return

    if hist_ver:
        version = hist_ver
    else:
        try:
            version = get_latest_version()
        except Exception as e:
            print("获取失败:", e)
            return

    if not version:
        print("无法获取版本")
        return

    web_url, web_url_mirror, full, full_mirror = build_links(version)

    if args.info:
        cmd_info(version)
    elif args.list:
        cmd_list(web_url, full)
    elif args.best:
        cmd_best(web_url_mirror, full_mirror)
    else:
        cmd_info(version)


if __name__ == "__main__":
    main()
