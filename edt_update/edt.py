"""EdgeTunnel Worker 下载助手 - 图形界面版"""

import re
import json
import os
import sys
import queue
import threading
import time
import hashlib
import urllib.request
import zipfile
import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
from pathlib import Path

# Windows 高分屏：让程序感知系统缩放，避免窗口被拉伸导致按钮/内容被截断
if sys.platform == "win32":
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass

# 统一使用 UTF-8 输出，避免部分代码页下乱码
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# Detect running mode: script or exe
IS_FROZEN = getattr(sys, "frozen", False)

if IS_FROZEN:
    # Running as exe - save settings in exe directory
    APP_DIR = Path(os.path.dirname(sys.executable))
else:
    # Running as script - save settings in script directory
    APP_DIR = Path(__file__).parent

DOWNLOAD_DIR = Path.home() / "Downloads"
SETTINGS_FILE = APP_DIR / "settings.json"

GITHUB_TOKEN = None
BASE_URL = "https://api.github.com/repos/cmliu/edgetunnel"
WORKER_FILE = "_worker.js"

HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/vnd.github.v3+json",
    "Origin": "https://eo.blog.cmliussss.com",
}

# ---------------- 日志：GUI 注入后显示到界面，默认回退到控制台 ----------------
LOG_HOOK = None  # GUI 设置: fn(kind, text)，kind: ok/warn/err/info/dim/title


def _emit(kind, text):
    if LOG_HOOK:
        LOG_HOOK(kind, text)
    else:
        print(text)


def _ok(msg):
    _emit("ok", msg)


def _warn(msg):
    _emit("warn", msg)


def _err(msg):
    _emit("err", msg)


def _info(msg):
    _emit("info", msg)


def _dim(msg):
    _emit("dim", msg)


def _title(msg):
    _emit("title", msg)


class GitHubAPI:
    """GitHub API 数据获取"""

    @staticmethod
    def fetch_json(url):
        api_headers = HEADERS.copy()
        if GITHUB_TOKEN:
            api_headers["Authorization"] = f"token {GITHUB_TOKEN}"

        try:
            req = urllib.request.Request(url, headers=api_headers)
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            # 403 rate limit：没有 token 时静默失败（匿名限流属正常情况）
            if e.code in (401, 403) and GITHUB_TOKEN:
                _err("Github Token 无效或已过期")
                return None
            return None
        except Exception:
            return None


class WorkerDownloader:
    """Worker 文件下载器（单源最多重试 2 次，抵抗网络抖动导致的半包）"""

    RETRIES = 2

    @staticmethod
    def download(url):
        last_err = None
        for attempt in range(1, WorkerDownloader.RETRIES + 1):
            try:
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=10) as response:
                    if response.status == 200:
                        return response.read().decode("utf-8")
                    _warn(f"下载失败：HTTP {response.status}")
                    return None
            except Exception as e:
                last_err = e
                if attempt < WorkerDownloader.RETRIES:
                    _dim(f"第 {attempt} 次下载不完整，正在重试…")
                time.sleep(0.4 * attempt)
        _warn(f"下载失败: {last_err}")
        return None


class VersionExtractor:
    """版本提取器"""

    @staticmethod
    def extract(code):
        match = re.search(r"const\s+Version\s*=\s*['\"]([^'\"]+)['\"]", code)
        return match.group(1) if match else "未找到"


class BranchManager:
    """分支管理器"""

    BRANCH_TYPES = {"main": "main", "beta": "beta", "alpha": "alpha"}

    @staticmethod
    def get_available_branches(branch_type):
        data = GitHubAPI.fetch_json(f"{BASE_URL}/branches")

        if not isinstance(data, list):
            return []

        prefix = BranchManager.BRANCH_TYPES.get(branch_type, branch_type)
        result = []
        for b in data:
            if not isinstance(b, dict):
                continue
            name = b.get("name")
            if name and name.startswith(prefix):
                result.append(name)
        return sorted(result, reverse=True) if result else []


class Downloader:
    """下载处理器（多个镜像依次尝试）"""

    def __init__(self):
        self.urls = []

    def resolve_urls(self, branch):
        self.urls = self._build_urls(branch)

    @staticmethod
    def _build_urls(branch):
        raw_url = f"https://raw.githubusercontent.com/cmliu/edgetunnel/refs/heads/{branch}/{WORKER_FILE}"
        jsdelivr_url = f"https://cdn.jsdelivr.net/gh/cmliu/edgetunnel@{branch}/{WORKER_FILE}"
        return [{"name": "GitHub Raw", "url": raw_url}, {"name": "jsDelivr", "url": jsdelivr_url}]

    def download(self):
        total = len(self.urls)
        for i, source in enumerate(self.urls, 1):
            _info(f"[{i}/{total}] 正在从 {source['name']} 下载…")
            content = WorkerDownloader.download(source["url"])
            if content:
                _ok(f"{source['name']} 下载成功")
                return content

        _err("所有镜像下载失败")
        return None


DEMO_REPO = "wlisboy/wlisboy"
DEMO_ZIP_FILE = "edgetunnel-demo.zip"


class DemoDownloader:
    """Demo 整包下载：与分支下载一致，GitHub Raw(raw_url) + jsDelivr(jsdelivr_url) 双镜像"""

    @staticmethod
    def build_urls():
        raw_url = f"https://raw.githubusercontent.com/{DEMO_REPO}/refs/heads/main/{DEMO_ZIP_FILE}"
        jsdelivr_url = f"https://cdn.jsdelivr.net/gh/{DEMO_REPO}@main/{DEMO_ZIP_FILE}"
        return [{"name": "GitHub Raw", "url": raw_url},
                {"name": "jsDelivr", "url": jsdelivr_url}]

    @staticmethod
    def download():
        sources = DemoDownloader.build_urls()
        total = len(sources)
        last_err = None
        for i, source in enumerate(sources, 1):
            _info(f"[{i}/{total}] 正在从 {source['name']} 下载 Demo…")
            for attempt in range(1, WorkerDownloader.RETRIES + 1):
                try:
                    req = urllib.request.Request(source["url"])
                    with urllib.request.urlopen(req, timeout=20) as response:
                        if response.status == 200:
                            _ok(f"{source['name']} 下载成功")
                            return response.read(), source["name"]
                        _warn(f"下载失败：HTTP {response.status}")
                        return None, None
                except Exception as e:
                    last_err = e
                    if attempt < WorkerDownloader.RETRIES:
                        _dim(f"{source['name']} 第 {attempt} 次下载不完整，正在重试…")
                    time.sleep(0.4 * attempt)
        _warn(f"所有 Demo 镜像下载失败: {last_err}")
        return None, None


class ZipPackager:
    """打包器"""

    @staticmethod
    def pack(code, output_path):
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zip_file:
            zip_file.writestr(WORKER_FILE, code)

        _ok(f"已打包生成: {output_path}")


def _zip_version(zip_path):
    """读取已有 ZIP 内的版本号，读取失败返回 None"""
    try:
        with zipfile.ZipFile(zip_path) as zf:
            code = zf.read(WORKER_FILE).decode("utf-8", "replace")
    except Exception:
        return None
    return VersionExtractor.extract(code)


def pick_output_path(path, version):
    """输出路径策略：版本一致则覆盖；不一致则用 _1、_2 … 另存，保留旧版本"""
    if not path.exists():
        return path

    old = _zip_version(path)
    if old == version:
        return path

    _dim(f"{path.name} 已存在（版本: {old or '未知'}），新版本将另存…")
    cand = path
    for i in range(1, 1000):
        cand = path.with_name(f"{path.stem}_{i}{path.suffix}")
        if not cand.exists():
            return cand
        if _zip_version(cand) == version:
            return cand
    return cand


def _content_digest(data):
    """Demo 包无版术号，用内容指纹（sha256）判断是否一致"""
    return hashlib.sha256(data).hexdigest()


def pick_demo_output_path(path, data):
    """Demo 包路径策略：内容一致覆盖；不一致用 _1、_2… 另存"""
    if not path.exists():
        return path

    digest = _content_digest(data)
    if _content_digest(path.read_bytes()) == digest:
        return path

    _dim(f"{path.name} 内容与上次不同，新 Demo 将另存…")
    cand = path
    for i in range(1, 1000):
        cand = path.with_name(f"{path.stem}_{i}{path.suffix}")
        if not cand.exists():
            return cand
        if _content_digest(cand.read_bytes()) == digest:
            return cand
    return cand


_RESERVED_NAMES = {"CON", "PRN", "AUX", "NUL"}
_RESERVED_NAMES |= {f"COM{i}" for i in range(1, 10)} | {f"LPT{i}" for i in range(1, 10)}
_INVALID_NAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def sanitize_filename(raw, fallback):
    """净化输出文件名：去除路径分隔符与 Windows 非法字符，防止越界/非法写入"""
    name = _INVALID_NAME_CHARS.sub("-", (raw or "").strip())
    name = name.strip(" .")
    name = name or fallback
    if name.split(".")[0].upper() in _RESERVED_NAMES:
        name = f"Pages-{name}"
    return name


# ---------------- 设置存取 ----------------


def load_settings():
    if not SETTINGS_FILE.exists():
        return None
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def save_settings(token):
    try:
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump({"token": token}, f, indent=2)
        return True
    except Exception:
        _err("Token 保存失败")
        return False


_TOKEN_PATTERNS = (
    re.compile(r"ghp_[A-Za-z0-9]{36}\Z"),  # 经典 PAT：ghp_ + 36 位
    re.compile(r"github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}\Z"),  # 细粒度 PAT：共 93 位
)


def is_valid_token(token):
    """严格校验 GitHub Token 格式；不允许尾部多余字符/空白。

    空字符串视为未填写（由调用方决定是否允许）；GUI 输入路径会在调用前自行去空白，
    因此粘贴时带首尾空格/换行仍可正常通过，但混入其它字符会被拒绝。
    """
    return any(p.match(token or "") for p in _TOKEN_PATTERNS)


# ---------------- 图形界面 ----------------


class MainWindow:
    BRANCH_LABELS = {"demo": "Demo", "main": "稳定版", "beta": "公测版", "alpha": "测试版"}
    DEFAULT_NAMES = {"demo": "Demo.zip", "main": "Pages.zip", "beta": "Pages-Beta.zip", "alpha": "Pages-Alpha.zip"}

    # ---- 统一主题：分组标题 / 按钮 / 日志 / 标题栏共用同一主色 ----
    ACCENT = "#2563eb"
    ACCENT_ACTIVE = "#1d4ed8"
    ACCENT_SOFT = "#eaf1fe"
    BG = "#f4f7fc"
    FG = "#22303f"
    MUTED = "#667085"
    OK = "#16a34a"
    WARN = "#b45309"
    ERR = "#dc2626"

    LOG_COLORS = {
        "ok": OK,
        "warn": WARN,
        "err": ERR,
        "info": ACCENT,
        "dim": MUTED,
        "title": ACCENT,
    }

    def __init__(self, root):
        global LOG_HOOK
        self.root = root
        root.title("EdgeTunnel · Pages 下载助手")
        root.minsize(600, 480)
        root.configure(background=self.BG)
        self._apply_dpi_scaling()

        self.token_var = tk.StringVar()
        self.token_hint_var = tk.StringVar()
        self.type_var = tk.StringVar(value="main")
        self.name_var = tk.StringVar(value=self.DEFAULT_NAMES["main"])
        self.latest_var = tk.StringVar(value="正在获取分支信息…")
        self.status_var = tk.StringVar(value="就绪")

        self.q = queue.Queue()
        self.latest = {}
        self.busy = False
        self.name_touched = False
        self.out_path = None
        self._closed = False

        LOG_HOOK = self._enqueue

        settings = load_settings()
        if settings and settings.get("token"):
            self.token_var.set(settings["token"])

        self._build_ui()
        self._refresh_token_hint()
        self._place_window(720, 680)
        self._tint_titlebar()
        root.after(300, self._tint_titlebar)
        root.protocol("WM_DELETE_WINDOW", self._on_close)
        root.after(120, self._poll)
        # E2E 自检时的分支列表由测试打桩后显式触发，避免启动期真实请求与桩竞态
        if not os.environ.get("EDT_E2E"):
            root.after(200, self._refresh_branches)

    # ---------- 界面构建 ----------

    def _apply_dpi_scaling(self):
        """按系统 DPI 校准 Tk 缩放，避免高分屏下文字偏小、发虚"""
        if sys.platform != "win32":
            return
        try:
            import ctypes
            dpi = ctypes.windll.user32.GetDpiForSystem()
            if dpi:
                self.root.tk.call("tk", "scaling", dpi / 72.0)
        except Exception:
            pass

    def _setup_style(self):
        """统一配色：分组标题、普通按钮与主按钮都取自同一套主题色"""
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        try:
            style.configure(".", background=self.BG, foreground=self.FG,
                            font=("Microsoft YaHei UI", 10))
            style.configure("TFrame", background=self.BG)
            style.configure("TLabelframe", background=self.BG,
                            bordercolor="#cdd9ea", lightcolor="#cdd9ea",
                            darkcolor="#cdd9ea", padding=8)
            style.configure("TLabelframe.Label", background=self.BG,
                            foreground=self.ACCENT,
                            font=("Microsoft YaHei UI", 10, "bold"))
            style.configure("TLabel", background=self.BG, foreground=self.FG)
            style.configure("TEntry", fieldbackground="#ffffff", foreground=self.FG,
                            bordercolor="#c2cede", lightcolor="#c2cede",
                            darkcolor="#c2cede", padding=4)
            style.map("TEntry", bordercolor=[("focus", self.ACCENT)])
            style.configure("TRadiobutton", background=self.BG, foreground=self.FG)
            style.map("TRadiobutton", background=[("active", self.BG)])
            style.configure("TButton", background="#e4ecf8", foreground=self.FG,
                            borderwidth=0, focusthickness=0, padding=(12, 5),
                            font=("Microsoft YaHei UI", 10))

            style.map("TButton",
                      background=[("active", "#d3e0f2"), ("disabled", "#eef2f8")],
                      foreground=[("disabled", "#9aa5b5")])
            style.configure("Accent.TButton", background=self.ACCENT, foreground="#ffffff",
                            borderwidth=0, focusthickness=0, padding=(16, 6),
                            font=("Microsoft YaHei UI", 10, "bold"))
            style.map("Accent.TButton",
                      background=[("active", self.ACCENT_ACTIVE), ("disabled", "#9db8ea")],
                      foreground=[("disabled", "#f2f2f2")])
        except tk.TclError:
            pass

    def _build_ui(self):
        self._setup_style()
        outer = ttk.Frame(self.root, padding=12)
        outer.pack(fill="both", expand=True)

        # 软件设置区
        box = ttk.LabelFrame(outer, text="软件设置", padding=10)
        box.pack(fill="x")
        box.columnconfigure(0, weight=1)

        ttk.Label(box, text="GitHub Token（可选，提高 API 限额；格式 ghp_… 或 github_pat_…）").grid(
            row=0, column=0, sticky="w")
        self.token_entry = ttk.Entry(box, textvariable=self.token_var, show="●")
        self.token_entry.grid(row=1, column=0, sticky="ew", pady=(2, 0))
        self.token_entry.bind("<KeyRelease>", lambda _e: self._refresh_token_hint())
        self.token_entry.bind("<FocusOut>", lambda _e: self._refresh_token_hint())

        self.token_hint = ttk.Label(box, textvariable=self.token_hint_var, foreground=self.MUTED)
        self.token_hint.grid(row=2, column=0, sticky="w", pady=(2, 10))

        ttk.Label(box, text="下载版本").grid(row=3, column=0, sticky="w")
        radios = ttk.Frame(box)
        radios.grid(row=4, column=0, sticky="w", pady=(2, 2))
        for val in ("demo", "main", "beta", "alpha"):
            ttk.Radiobutton(
                radios,
                text=self.BRANCH_LABELS[val],
                value=val,
                variable=self.type_var,
                command=self._on_type_change,
            ).pack(side="left", padx=(0, 14))

        self.latest_lbl = ttk.Label(box, textvariable=self.latest_var, foreground=self.MUTED)
        self.latest_lbl.grid(row=5, column=0, sticky="w", pady=(0, 8))

        ttk.Label(box, text="输出文件名（默认保存到系统“下载”目录）").grid(row=6, column=0, sticky="w")
        self.name_entry = ttk.Entry(box, textvariable=self.name_var)
        self.name_entry.grid(row=7, column=0, sticky="ew", pady=(2, 0))
        self.name_entry.bind("<KeyRelease>", self._on_name_typed)

        # 日志区
        log_box = ttk.LabelFrame(outer, text="运行日志", padding=6)
        log_box.pack(fill="both", expand=True, pady=(10, 0))

        self.log = tk.Text(
            log_box, wrap="word", height=2, state="disabled", relief="flat",
            font=("Microsoft YaHei UI", 10),
            background="#ffffff", foreground=self.FG,
            insertbackground=self.FG, selectbackground=self.ACCENT_SOFT,
            cursor="arrow")
        for tag, color in self.LOG_COLORS.items():
            self.log.tag_configure(tag, foreground=color)
        self.log.tag_configure("title", font=("Microsoft YaHei UI", 10, "bold"))

        self.log.pack(fill="both", expand=True)

        # 底部状态与按钮
        bar = ttk.Frame(outer)
        bar.pack(fill="x", pady=(10, 0))
        ttk.Label(bar, textvariable=self.status_var, foreground=self.MUTED).pack(side="left")

        self.start_btn = ttk.Button(bar, text="开始下载", command=self._start, style="Accent.TButton")
        self.start_btn.pack(side="right")
        self.open_btn = ttk.Button(
            bar, text="打开输出文件夹", command=self._open_folder, state="disabled")
        self.open_btn.pack(side="right", padx=(0, 8))

        _dim("点击「开始下载」获取并打包最新 Worker")

    def _tint_titlebar(self):
        """Windows 11+：把系统标题栏也染成界面主色；不支持时静默保留系统默认"""
        if sys.platform != "win32":
            return
        try:
            import ctypes
            from ctypes import wintypes
            hwnd = ctypes.windll.user32.GetParent(self.root.winfo_id()) or self.root.winfo_id()
            dwm = ctypes.windll.dwmapi.DwmSetWindowAttribute
            light = wintypes.BOOL(0)          # DWMWA_USE_IMMERSIVE_DARK_MODE = 20 -> 浅色标题栏
            dwm(hwnd, 20, ctypes.byref(light), ctypes.sizeof(light))
            accent = 0x00EB6325               # 标题栏背景：#2563eb（COLORREF BGR）
            white = 0x00FFFFFF                # 标题文字：白色
            dwm(hwnd, 35, ctypes.byref(ctypes.c_uint(accent)), ctypes.sizeof(ctypes.c_uint))
            dwm(hwnd, 36, ctypes.byref(ctypes.c_uint(white)), ctypes.sizeof(ctypes.c_uint))
        except Exception:
            pass

    def _refresh_token_hint(self):
        """Token 实时校验：留空 / 格式正确 / 格式错误 三种提示"""
        token = self.token_var.get().strip()
        if not token:
            self.token_hint_var.set("留空也可以下载 · 匿名可能会被限流")
            color = self.MUTED
        elif is_valid_token(token):
            self.token_hint_var.set("✓ 格式正确 · 下载时将用于提高 API 限额")
            color = self.OK
        else:
            self.token_hint_var.set("✗ 格式不正确 · 应填 ghp_…（40 位）或 github_pat_…（93 位）")
            color = self.ERR
        self.token_hint.configure(foreground=color)

    def _place_window(self, width, height):
        """居中放置窗口，并限制在屏幕可用区域内，避免底部被任务栏遮挡"""
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        height = min(height, sh - 60)
        width = min(width, sw - 40)
        x = max((sw - width) // 2, 0)
        y = max((sh - height) // 3, 0)
        self.root.geometry(f"{width}x{height}+{x}+{y}")

    # ---------- 日志 ----------

    def _enqueue(self, kind, text):
        self.q.put((kind, text))

    def _poll(self):
        if self._closed:
            return
        try:
            while True:
                kind, data = self.q.get_nowait()
                if kind == "branches":
                    self._apply_branches(data)
                elif kind == "end":
                    self._finish(data)
                else:
                    self._append(kind, data)
        except queue.Empty:
            pass
        finally:
            # 即使某个回调出错也保持队列轮询；窗口销毁后停止排程
            if not self._closed:
                try:
                    self.root.after(120, self._poll)
                except tk.TclError:
                    pass

    def _append(self, kind, text):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n", kind)
        self.log.configure(state="disabled")
        self._autosize_log()

    def _autosize_log(self):
        """无滚动条：日志框高度跟随内容行数自动增长，保证输出完整可见"""
        try:
            result = self.log.count("1.0", "end-1c", "displaylines")
            lines = int(result[0]) if result else 1
        except tk.TclError:
            return
        self.log.configure(height=min(max(lines, 3), 16))

    def _clear_log(self):
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")
        try:
            self.log.configure(height=3)
        except tk.TclError:
            pass

    # ---------- 交互逻辑 ----------

    def _on_type_change(self):
        if not self.name_touched:
            self.name_var.set(self.DEFAULT_NAMES[self.type_var.get()])

    def _on_name_typed(self, _event=None):
        self.name_touched = True

    def _refresh_branches(self):
        def fetch():
            data = {}
            for t in ("main", "beta", "alpha"):
                data[t] = BranchManager.get_available_branches(t)
            self.q.put(("branches", data))

        threading.Thread(target=fetch, daemon=True).start()

    def _apply_branches(self, data):
        self.latest = data

        def latest(t):
            names = data.get(t) or []
            return names[0] if names else "暂无"

        self.latest_var.set(
            f"Demo 预览  ·  稳定版 main  ·  公测版 {latest('beta')}  ·  测试版 {latest('alpha')}")

        if data.get("beta") or data.get("alpha"):
            _ok("已获取可用分支")
        else:
            _warn("未获取到可用分支（可能触发 API 限流，仍可尝试下载）")

    def _start(self):
        if self.busy:
            return

        global GITHUB_TOKEN
        token = self.token_var.get().strip()
        if token and not is_valid_token(token):
            _err("Token 格式不正确：应为 ghp_ 开头的 40 位，或 github_pat_ 开头的 93 位令牌")
            self.status_var.set("Token 格式不正确")
            return
        if token:
            GITHUB_TOKEN = token
            if not save_settings(token):
                _warn("Token 未能保存到本地，本次仍会使用")
        else:
            GITHUB_TOKEN = None

        btype = self.type_var.get()
        filename = sanitize_filename(self.name_var.get(), self.DEFAULT_NAMES[btype])
        if not filename.lower().endswith(".zip"):
            filename += ".zip"
        self.name_var.set(filename)

        self._clear_log()
        self.busy = True
        self.start_btn.configure(state="disabled")
        self.open_btn.configure(state="disabled")
        self.status_var.set("正在下载…")
        threading.Thread(target=self._worker, args=(btype, filename), daemon=True).start()

    def _worker(self, btype, filename):
        try:
            if btype == "demo":
                out_path = self._worker_demo(filename)
            else:
                out_path = self._worker_branch(btype, filename)
            self.out_path = out_path
            _title("下载完成")
            _info(f"输出：{out_path}")
            self.q.put(("end", True))
        except Exception as e:
            _err(f"运行出错：{e}")
            self.q.put(("end", False))

    def _worker_branch(self, btype, filename):
        names = self.latest.get(btype) or BranchManager.get_available_branches(btype)
        branch = names[0] if names else btype
        if not names:
            _warn(f"暂未获取到 {btype} 分支，将按 {branch} 直接下载")

        downloader = Downloader()
        downloader.resolve_urls(branch)
        _title(f"开始下载 {branch} 分支…")
        code = downloader.download()
        if not code:
            raise RuntimeError("所有镜像下载失败，请检查网络后重试")

        version = VersionExtractor.extract(code)
        out_path = pick_output_path(DOWNLOAD_DIR / filename, version)
        ZipPackager.pack(code, out_path)

        _info(f"分支：{branch}")
        _info(f"版本：{version}")
        _info(f"镜像：{downloader.urls[0]['name']}")
        return out_path

    def _worker_demo(self, filename):
        _title("开始下载 Demo 包…")
        data, mirror = DemoDownloader.download()
        if not data:
            raise RuntimeError("所有 Demo 镜像下载失败，请检查网络后重试")

        out_path = pick_demo_output_path(DOWNLOAD_DIR / filename, data)
        out_path.write_bytes(data)
        _ok(f"已保存 Demo 包: {out_path}")

        digest = _content_digest(data)
        _info(f"版本：{digest[:12]}（内容指纹）")
        _info(f"镜像：{mirror}")
        return out_path

    def _finish(self, success):
        self.busy = False
        self.start_btn.configure(state="normal")
        if success:
            self.open_btn.configure(state="normal")
            self.status_var.set("下载完成")
        else:
            self.status_var.set("下载失败")

    def _open_folder(self):
        try:
            if self.out_path:
                os.startfile(str(self.out_path.parent))
        except Exception:
            pass

    def _on_close(self):
        global LOG_HOOK
        if self.busy and not messagebox.askyesno("提示", "下载仍在进行，确定要退出吗？"):
            return
        self._closed = True
        LOG_HOOK = None
        self.root.destroy()


# ---------------- 端到端自检：EDT_E2E=1 时启用（打包后自动化回归用） ----------------

def _e2e_pump(root, seconds):
    import time
    end = time.time() + seconds
    while time.time() < end:
        root.update()
        time.sleep(0.02)


def _e2e_wait_idle(win, timeout=30):
    import time
    end = time.time() + timeout
    while time.time() < end:
        win.root.update()
        if not win.busy:
            return True
        time.sleep(0.03)
    return not win.busy


def _run_e2e(win, root):
    """离线自动跑一遍 GUI→线程→打包→文件策略 的完整链路，写 JSON 报告后按结果退出。

    通过环境变量 EDT_E2E 触发；网络请求全部打桩，可重复、不影响真实文件。
    """
    import json
    import tempfile
    import time
    import shutil

    tmp = Path(tempfile.mkdtemp(prefix="edt_e2e_"))
    results = []

    def check(name, cond, detail=""):
        results.append({"name": name, "passed": bool(cond), "detail": str(detail)})
        print(f"[E2E] {'PASS' if cond else 'FAIL'}  {name}  {'' if cond else detail}")

    global DOWNLOAD_DIR, SETTINGS_FILE
    DOWNLOAD_DIR = tmp
    SETTINGS_FILE = tmp / "settings.json"

    # ---- 离线桩：分支列表 + worker 内容（版本可变）----
    GitHubAPI.fetch_json = staticmethod(
        lambda url: [
            {"name": "main"},
            {"name": "beta-20250101"},
            {"name": "beta-20240101"},
            {"name": "alpha-tester"},
        ])

    state = {"version": "1.2.3", "demo": b"DEMO-PACK-A"}

    def fake_download(_url):
        return f"const Version = '{state['version']}';\n// worker stub\n"

    def fake_demo_download():
        return state["demo"], "GitHub Raw"

    WorkerDownloader.download = staticmethod(fake_download)
    DemoDownloader.download = staticmethod(fake_demo_download)

    def log_text():
        return win.log.get("1.0", "end")

    try:
        win._refresh_branches()                # 桩已就位，重新拉取分支列表
        _e2e_pump(root, 2.0)

        check("window-title", "EdgeTunnel" in root.title(), root.title())
        for wname in ("token_entry", "start_btn", "open_btn", "log", "name_entry"):
            check(f"widget-{wname}", hasattr(win, wname), wname)
        check("branches-loaded",
              "beta-20250101" in win.latest_var.get() and "main" in win.latest_var.get(),
              win.latest_var.get())
        check("demo-label-first",
              list(win.BRANCH_LABELS)[0] == "demo" and win.BRANCH_LABELS["demo"] == "Demo",
              win.BRANCH_LABELS)
        check("demo-default-name", win.DEFAULT_NAMES["demo"].lower().endswith(".zip"), win.DEFAULT_NAMES)
        demo_sources = DemoDownloader.build_urls()
        check("demo-dual-mirrors",
              [s["name"] for s in demo_sources] == ["GitHub Raw", "jsDelivr"]
              and "raw.githubusercontent.com" in demo_sources[0]["url"]
              and "cdn.jsdelivr.net" in demo_sources[1]["url"],
              demo_sources)

        # Token 格式校验
        check("token-ghp-ok", is_valid_token("ghp_" + "a" * 36))
        check("token-finegrained-ok", is_valid_token("github_pat_" + "A" * 22 + "_" + "9" * 59))
        check("token-junk-bad", not is_valid_token("hello world token"))
        check("token-short-bad", not is_valid_token("ghp_abc"))

        # 非法 Token：点「开始下载」应被拦截，不进入下载流程
        win.token_var.set("not a token")
        win.start_btn.invoke()
        _e2e_pump(root, 0.5)
        check("bad-token-blocked",
              (not win.busy) and "Token 格式不正确" in log_text(),
              log_text()[:300])

        # 合法下载 v1.2.3
        win.token_var.set("")
        win.name_var.set("Pages.zip")
        win.start_btn.invoke()
        check("download-started", win.busy)
        check("wait-done", _e2e_wait_idle(win, 30), "busy 超时")
        p0 = DOWNLOAD_DIR / "Pages.zip"
        check("zip-created", p0.exists(), str(DOWNLOAD_DIR))
        check("zip-version", _zip_version(p0) == "1.2.3", _zip_version(p0))
        check("log-download-ok",
              "下载完成" in log_text() and "1.2.3" in log_text(),
              log_text()[-500:])

        # 同版本重复下载：应覆盖原文件而非另存
        win.start_btn.invoke()
        _e2e_wait_idle(win, 30)
        names_after = sorted(p.name for p in DOWNLOAD_DIR.iterdir())
        check("same-version-overwrite",
              "Pages.zip" in names_after and "Pages_1.zip" not in names_after,
              names_after)

        # 新版本下载：应另存 Pages_1.zip 并保留旧文件
        state["version"] = "2.0.0"
        win.start_btn.invoke()
        _e2e_wait_idle(win, 30)
        names_after = sorted(p.name for p in DOWNLOAD_DIR.iterdir())
        check("new-version-renamed", "Pages_1.zip" in names_after, names_after)
        check("old-version-kept",
              "Pages.zip" in names_after and _zip_version(DOWNLOAD_DIR / "Pages.zip") == "1.2.3",
              names_after)

        # Demo 版本：内容一致覆盖，不一致另存 _1
        win.type_var.set("demo")
        win.name_var.set("demo.zip")
        win.start_btn.invoke()
        check("demo-started", win.busy)
        check("demo-wait-done", _e2e_wait_idle(win, 30), "busy 超时")
        dp0 = DOWNLOAD_DIR / "demo.zip"
        check("demo-zip-created", dp0.exists(), str(DOWNLOAD_DIR))

        win.start_btn.invoke()
        _e2e_wait_idle(win, 30)
        demo_names = sorted(p.name for p in DOWNLOAD_DIR.iterdir())
        check("demo-same-overwrite",
              "demo.zip" in demo_names and "demo_1.zip" not in demo_names, demo_names)

        state["demo"] = b"DEMO-PACK-B"
        win.start_btn.invoke()
        _e2e_wait_idle(win, 30)
        demo_names = sorted(p.name for p in DOWNLOAD_DIR.iterdir())
        check("demo-new-renamed", "demo_1.zip" in demo_names, demo_names)

        # Demo 路径策略直接单测
        pd0 = DOWNLOAD_DIR / "D.zip"
        pd0.write_bytes(b"AAA")
        check("demo-pick-same", pick_demo_output_path(pd0, b"AAA") == pd0)
        pd1 = pick_demo_output_path(pd0, b"BBB")
        check("demo-pick-diff", pd1.name == "D_1.zip", pd1.name)
        pd1.write_bytes(b"BBB")
        check("demo-pick-reuse", pick_demo_output_path(pd0, b"BBB") == pd1)

        win.type_var.set("main")
        win.name_var.set("Pages.zip")

        # 输出路径策略直接单测
        pa = DOWNLOAD_DIR / "P.zip"
        ZipPackager.pack("const Version = '9.9.9';", pa)
        check("pick-same-version", pick_output_path(pa, "9.9.9") == pa)
        pb = pick_output_path(pa, "8.8.8")
        check("pick-diff-version", pb.name == "P_1.zip", pb.name)
        ZipPackager.pack("const Version = '8.8.8';", pb)
        check("pick-reuse-existing", pick_output_path(pa, "8.8.8") == pb)

        # 文件名净化
        check("sanitize-illegal-chars",
              sanitize_filename('a/b:c*.zip', "x.zip") == "a-b-c-.zip",
              sanitize_filename('a/b:c*.zip', "x.zip"))
        check("sanitize-reserved",
              sanitize_filename("CON.zip", "x.zip") == "Pages-CON.zip",
              sanitize_filename("CON.zip", "x.zip"))
        check("sanitize-empty",
              sanitize_filename("   ", "fallback.zip") == "fallback.zip",
              sanitize_filename("   ", "fallback.zip"))

        # 设置保存
        token_ok = "ghp_" + "b" * 36
        check("settings-saved", save_settings(token_ok) and SETTINGS_FILE.exists())
        if SETTINGS_FILE.exists():
            saved = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            check("settings-content", saved.get("token") == token_ok, saved)
    finally:
        passed = sum(1 for r in results if r["passed"])
        failed = len(results) - passed
        report = {"ok": failed == 0, "passed": passed, "failed": failed, "results": results}
        report_path = Path(os.environ.get("EDT_E2E_REPORT") or (APP_DIR / "e2e_report.json"))
        try:
            report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"[E2E] 报告已写入: {report_path}")
        except Exception as exc:
            print(f"[E2E] 报告写入失败: {exc}")
        print(f"[E2E] 通过 {passed} / {passed + failed}" + ("，全部通过" if failed == 0 else "，存在失败"))
        shutil.rmtree(tmp, ignore_errors=True)
        try:
            root.destroy()
        except Exception:
            pass
        os._exit(0 if failed == 0 else 1)


def _real_download_probe():
    """EDT_REAL_PROBE=1：真实联网下载一次并打包，验证冻结环境下的 urllib/SSL/zip 链路。

    结果写入 JSON 报告；网络不可达视为“跳过”（exit 2），真实错误 exit 1。
    """
    import json
    import tempfile
    import shutil

    tmp = Path(tempfile.mkdtemp(prefix="edt_real_"))
    out = {"status": "error", "detail": ""}
    try:
        dl = Downloader()
        dl.resolve_urls("main")
        code = dl.download()
        if not code:
            out["status"] = "network_error"
            out["detail"] = "网络不可达或所有镜像失败（多为环境限制，非程序错误）"
        else:
            version = VersionExtractor.extract(code)
            target = tmp / "Pages.zip"
            ZipPackager.pack(code, target)
            same = _zip_version(target) == version
            out["status"] = "ok" if (target.exists() and same) else "error"
            out["detail"] = f"版本 {version} -> {target}"
    except Exception as exc:
        out["detail"] = f"异常: {exc!r}"
    finally:
        report_path = Path(os.environ.get("EDT_E2E_REPORT") or (APP_DIR / "real_probe_report.json"))
        try:
            report_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"[REAL] 报告已写入: {report_path}  status={out['status']}")
        except Exception as exc:
            print(f"[REAL] 报告写入失败: {exc}")
        shutil.rmtree(tmp, ignore_errors=True)
        code = {"ok": 0, "network_error": 2, "error": 1}.get(out["status"], 1)
        os._exit(code)


def main():
    if os.environ.get("EDT_REAL_PROBE"):
        _real_download_probe()
    root = tk.Tk()
    win = MainWindow(root)
    if os.environ.get("EDT_E2E"):
        root.after(600, lambda: _run_e2e(win, root))
    root.mainloop()


if __name__ == "__main__":
    main()
