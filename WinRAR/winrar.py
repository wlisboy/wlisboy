import argparse
import re
import sys
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from urllib.parse import urljoin

RARNEW_URL = "https://www.rarlab.com/rarnew.htm"
DOWNLOAD_URL = "https://www.rarlab.com/download.htm"
MIN_VERSION = 7.20


def fetch(url: str) -> str:
# UA建议从：https://tool.ip138.com/useragent 获取
    req = Request(url, headers={"User-Agent": "UA"})
    with urlopen(req, timeout=15) as r:
        return r.read().decode("utf-8", errors="ignore")


def get_latest_version() -> str:
    html = fetch(RARNEW_URL)
    m = re.search(r"\bVersion\s+(\d+\.\d+)\b", html)
    if not m:
        raise RuntimeError("未能从官网页面识别 Version 版本号")
    return m.group(1)


def version_to_num(version: str) -> str:
    # 7.20 -> 720, 7.22 -> 722
    try:
        major, minor = version.split(".", 1)
        return f"{int(major)}{int(minor):02d}"
    except ValueError as e:
        raise ValueError(f"版本号格式错误: {version}") from e


def parse_version(version: str) -> tuple[int, int]:
    try:
        major, minor = version.split(".", 1)
        return int(major), int(minor)
    except ValueError as e:
        raise ValueError(f"版本号格式错误: {version}") from e


def get_cn_url_from_download_page() -> str:
    html = fetch(DOWNLOAD_URL)
    m = re.search(
        r'<a\s+href=["\']?([^"\'>\s]+\.exe)["\']?[^>]*>\s*(?:<[^>]+>)*\s*Chinese\s+Simplified',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if not m:
        raise RuntimeError("未能从 download.htm 识别 Chinese Simplified 下载地址")

    url = m.group(1)
    if url.startswith("http"):
        return url
    return urljoin(DOWNLOAD_URL, url)


def extract_version_from_url(url: str) -> str | None:
    m = re.search(r"winrar-x64-(\d+)sc\.exe", url, re.IGNORECASE)
    if not m:
        return None
    num = m.group(1)
    if len(num) < 2:
        return None
    major = num[:-2] or "0"
    return f"{int(major)}.{int(num[-2:]):02d}"


def best_cn_urls(version: str) -> list[str]:
    num = version_to_num(version)
    return [
        f"https://www.win-rar.com/fileadmin/winrar-versions/winrar/winrar-x64-{num}sc.exe",
        f"https://www.win-rar.com/fileadmin/winrar-versions/winrar-x64-{num}sc.exe",
    ]


def main():
    parser = argparse.ArgumentParser(description="查询 WinRAR 最新中文版下载地址")

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("-i", "--info", action="store_true", help="输出最新 Version 版本号")
    group.add_argument("-l", "--latest", action="store_true", help="输出 RARLAB 官网中文版下载地址")
    group.add_argument("-b", "--best", action="store_true", help="输出商业中文版下载地址")

    parser.add_argument(
        "-v", "--version", dest="ver", metavar="VERSION",
        help="指定历史版本（如 7.20），需与 -l 或 -b 搭配使用，>=7.20",
    )

    args = parser.parse_args()

    if args.ver and args.info:
        parser.error("参数 --version 不能与 --info 一起使用")

    try:
        if args.info:
            version = get_latest_version()
            print(f"Version {version}")
            return

        if args.ver:
            version = args.ver
            major, minor = parse_version(version)
            if major < 7 or (major == 7 and minor < 20):
                parser.error(f"指定版本必须 >= {MIN_VERSION}，当前: {version}")
        else:
            cn_url = get_cn_url_from_download_page()
            version = extract_version_from_url(cn_url)
            if not version:
                raise RuntimeError("未能从 Chinese Simplified 下载链接提取版本号")

        if args.latest:
            print(get_cn_url_from_download_page())
        elif args.best:
            for url in best_cn_urls(version):
                print(url)

    except (URLError, HTTPError, RuntimeError, ValueError) as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
