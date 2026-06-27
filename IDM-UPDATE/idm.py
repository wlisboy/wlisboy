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
    print("最新版本:", version)


def cmd_list(null, full):
    print("Download List (--list)")
    print("-" * 40)
    print("web版下载地址:", null)
    print("full版下载地址:", full)


def cmd_best(null_mirror, full_mirror):
    print("Best Mirrors (--best)")
    print("-" * 40)
    print("web版加速下载地址:", null_mirror)
    print("full版加速下载地址:", full_mirror)


def main():
    parser = argparse.ArgumentParser(description="IDM CLI Helper")

    parser.add_argument("--info", action="store_true", help="获取版本信息")
    parser.add_argument("--list", action="store_true", help="列出默认下载地址")
    parser.add_argument("--best", action="store_true", help="列出加速下载地址")

    args = parser.parse_args()
    
    if not any(vars(args).values()):
        parser.print_help()
        return

    try:
        version = get_latest_version()
    except Exception as e:
        print("获取失败:", e)
        return

    if not version:
        print("无法获取版本")
        return

    null, null_mirror, full, full_mirror = build_links(version)

    if args.info or (not args.list and not args.best):
        cmd_info(version)

    if args.list:
        cmd_list(null, full)

    if args.best:
        cmd_best(null_mirror, full_mirror)


if __name__ == "__main__":
    main()