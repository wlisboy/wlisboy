import base64
import re
import requests
import subprocess
import argparse

_ID_KEY = "Mm9kbGtzTVNMUEZOVzg0NTAza3N1OTl2bnd1ZAo="


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

    null = f"https://download.internetdownloadmanager.com/download/idman{v_link}.exe"
    null_mirror = f"https://mirror2.internetdownloadmanager.com/download/idman{v_link}.exe"
    full = f"https://download.internetdownloadmanager.com/commerce/{_id}/idman{v_link}f.exe"
    full_mirror = f"https://mirror2.internetdownloadmanager.com/commerce/{_id}/idman{v_link}f.exe"

    return null, null_mirror, full, full_mirror


def cmd_info(version):
    print("版本信息:", version)


def cmd_list(null, full):
    print("默认下载地址")
    print("-" * 40)
    print("web版下载地址:", null)
    print("full版下载地址:", full)


def cmd_best(null_mirror, full_mirror):
    print("加速下载地址")
    print("-" * 40)
    print("web版加速下载地址:", null_mirror)
    print("full版加速下载地址:", full_mirror)


def main():
    parser = argparse.ArgumentParser(description="IDM CLI Helper")

    parser.add_argument("-v", "-version", type=str, nargs="+", default=None, help="指定版本号，如 6.42 Build 64，可前往 https://www.internetdownloadmanager.com/news.html 获取版本号")
    parser.add_argument("-i", "-info", action="store_true", help="获取版本信息")
    parser.add_argument("-l", "-list", action="store_true", help="列出默认下载地址")
    parser.add_argument("-b", "-best", action="store_true", help="列出加速下载地址")

    args = parser.parse_args()

    # 没有任何参数时显示帮助
    if not any([args.v, args.i, args.l, args.b]):
        parser.print_help()
        return

    # 解析版本号
    if args.v:
        version = " ".join(args.v)
    else:
        try:
            version = get_latest_version()
        except Exception as e:
            print("获取失败:", e)
            return

    if not version:
        print("无法获取版本")
        return

    null, null_mirror, full, full_mirror = build_links(version)

    # 默认行为：无 -l -b 时显示版本信息
    if args.i or (not args.l and not args.b):
        cmd_info(version)

    if args.l:
        cmd_list(null, full)

    if args.b:
        cmd_best(null_mirror, full_mirror)


if __name__ == "__main__":
    main()
