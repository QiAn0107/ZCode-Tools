#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TPS 状态栏用量快照：把 SQLite 落库值聚合成渲染层可读的 JSON。

数据源与口径移植自 xhwxt/zcode-token-usage-statusbar (MIT License,
Copyright (c) 2026 xhwx)：只读 ~/.zcode/cli/db/db.sqlite 的 model_usage /
turn_usage，只计 status='completed'；合计用 computed_total(=input+output)，
cache_read 已含在 input 内不重复加；命中率=cache_read/input。

本脚本只做"结算层"快照（精确值、天然全历史）；流式实时层（首 token /
tok/s / 输出估算）仍由 zcode-tps.js 的 ServicePort 事件流承担。两层在
渲染侧以 Math.max 合并，事件优先、快照补漏。

用法（均为只读 DB，失败静默返回非零）：
    python tps_snapshot.py                 # 全量快照 -> <v2>/ztps-snapshot.json
    python tps_snapshot.py --sid <id>      # 仅查一个会话（stdout JSON，不写文件）
    python tps_snapshot.py --check         # 只读探针：库存在/表结构/行数
    python tps_snapshot.py --min-age 30    # 快照 30s 内已刷新过则跳过（PostToolUse 节流）
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
try:
    from _console import safe_stdio
except ImportError:
    sys.path.insert(0, str(HERE))
    from _console import safe_stdio

SNAPSHOT_NAME = "ztps-snapshot.json"
SNAPSHOT_VERSION = 1

SESSION_SQL = """
select count(*), coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
       coalesce(sum(reasoning_tokens),0), coalesce(sum(cache_read_input_tokens),0),
       coalesce(sum(cache_creation_input_tokens),0), coalesce(sum(computed_total_tokens),0),
       coalesce(sum(tool_call_count),0),
       (select m2.input_tokens from model_usage m2
         where m2.session_id = m.session_id and m2.status = 'completed'
         order by m2.completed_at desc, m2.id desc limit 1),
       count(distinct turn_id), coalesce(sum(retry_count),0),
       coalesce(max(completed_at),0)
from model_usage m where m.session_id = ? and m.status = 'completed'
"""

RANGE_SQL = """
select count(*), coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
       coalesce(sum(reasoning_tokens),0), coalesce(sum(cache_read_input_tokens),0),
       coalesce(sum(cache_creation_input_tokens),0), coalesce(sum(computed_total_tokens),0),
       coalesce(sum(tool_call_count),0)
from model_usage where status = 'completed' and completed_at >= ? and completed_at < ?
"""


def resolve_cli_db() -> Path:
    """CLI 库路径：<base>/.zcode/cli/db/db.sqlite（base 服从 dataBaseDir）。"""
    base = Path.home()
    try:
        s = json.loads((base / ".zcode" / "v2" / "setting.json").read_text(encoding="utf-8"))
        dbd = s.get("dataBaseDir")
        if isinstance(dbd, str) and dbd.strip():
            base = Path(dbd.strip())
    except Exception:
        pass
    return base / ".zcode" / "cli" / "db" / "db.sqlite"


def resolve_v2_root() -> Path:
    base = Path.home()
    try:
        s = json.loads((base / ".zcode" / "v2" / "setting.json").read_text(encoding="utf-8"))
        dbd = s.get("dataBaseDir")
        if isinstance(dbd, str) and dbd.strip():
            base = Path(dbd.strip())
    except Exception:
        pass
    return base / ".zcode" / "v2"


def connect_ro(db: Path) -> sqlite3.Connection:
    """只读连接优先；WAL shm 不可用时退回普通连接（全程只 SELECT）。"""
    if not db.is_file():
        raise FileNotFoundError(f"db not found: {db}")
    try:
        con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True, timeout=3)
        con.execute("select 1 from model_usage limit 1").fetchone()
        return con
    except sqlite3.OperationalError:
        con = sqlite3.connect(str(db), timeout=3)
        con.execute("PRAGMA query_only=ON")
        return con


def session_usage(con: sqlite3.Connection, sid: str) -> dict:
    row = con.execute(SESSION_SQL, (sid,)).fetchone()
    (n, i, o, r, cr, cw, tot, tools, ctx, turns, retries, last) = row
    return {"requests": n, "input": i, "output": o, "reasoning": r,
            "cache_read": cr, "cache_write": cw, "total": tot,
            "tool_calls": tools, "ctx": ctx or 0, "turns": turns,
            "retries": retries, "last_at": last}


def range_usage(con: sqlite3.Connection, start_ms: int, end_ms: int) -> dict:
    row = con.execute(RANGE_SQL, (start_ms, end_ms)).fetchone()
    (n, i, o, r, cr, cw, tot, tools) = row
    return {"requests": n, "input": i, "output": o, "reasoning": r,
            "cache_read": cr, "cache_write": cw, "total": tot, "tool_calls": tools}


def today_range_ms() -> tuple[int, int]:
    now = datetime.now()
    start = datetime(now.year, now.month, now.day)
    end_ms = int(start.timestamp() * 1000) + 24 * 3600 * 1000
    return int(start.timestamp() * 1000), end_ms


def build_snapshot(con: sqlite3.Connection, sids: list[str] | None = None) -> dict:
    """全量快照：全部有 completed 行的会话 + 今日全局。"""
    if sids is None:
        sids = [r[0] for r in con.execute(
            "select distinct session_id from model_usage where status='completed'")]
    sessions = {}
    for sid in sids:
        u = session_usage(con, sid)
        if u["requests"] > 0:
            sessions[sid] = u
    s, e = today_range_ms()
    return {"v": SNAPSHOT_VERSION, "stamp": int(time.time() * 1000),
            "sessions": sessions, "today": range_usage(con, s, e)}


def snapshot_path() -> Path:
    return resolve_v2_root() / SNAPSHOT_NAME


def snapshot_fresh(dest: Path, min_age_s: int) -> bool:
    """快照文件存在且 mtime 距今不足 min_age_s 秒 → 视为仍新。

    PostToolUse 钩子的节流快路径：长回合（agent 连续跑几百步工具调用）中途
    Stop 钩子不会触发，快照会冻在回合开始值，「今日总耗」也就一直停在旧值
    （用户实测：官方用量页 15.9M、状态栏 9m）。PostToolUse 每次工具调用都
    跑本脚本，但只有快照超过 min_age 秒才真正读 DB 重写，其余情况秒退。
    """
    try:
        return (time.time() - dest.stat().st_mtime) < min_age_s
    except OSError:
        return False


def write_snapshot(snap: dict, dest: Path | None = None) -> Path:
    dest = dest or snapshot_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(dest.parent), prefix=".ztps-snap-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, dest)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return dest


def main(argv: list[str] | None = None, quiet: bool = False) -> int:
    ap = argparse.ArgumentParser(description="TPS 用量快照（只读 DB，写 JSON）")
    ap.add_argument("--sid", default=None, help="仅查一个会话，stdout 输出 JSON")
    ap.add_argument("--check", action="store_true", help="只读探针")
    ap.add_argument("--db", default=None, help="覆盖 db 路径（测试用）")
    ap.add_argument("--quiet", action="store_true",
                    help="静默（钩子调用时用：stdout 非 JSON 会被判钩子失败）")
    ap.add_argument("--min-age", type=int, default=0, metavar="SEC",
                    help="快照文件距今不足 SEC 秒则直接跳过（PostToolUse 节流，避免高频重读 DB）")
    args = ap.parse_args(argv)
    quiet = quiet or args.quiet
    safe_stdio()
    db = Path(args.db) if args.db else resolve_cli_db()

    def say(msg: str) -> None:
        if not quiet:
            print(msg)

    # 节流快路径：只 stat 一次文件，不碰 DB。--check/--sid 是显式查询，不受节流限制。
    if (args.min_age > 0 and not args.check and not args.sid
            and snapshot_fresh(snapshot_path(), args.min_age)):
        say(f"[.] 快照仍新（<{args.min_age}s），跳过刷新")
        return 0
    try:
        con = connect_ro(db)
    except Exception as e:
        say(f"[!] 读不到用量库 {db}: {e}")
        # 钩子模式（--quiet）不得以非零码退出：那会被判为钩子失败并在每轮刷错误日志
        return 0 if quiet else 1
    try:
        if args.check:
            tables = [r[0] for r in con.execute(
                "select name from sqlite_master where type='table' order by name")]
            need = {"model_usage", "turn_usage"}
            say(f"db={db} size={db.stat().st_size}")
            say(f"tables: {','.join(tables)}")
            if not need.issubset(tables):
                say(f"[!] 缺表: {sorted(need - set(tables))}")
                return 1
            n = con.execute("select count(*) from model_usage where status='completed'").fetchone()[0]
            say(f"model_usage completed rows: {n}")
            return 0
        if args.sid:
            # --sid 是查询模式：stdout 就是返回值，不受 quiet 影响
            print(json.dumps(session_usage(con, args.sid), ensure_ascii=False))
            return 0
        snap = build_snapshot(con)
        dest = write_snapshot(snap)
        say(f"[+] 快照已写 {dest}（{len(snap['sessions'])} 会话，今日 {snap['today']['total']} tok）")
        return 0
    except Exception as e:
        say(f"[!] 快照失败: {e!r}")
        return 0 if quiet else 1
    finally:
        try:
            con.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
