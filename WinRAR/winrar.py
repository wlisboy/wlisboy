import argparse
import re
import ssl
import sys
import time
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

RARNEW_URL = "https://www.rarlab.com/rarnew.htm"
DOWNLOAD_URL = "https://www.rarlab.com/download.htm"
MIN_VERSION = 7.20
MAX_RETRIES = 3

HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
}

def make_contexts() -> list[ssl.SSLContext]:
    default = ssl.create_default_context()
    tls12 = ssl.create_default_context()
    tls12.minimum_version = ssl.TLSVersion.TLSv1_2
    tls12.maximum_version = ssl.TLSVersion.TLSv1_2
    return [default, tls12]


CONTEXTS = make_contexts()


class HelpFormatter(argparse.HelpFormatter):
    def _format_action_invocation(self, action):
        if action.dest == "version":
            return ", ".join(action.option_strings)
        return super()._format_action_invocation(action)


class DownloadLinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.href = None
        self.current_href = None
        self.current_text = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.current_href = dict(attrs).get("href")
            self.current_text = []

    def handle_data(self, data):
        if self.current_href:
            self.current_text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self.current_href:
            if "Chinese Simplified" in " ".join(self.current_text):
                self.href = self.current_href
            self.current_href = None


def fetch(url: str) -> str:
    req = Request(url, headers=HEADERS)
    last_error = None

    for attempt in range(MAX_RETRIES):
        for context in CONTEXTS:
            try:
                with urlopen(req, timeout=20, context=context) as r:
                    return r.read().decode("utf-8", errors="ignore")
            except (HTTPError, URLError, TimeoutError) as error:
                last_error = error
        if attempt < MAX_RETRIES - 1:
            time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"请求失败: {last_error}") from last_error


def get_latest_version() -> str:
    html = fetch(RARNEW_URL)
    m = re.search(r"\bVersion\s+(\d+\.\d+)\b", html)
    if not m:
        raise RuntimeError("未获取到版本号")
    return m.group(1)


def version_to_num(version: str) -> str:
    major, minor = map(int, version.split(".", 1))
    return f"{major}{minor:02d}"


def parse_version(version: str) -> tuple[int, int]:
    parts = version.split(".", 1)
    if len(parts) != 2:
        raise ValueError("版本号格式错误，应为 X.Y 格式")
    return int(parts[0]), int(parts[1])


def get_cn_url_from_download_page() -> str:
    html = fetch(DOWNLOAD_URL)
    parser = DownloadLinkParser()
    parser.feed(html)
    if not parser.href:
        raise RuntimeError("获取下载链接失败")

    return urljoin(DOWNLOAD_URL, parser.href)


def extract_version_from_url(url: str) -> str | None:
    m = re.search(r"winrar-x64-(\d+)sc\.exe", url, re.IGNORECASE)
    if not m:
        return None
    num = m.group(1)
    if len(num) < 3:
        return None
    major = num[:-2] or "0"
    return f"{int(major)}.{int(num[-2:]):02d}"


def replace_version_in_url(url: str, version: str) -> str:
    target, count = re.subn(
        r"(winrar-x64-)\d+(sc\.exe)",
        rf"\g<1>{version_to_num(version)}\g<2>",
        url,
        count=1,
        flags=re.IGNORECASE,
    )
    if not count:
        raise RuntimeError("版本号替换失败")
    return target


def get_response_status(url: str) -> int | None:
    request = Request(url, headers=HEADERS, method="HEAD")
    for attempt in range(2):
        for context in CONTEXTS:
            try:
                with urlopen(request, timeout=20, context=context) as r:
                    return r.status
            except HTTPError as error:
                if error.code == 404 and attempt == 0:
                    break
                return error.code
            except (URLError, TimeoutError):
                continue
        else:
            return None

    return None


def print_download_result(url: str) -> None:
    status = get_response_status(url)
    if status == 200:
        print(url)
    elif status == 403:
        print("未找到")


def main():
    parser = argparse.ArgumentParser(
        description="WinRAR 查询与下载工具",
        formatter_class=HelpFormatter,
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("-i", "--info", action="store_true", help="查询最新版本")
    group.add_argument("-l", "--latest", action="store_true", help="获取官方简体中文版下载地址")
    group.add_argument("-b", "--best", action="store_true", help="获取商业简体中文版下载地址")
    parser.add_argument("-v", "--version", metavar="VERSION", help="指定历史版本（如 7.20），需与 -l 或 -b 搭配使用，>=7.20")

    args = parser.parse_args()

    if args.version and not (args.latest or args.best):
        parser.error("-v 只能与 -l 或 -b 一起使用")

    try:
        if args.version:
            major, minor = parse_version(args.version)
            if major < 7 or (major == 7 and minor < 20):
                parser.error(f"版本必须 >= {MIN_VERSION}，当前: {args.version}")

        if args.info:
            print(f"Version {get_latest_version()}")
        elif args.latest:
            cn_url = get_cn_url_from_download_page()
            target_url = replace_version_in_url(cn_url, args.version) if args.version else cn_url
            print_download_result(target_url)
        elif args.best:
            cn_url = get_cn_url_from_download_page()
            version = args.version
            if not version:
                version = extract_version_from_url(cn_url)
                if not version:
                    raise RuntimeError("未获取到版本号")

            target_url = f"https://www.win-rar.com/fileadmin/winrar-versions/winrar/winrar-x64-{version_to_num(version)}sc.exe"
            print_download_result(target_url)

    except (HTTPError, URLError, RuntimeError, ValueError) as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
