#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ZCode 退出后自动打补丁看护（计划任务 / 插件开关同步调用，勿手动常跑）
轮询等待 ZCode.exe 全部退出 → 按期望状态应用/还原补丁（重打包级需文件未被占用）
→ 重启 ZCode → 记录日志后退出。日志: scripts/_apply_after_exit.log

退出后可见性（0.6.41）：检测到 ZCode 退出、开始应用时，弹一个黑底金字的 tkinter
进度小卡（与角标同语言），逐步显示「写入哪项、成功/失败、重启」；成功自动关闭，
失败常驻到用户点掉。无 tkinter / 建窗失败 → 无窗降级，行为与旧版完全一致。
等待退出期间（可能长达数小时）**不**显示窗口，只有开始干活才出现。

两种调用方式：
  1) 无参数（本地计划任务）：应用全部 4 项补丁（TPS 状态栏 / 增强提示词 / 模型拉取按钮 / 注入状态角标，见 DEFAULT_TASKS）
  2) `--want=<键>=on|off`（插件 sync.py 传入，可多个）：只处理指定开关，off 走 --revert

取消方式: schtasks /Delete /TN ZCodePatchApply /F（并删除本脚本）

退出码约定（与 zcode_patcher.py 一致）：0=成功、1=有项目失败/等待超时、2=预检失败（ZCode 仍在运行）。
"""

import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

try:                                   # 控制台编码/窗口安全网（见 _console.py 的说明）
    from _console import no_window_kwargs
except ImportError:                    # 被别处 import 时脚本目录可能不在 sys.path
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from _console import no_window_kwargs

HERE = Path(__file__).resolve().parent
LOG = HERE / "_apply_after_exit.log"
PID_FILE = HERE / "_watchdog.pid"
WANT_FILE = HERE / "_watchdog.want"
# sync.py 在 Windows 用这个一次性计划任务启动看护（绕开 ZCode 的 Job 对象）
SCHTASK_NAME = "ZCodePatchApply"
POLL_SEC = 3
MAX_WAIT_SEC = 24 * 3600
PYTHON = sys.executable or "python"
#: 子进程超时（秒）。看护是**无人值守**运行的，一旦某个子进程挂死就再也没有人
#: 会来收拾 —— 表现为「明明退出了却永远不生效」（与 7.5 节那个故障长得一样）。
#: tasklist 正常 <1s；zcode_patcher 在 311MB asar 上实测 2~3s，给足余量。
TASKLIST_TIMEOUT = 30
PATCH_TIMEOUT = 600


def _import_patcher():
    """导入主脚本模块；sys.path 只在缺失时插入。

    看护轮询循环每 POLL_SEC 秒调一次 zcode_running() → 本函数被反复执行，
    不能每次都 insert（sys.path 会无界增长——24h 上限约 2.9 万个重复项）。
    """
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    import zcode_patcher as zp
    return zp


def log(msg: str) -> None:
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")


def is_pid_alive(pid: int) -> bool:
    """检查指定 PID 进程是否仍在存活运行。"""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        try:
            import ctypes
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            SYNCHRONIZE = 0x00100000
            h = ctypes.windll.kernel32.OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, False, pid
            )
            if not h:
                return False
            exit_code = ctypes.c_ulong()
            ctypes.windll.kernel32.GetExitCodeProcess(h, ctypes.byref(exit_code))
            ctypes.windll.kernel32.CloseHandle(h)
            return exit_code.value == 259  # STILL_ACTIVE
        except Exception:
            return False
    else:
        try:
            import os
            os.kill(pid, 0)
            return True
        except OSError:
            return False


def zcode_running() -> bool:
    # 复用主脚本 zcode_patcher.zcode_running() 的跨平台检测（Windows: tasklist 检索
    # ZCode.exe；POSIX: pgrep -f ZCode）。看护的判定必须与补丁预检同源，否则会出现
    # 「看护以为退干净了、动手时又被预检拒绝」的永久错位。
    # 历史问题：这里曾直接跑 ["tasklist"] 并检索 b"ZCode.exe" —— macOS/Linux 上没有
    # tasklist，FileNotFoundError 未被捕获（except 只接 TimeoutExpired），看护在第一次
    # 轮询就崩溃；启动方又把 stderr 定向到 DEVNULL，崩溃完全无声，表现为
    # 「等退出 0 次、完成 0 次」、补丁永远写不进去。
    try:
        return _import_patcher().zcode_running()
    except Exception as e:
        log(f"运行检测失败: {type(e).__name__}: {e}，本轮按「仍在运行」处理")
        return True


def _find_exe(res: Path) -> Path | None:
    """从 asar 所在目录（<安装根>/resources）推出各平台的 ZCode 主程序路径。"""
    root = res.parent                       # Windows: 安装根；macOS: ZCode.app/Contents
    cands: list[Path] = [root / "ZCode.exe"]            # Windows
    if sys.platform == "darwin":
        cands.insert(0, root / "MacOS" / "ZCode")       # macOS .app 包
    else:
        cands += [root / "zcode", root / "ZCode"]       # Linux 常见命名
    for c in cands:
        if c.is_file():
            return c
    return None


def resolve_install() -> tuple[Path | None, Path | None]:
    """复用主脚本的跨平台探测拿到 (asar 目录, ZCode 可执行文件)。"""
    try:
        zp = _import_patcher()
        for cjs in zp.discover():
            res = cjs.parent.parent
            if (res / "app.asar").is_file():
                return res, _find_exe(res)
    except Exception as e:
        log(f"安装探测失败: {type(e).__name__}: {e}")
    return None, None


# 配置键 -> zcode_patcher.py 参数（与 sync.py 的 PATCHES 一一对应，顺序也保持一致）
PATCH_ARGS = {
    "tps_footer": ["--tps-footer"],
    "enhance_prompt": ["--enhance-prompt"],
    "model_puller": ["--model-puller"],
    "inject_status": ["--inject-status"],
}
# 未收到 --want 时的默认动作（本地计划任务用）：全量 4 项补丁按序全部应用
DEFAULT_TASKS = [
    ["--tps-footer"],
    ["--enhance-prompt"],
    ["--model-puller"],
    ["--inject-status"],
]


def _save_wants(argv: list[str]) -> None:
    """把传入的 --want 参数与已存的合并并写入 WANT_FILE。"""
    wants_dict = {}
    if WANT_FILE.is_file():
        try:
            import json
            wants_dict = json.loads(WANT_FILE.read_text(encoding="utf-8"))
        except Exception:
            wants_dict = {}
    for a in argv:
        if a.startswith("--want="):
            key, _, val = a[len("--want="):].partition("=")
            key = key.strip()
            if key in PATCH_ARGS:
                enabled = val.strip().lower() not in ("off", "false", "0", "no")
                wants_dict[key] = enabled
    if wants_dict:
        try:
            import json
            WANT_FILE.write_text(json.dumps(wants_dict, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass
    elif WANT_FILE.is_file():
        try:
            WANT_FILE.unlink(missing_ok=True)
        except Exception:
            pass


def parse_wants(argv: list[str]):
    """解析 sync.py 传入的 --want=<key>=on|off 或 WANT_FILE。
    返回 [(args, revert), ...]；没有任何 --want 输入时返回 None（走 DEFAULT_TASKS）。"""
    has_explicit_input = any(a.startswith("--want=") for a in argv) or WANT_FILE.is_file()
    merged_wants = {}
    if WANT_FILE.is_file():
        try:
            import json
            merged_wants = json.loads(WANT_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    for a in argv:
        if a.startswith("--want="):
            key, _, val = a[len("--want="):].partition("=")
            key = key.strip()
            if key in PATCH_ARGS:
                merged_wants[key] = val.strip().lower() not in ("off", "false", "0", "no")

    if not has_explicit_input and not merged_wants:
        return None
    tasks = []
    for key, enabled in merged_wants.items():
        if key not in PATCH_ARGS:
            # ★ 回归（0.6.38）：WANT_FILE 由「合并旧文件 + 更新新值」维护（sync.py
            #   start_watchdog 只 update 不删键），历史残留键（如 0.6.34 移除的
            #   usage_chart）会永远留在里面 —— 直接 PATCH_ARGS[key] 是 KeyError，
            #   看护在等待前就崩溃且无人值守无声（实测日志尾部三连崩）。跳过并留痕。
            log(f"WANT_FILE 含未知补丁键 {key!r}（可能来自旧版本），已跳过")
            continue
        tasks.append((PATCH_ARGS[key], not enabled))
    return tasks


def batch_tasks(tasks: list[tuple[list[str], bool]]) -> list[tuple[list[str], bool]]:
    """将同方向（revert 或 apply）的补丁参数合并为批量调用，避免多次解包/重打包 asar。

    规则：
      1. 先执行 revert（还原关闭的项），再执行 apply（应用开启的项）；
      2. 针对同一方向：
         - 拥有具体命令行参数的补丁（如 --tps-footer, --enhance-prompt 等）合并为单次批量调用，
           参数保持既有顺序并去重；
         - 空参数项（即 core_patch 思维强度内核补丁）保持独立调用（因为 zcode_patcher 在
           接收 asar 标志时不会跑内核补丁）。
    """
    batched = []
    for target_revert in (True, False):
        subset = [args for args, rev in tasks if rev == target_revert]
        if not subset:
            continue
        merged_args = []
        has_core_patch = False
        for args in subset:
            if not args:
                has_core_patch = True
            else:
                for a in args:
                    if a not in merged_args:
                        merged_args.append(a)
        if merged_args:
            batched.append((merged_args, target_revert))
        if has_core_patch:
            batched.append(([], target_revert))
    return batched


def _delete_scheduled_task() -> None:
    """清理一次性计划任务定义（sync.py 用它绕开 ZCode 的 Job 对象）。

    删除定义不会终止已在运行的看护实例；sync 侧 /Run 后通常已经删过一次，
    这里只是兜底（例如当时 /Delete 失败）。
    """
    if os.name != "nt":
        return
    try:
        subprocess.run(["schtasks", "/Delete", "/TN", SCHTASK_NAME, "/F"],
                       capture_output=True, timeout=20, **no_window_kwargs())
    except Exception:
        pass


def _cleanup_singletons(cur_pid: int) -> None:
    try:
        if PID_FILE.is_file() and PID_FILE.read_text(encoding="utf-8").strip() == str(cur_pid):
            PID_FILE.unlink(missing_ok=True)
        WANT_FILE.unlink(missing_ok=True)
    except Exception:
        pass
    try:
        sp = _shared_pid_file()
        if sp is not None and sp.is_file() and sp.read_text(encoding="utf-8").strip() == str(cur_pid):
            sp.unlink(missing_ok=True)
    except Exception:
        pass
    _delete_scheduled_task()


def _shared_pid_file() -> Path | None:
    """跨版本共享的看护单例锁：<v2>/zcode-watchdog.pid（取不到 v2 根时 None）。

    插件每个版本副本各有自己的 _watchdog.pid（随副本目录走）：插件升级前后
    两个版本的看护可能同时等待——各查各的 pid 会双双放行，退出后并发重打包
    同一个 asar（一方必 rc!=0，状态文件还会把角标钉在 pending）。共享锁保证
    「全机同时只有一个看护」，与副本级 pid 文件互为补充。
    """
    try:
        return _import_patcher()._v2_root() / "zcode-watchdog.pid"
    except Exception:
        return None


def _shared_watchdog_alive(cur_pid: int) -> int:
    """共享锁里登记着别的活看护 → 返回其 PID；否则 0。"""
    sp = _shared_pid_file()
    if sp is None or not sp.is_file():
        return 0
    try:
        old = int(sp.read_text(encoding="utf-8").strip() or 0)
    except Exception:
        return 0
    if old != cur_pid and is_pid_alive(old):
        return old
    return 0


def _write_status(pending: bool, last_error: str | None = None,
                  phase: str | None = None) -> None:
    """把补丁 pending 状态写进 v2 状态文件（渲染层「待注入」角标的真相源）。

    应用成功 → pending:false（重启后角标消失）；失败/预检未通过 → 保持
    pending:true + last_error。与 sync.write_patch_status 双写：任一环失败，
    角标也不会谎报。phase 是可选的进度标记（0.6.41：正在写入/完成/失败），
    供无窗降级（无 tkinter）时事后诊断。写失败只记日志，绝不影响看护主流程。
    """
    import json
    import tempfile
    try:
        dest = _import_patcher()._v2_root() / "zcode-patches-status.json"
        data = {"v": 1, "stamp": int(time.time() * 1000),
                "pending": bool(pending), "items": {}}
        if pending and last_error:
            data["last_error"] = last_error
        if phase:
            data["phase"] = phase
        dest.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(dest.parent),
                                   prefix=".zpatch-status-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, dest)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        log(f"补丁状态已更新: pending={pending}" + (f"（{last_error}）" if last_error else ""))
    except Exception as e:
        log(f"补丁状态文件写入失败（角标维持现状）: {e!r}")


# 批量参数 → 用户可读名（与 PATCH_ARGS 反查；顺序即 batch_tasks 合并后的顺序）
ARG_LABEL = {
    "--tps-footer": "TPS 状态栏",
    "--enhance-prompt": "增强提示词",
    "--model-puller": "模型拉取按钮",
    "--inject-status": "注入状态角标",
}


def _batch_label(args: list[str], revert: bool) -> str:
    names = "、".join(ARG_LABEL.get(a, a) for a in args) or "内核补丁"
    return ("还原 " if revert else "写入 ") + names


def _apply_phase(raw_tasks: list, waited: int, cur_pid: int, report) -> tuple[int, bool, str]:
    """应用阶段：从「检测到 ZCode 已退出」到「重启完成」（可在线程中运行）。

    report(kind, text, ok=None)：kind="step" 追加一行（"…" 结尾进行时）、
    kind="result" 改写最后一行（ok=True 绿 / False 红 / None 中性）。UI 缺席时
    report 为空操作，全部步骤照旧落 _apply_after_exit.log。

    返回 (退出码, 是否需要常驻窗口, 结束语)。失败类（有失败项 / 预检未通过 /
    找不到主程序 / 重启失败）→ 常驻窗口等用户点掉；成功 → 窗口自动关闭。
    """
    desc = "、".join(("还原 " if rev else "应用 ") + (" ".join(a) or "内核补丁") for a, rev in raw_tasks)
    log(f"ZCode 已退出（等待 {waited}s），开始处理：{desc}")
    _write_status(True, phase="正在写入补丁…")

    # TPS 快照刷新（最佳努力）：ZCode 退出时 DB 不再写入，此时快照最完整。
    # 渲染层下次启动经 IPC 读到的是新鲜快照；失败静默，不影响补丁任务。
    report("step", "刷新 TPS 用量快照…")
    try:
        sys.path.insert(0, str(HERE))
        import tps_snapshot
        tps_snapshot.main([])
        report("result", "TPS 用量快照已刷新", None)
    except Exception as e:
        log(f"TPS 快照刷新失败（已降级为纯事件流）: {e!r}")
        report("result", "TPS 快照刷新失败（已降级，不影响补丁）", None)

    tasks = batch_tasks(raw_tasks)
    failed = 0
    for args, revert in tasks:
        label = _batch_label(args, revert)
        report("step", label + "…")
        cmd = [PYTHON, str(HERE / "zcode_patcher.py"), *args] + (["--revert"] if revert else [])
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=PATCH_TIMEOUT,
                               **no_window_kwargs())
        except subprocess.TimeoutExpired:
            # 超时 = 这一项没做成。继续跑剩下的项（能写一项是一项），最后计入 failed。
            log(f"$ zcode_patcher.py {' '.join(cmd[2:])}  [超时 {PATCH_TIMEOUT}s]")
            failed += 1
            report("result", label + "：超时", False)
            continue
        out = ((r.stdout or b"") + (r.stderr or b"")).decode("utf-8", "replace")
        log(f"$ zcode_patcher.py {' '.join(cmd[2:])}  [exit={r.returncode}]\n{out}".rstrip())
        if r.returncode == 2:
            log("预检未通过（ZCode 在等待期间被重新拉起），本次放弃，不重启")
            _write_status(True, "预检未通过（ZCode 在等待期间被重新拉起）",
                          phase="预检未通过")
            _cleanup_singletons(cur_pid)
            report("result", label + "：预检未通过（ZCode 被重新拉起）", False)
            return 1, True, "预检未通过：ZCode 在等待期间被重新拉起，本次已放弃（详见日志）"
        if r.returncode != 0:
            failed += 1
            report("result", label + "：失败", False)
        else:
            report("result", label + "：完成", True)

    # 应用结果回写状态文件：全成功 → pending:false（角标消失）；有失败 → 保持
    # pending:true + 原因（下次 SessionStart 的 sync 会重新评估并覆盖）。
    # ★ 0.6.39 修复：此前写成 _write_status(failed == 0) —— 成功反而写 pending:true，
    #   重启后角标残留（用户实测：拉起时角标还在，过一会儿才消失）。
    _write_status(failed > 0,
                  None if failed == 0 else f"{failed} 项补丁应用失败（详见日志）",
                  phase="完成" if failed == 0 else f"完成（失败 {failed} 项）")

    # 刷新客户端指纹（最佳努力）：重打包改变 asar 尺寸，不刷新的话下一次
    # SessionStart 的 detect_upgrade 会把「我们自己刚做的重打包」误判成客户端
    # 升级，弹一遍「已升级，重新排期」的假通知（0.6.38 实测）。
    report("step", "刷新客户端指纹…")
    try:
        sys.path.insert(0, str(HERE))
        import sync
        sync.refresh_client_fingerprint()
        report("result", "客户端指纹已刷新", None)
    except Exception as e:
        log(f"客户端指纹刷新失败（下次启动可能误报升级）: {e!r}")
        report("result", "指纹刷新失败（下次启动可能误报升级）", None)

    res, exe = resolve_install()
    _cleanup_singletons(cur_pid)
    if exe is None:
        log("未找到 ZCode 主程序（Windows: ZCode.exe / macOS: .app 包内 MacOS/ZCode），请手动启动")
        return 1, True, "未找到 ZCode 主程序，请手动启动 ZCode"
    log(f"处理完成（失败 {failed} 项），重启 ZCode")
    report("step", "正在重新启动 ZCode…")
    if zcode_running():
        log("检测到 ZCode 已再次运行，跳过重启")
        # 退出码对齐模块 docstring（0=成功、1=有项目失败）；有失败项 → 窗口常驻
        return (1 if failed else 0), bool(failed), \
            f"处理完成（失败 {failed} 项）；ZCode 已在运行，跳过重启"
    try:
        if os.name == "nt":
            subprocess.Popen([str(exe)], cwd=str(exe.parent),
                             creationflags=0x00000008)   # DETACHED_PROCESS——保持上游原样，Windows 行为零变化
        elif sys.platform == "darwin" and res is not None and res.parent.parent.suffix == ".app":
            # macOS 经 Launch Services 打开 .app 包。注意 creationflags 是 Windows 专属
            # 参数，POSIX 上传入会直接抛 ValueError，所以必须按平台分流。
            subprocess.Popen(["open", str(res.parent.parent)],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             **no_window_kwargs())
        else:
            subprocess.Popen([str(exe)], cwd=str(exe.parent), start_new_session=True,
                             **no_window_kwargs())
    except Exception as e:
        log(f"重启 ZCode 失败（请手动启动）: {e}")
        return 1, True, "重启 ZCode 失败，请手动启动"
    log("DONE")
    if failed:
        return 1, True, f"完成（失败 {failed} 项），ZCode 已重新启动"
    return 0, False, "完成，ZCode 已重新启动"


def _progress_available() -> bool:
    """tkinter 可用性探测（无 tkinter 的精简解释器上静默降级为无窗模式）。"""
    try:
        import tkinter  # noqa: F401
        return True
    except Exception:
        return False


class _ProgressUI:
    """退出后注入进度的 tkinter 小卡（黑底金字，与「待注入」角标同语言）。

    只在「检测到 ZCode 已退出、开始应用」后出现；成功自动关闭、失败常驻到
    用户点掉。窗口由主线程持有并泵消息（工作线程只经 queue 传文字），
    每个方法都吞异常 —— UI 出任何问题都不能破坏注入主流程。
    """
    DARK = "#141414"
    GOLD = "#e8b339"
    FG = "#d8d8d8"
    OK = "#7bd88f"
    BAD = "#ff8a80"

    def __init__(self, title: str):
        import tkinter as tk
        self._tk = tk
        self.root = tk.Tk()
        self.root.title(title)
        self.root.attributes("-topmost", True)
        self.root.configure(bg=self.DARK)
        self.root.resizable(False, False)
        self.root.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        # 只定位置不定尺寸：窗口随行数自动长高；右下角，像系统通知
        self.root.geometry(f"+{max(sw - 440, 0)}+{max(sh - 360, 0)}")
        self._tk.Label(self.root, text=title, bg=self.DARK, fg=self.GOLD,
                       font=("Microsoft YaHei UI", 11, "bold"),
                       anchor="w").pack(fill="x", padx=14, pady=(12, 6))
        self._body = self._tk.Frame(self.root, bg=self.DARK)
        self._body.pack(fill="both", expand=True, padx=14)
        self._labels: list = []

    def add_step(self, text: str) -> None:
        try:
            lb = self._tk.Label(self._body, text=text, bg=self.DARK, fg=self.FG,
                                font=("Microsoft YaHei UI", 9),
                                anchor="w", justify="left")
            lb.pack(fill="x", pady=1)
            self._labels.append(lb)
        except Exception:
            pass

    def set_last(self, text: str, ok: bool | None = None) -> None:
        try:
            if not self._labels:
                return
            color = self.FG if ok is None else (self.OK if ok else self.BAD)
            self._labels[-1].configure(text=text, fg=color)
        except Exception:
            pass

    def show_close(self) -> None:
        try:
            self._tk.Button(self.root, text="关闭", command=self.root.destroy,
                            bg=self.DARK, fg=self.GOLD, relief="flat",
                            activebackground="#333333", activeforeground=self.GOLD,
                            font=("Microsoft YaHei UI", 9)).pack(pady=(6, 12))
        except Exception:
            pass

    def pump(self) -> None:
        try:
            self.root.update()
        except Exception:
            pass

    def run_until_closed(self) -> None:
        try:
            self.root.mainloop()
        except Exception:
            pass

    def close(self) -> None:
        try:
            self.root.destroy()
        except Exception:
            pass


def _drain(ui: "_ProgressUI | None", q: "queue.Queue") -> None:
    """把工作线程上报的步骤刷进窗口（UI 缺席时丢弃——内容已落日志）。"""
    while True:
        try:
            kind, text, ok = q.get_nowait()
        except queue.Empty:
            return
        if ui is None:
            continue
        if kind == "step":
            ui.add_step(text)
        elif kind == "result":
            ui.set_last(text, ok)


def _run_apply_with_progress(raw_tasks: list, waited: int, cur_pid: int) -> int:
    """应用阶段编排：有 tkinter → 小卡 + 工作线程；没有 → 原样同步执行。

    主线程只持有窗口并泵消息（避免子进程最长 600s 期间窗口「未响应」），
    应用阶段在工作线程跑，步骤经 queue 传回。**无论如何都要等线程跑完才
    退出进程**——窗口被用户提前关掉也不中断注入。
    """
    if not _progress_available():
        code, _, _ = _apply_phase(raw_tasks, waited, cur_pid, lambda *_: None)
        return code
    try:
        ui = _ProgressUI("ZCode 补丁注入")
    except Exception as e:
        log(f"进度窗口创建失败（降级为无窗模式）: {type(e).__name__}: {e}")
        code, _, _ = _apply_phase(raw_tasks, waited, cur_pid, lambda *_: None)
        return code

    q: "queue.Queue" = queue.Queue()
    holder: dict = {}

    def report(kind, text, ok=None):
        try:
            q.put((kind, text, ok))
        except Exception:
            pass

    def runner():
        try:
            holder["r"] = _apply_phase(raw_tasks, waited, cur_pid, report)
        except Exception:
            import traceback
            log("应用阶段异常:\n" + traceback.format_exc())
            holder["r"] = (1, True, "应用阶段异常退出（详见日志）")

    t = threading.Thread(target=runner, daemon=True)
    t.start()
    while t.is_alive():
        try:
            _drain(ui, q)
            ui.pump()
        except Exception:
            pass   # 窗口可能已被用户关掉；继续等线程跑完，绝不中断注入
        time.sleep(0.05)
    try:
        _drain(ui, q)
    except Exception:
        pass

    code, keep_open, close_msg = holder.get(
        "r", (1, False, "应用阶段未返回结果（详见日志）"))
    try:
        ui.add_step(close_msg)
        ui.set_last(close_msg, ok=(code == 0))
        if keep_open:
            ui.show_close()
            ui.run_until_closed()
        else:
            deadline = time.time() + 1.5
            while time.time() < deadline:
                ui.pump()
                time.sleep(0.05)
            ui.close()
    except Exception:
        pass
    return code


def main() -> int:
    import os
    cur_pid = os.getpid()
    if PID_FILE.is_file():
        try:
            old_pid = int(PID_FILE.read_text(encoding="utf-8").strip())
            if old_pid != cur_pid and is_pid_alive(old_pid):
                log(f"已有活跃看护运行中 (PID {old_pid})，已登记最新需求，本实例退出")
                _save_wants(sys.argv[1:])
                return 0
        except Exception:
            pass
    try:
        PID_FILE.write_text(str(cur_pid), encoding="utf-8")
    except Exception:
        pass
    # 跨版本共享锁：其它版本副本的看护还活着 → 合并需求后退出（见 _shared_pid_file）
    other = _shared_watchdog_alive(cur_pid)
    if other:
        log(f"已有活跃看护运行中（共享锁 PID {other}），已登记最新需求，本实例退出")
        _save_wants(sys.argv[1:])
        return 0
    try:
        sp = _shared_pid_file()
        if sp is not None:
            sp.write_text(str(cur_pid), encoding="utf-8")
    except Exception:
        pass
    _save_wants(sys.argv[1:])

    # 预检：如果明确指定了需求但过滤后无待办任务（如仅 reasoning_config=off），直接退出
    early_tasks = parse_wants(sys.argv[1:])
    if early_tasks is not None and not early_tasks:
        log("没有待应用的补丁任务，看护退出，不进行等待与重启")
        _write_status(False)
        _cleanup_singletons(cur_pid)
        return 0

    log(f"看护启动，等待 ZCode 退出 (PID {cur_pid})…")
    waited = 0
    while zcode_running():
        time.sleep(POLL_SEC)
        waited += POLL_SEC
        if waited >= MAX_WAIT_SEC:
            log("等待超时（24h），放弃")
            _write_status(True, "等待超时（24h），补丁仍未写入")
            _cleanup_singletons(cur_pid)
            return 1

    raw_tasks = parse_wants(sys.argv[1:])
    if raw_tasks is None:
        raw_tasks = [(args, False) for args in DEFAULT_TASKS]
    if not raw_tasks:
        log("ZCode 已退出，但检查后无有效补丁任务需要执行，看护完成，不重启 ZCode")
        _write_status(False)
        _cleanup_singletons(cur_pid)
        return 0
    # 应用阶段（0.6.41 起带 tkinter 进度小卡；无 tkinter 时行为与旧版完全一致）
    return _run_apply_with_progress(raw_tasks, waited, cur_pid)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # 看护无人值守：崩溃必须留痕。此前 stderr 被 start_watchdog 定向到 DEVNULL，
        # 崩溃无声 —— 这正是 macOS 上「等退出 0 次」长期没被发现的原因。
        import traceback
        log("看护异常退出:\n" + traceback.format_exc())
        sys.exit(1)
