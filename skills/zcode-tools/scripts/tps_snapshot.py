#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TPS 状态栏用量快照：把 SQLite 落库值聚合成渲染层可读的 JSON。

数据源与口径移植自 xhwxt/zcode-token-usage-statusbar (MIT License,
Copyright (c) 2026 xhwx)：只读 ~/.zcode/cli/db/db.sqlite 的 model_usage /
turn_usage，只计 status='completed'；合计用 computed_total(=input+output)，
cache_read 已含在 input 内不重复加；命中率=cache_read/input。

本脚本只做"结算层"快照（精确值、天然全历史）；流式实时层（首 token /
tok/s / 输出估算）仍由 zcode-tps.js 的 ServicePort 事件流承担。两层在
渲染侧以 Math.max 合并，事件优先、快照补漏。0.6.42 起会话快照额外携带
最近一次 completed 请求的权威 tok/s / 首token 毫秒（last_tps/last_ttft_ms，
口径见 _last_request_metrics），供渲染层在事件漏采或缺值时兜底校准；
快照重建的主力是注入到 main 的 watcher：fs.watch 库目录变化 → spawn 本脚本
--quiet 重算 → 经 zcode:tps-push 主动推给渲染层；SessionStart / Stop 钩子
再补会话启动与轮末两次。PostToolUse 钩子已移除（每次工具调用起 Python 的代价
大于收益，回合内刷新由 watcher 的 1.5s 限频 + 30s 心跳覆盖）。

用法（均为只读 DB，失败静默返回非零）：
    python tps_snapshot.py                 # 全量快照 -> <v2>/ztps-snapshot.json
    python tps_snapshot.py --sid <id>      # 仅查一个会话（stdout JSON，不写文件）
    python tps_snapshot.py --check         # 只读探针：库存在/表结构/行数
    python tps_snapshot.py --min-age 30    # 快照 30s 内已刷新过则跳过（手动调用节流）
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
SNAPSHOT_VERSION = 2

SESSION_SQL = """
select count(*), coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
       coalesce(sum(reasoning_tokens),0), coalesce(sum(cache_read_input_tokens),0),
       coalesce(sum(cache_creation_input_tokens),0), coalesce(sum(computed_total_tokens),0),
       coalesce(sum(tool_call_count),0),
       (select m2.input_tokens from model_usage m2
         where m2.session_id = m.session_id and m2.status = 'completed'
         order by m2.completed_at desc, m2.id desc limit 1),
       {turns_expr}, coalesce(sum(retry_count),0),
       coalesce(max(completed_at),0)
from model_usage m where m.session_id = ? and m.status = 'completed'
"""

# 轮数口径：只数「真实用户轮」。上下文压缩会把一个可见轮拆成两个 turn_id——续接段
# 是新 turn_id 且整段 query_source='compact'、parent 为 NULL，用户在转录里根本看
# 不到新轮块（事件层按 DOM 可见 section 计数也不会数它），但 distinct turn_id 会
# 把它 +1（用户实测：可见 8 轮显示 9轮）。所以轮数只认含 main_turn 行的 turn_id；
# session_title/git_commit_message/subagent 等隐藏请求若独立成 turn 同样不算轮。
# steps 不受影响：compact 续接的请求是真实计费请求，照常计入。
TURNS_EXPR_QSRC = ("count(distinct case when coalesce(m.query_source,'main_turn')='main_turn' "
                   "then m.turn_id end)")
# 老库（无 query_source 列）：全部按真实轮计（与 0.6.36 及之前行为一致）。
TURNS_EXPR_PLAIN = "count(distinct turn_id)"


def _has_query_source(con: sqlite3.Connection) -> bool:
    try:
        cols = [r[1] for r in con.execute("PRAGMA table_info(model_usage)")]
        return "query_source" in cols
    except sqlite3.Error:
        return False

RANGE_SQL = """
select count(*), coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
       coalesce(sum(reasoning_tokens),0), coalesce(sum(cache_read_input_tokens),0),
       coalesce(sum(cache_creation_input_tokens),0), coalesce(sum(computed_total_tokens),0),
       coalesce(sum(tool_call_count),0)
from model_usage where status = 'completed' and completed_at >= ? and completed_at < ?
"""

# 最新一条 completed 请求的权威指标（0.6.42 移植自参考实现的 TPS 口径）。
# 可见性过滤（{qsrc_expr}）：session_title/git_commit_message/subagent 是用户看不到的
# 隐藏请求（实测一session 的最后落库行是标题生成：102 tok @16 tok/s，拿它兜底会显示
# 「标题速度」），只认 main_turn/compact（compact 续接是用户可见的同轮内容）；
# 老库无 query_source 列时不过滤（与轮数口径的降级一致）。
LAST_REQ_SQL = """
select coalesce(output_tokens,0), coalesce(time_to_first_token_ms,0), coalesce(duration_ms,0),
       coalesce(completed_at,0), coalesce(first_token_at,0), {model_expr}
from model_usage where session_id = ? and status = 'completed' {qsrc_expr}
order by completed_at desc, id desc limit 1
"""


def _probe_cols(con: sqlite3.Connection) -> list[str]:
    try:
        return [r[1] for r in con.execute("PRAGMA table_info(model_usage)")]
    except sqlite3.Error:
        return []


def _last_request_metrics(con: sqlite3.Connection, sid: str, cols: list[str]) -> dict:
    """最近一次 completed 请求的 tok/s 与首 token 毫秒（事件层的权威兜底值）。

    口径移植自 xhwxt/zcode-token-usage-statusbar：生成耗时 = completed_at −
    first_token_at（缺 first_token_at 时退化为 duration_ms），tps = output /
    (gen_ms/1000)。gen_ms <100ms 或输出为 0 记 0（分母过小时数值不可信，渲染层
    只把它当"事件层缺值/漏采"时的兜底，不会覆盖事件层有值的情况）。
    老库缺列（无 time_to_first_token_ms/duration_ms）时全部记 0。
    选取范围只认用户可见的请求（main_turn/compact，剔除 session_title/subagent
    等隐藏请求——最后落库行常是标题生成，拿它兜底会显示「标题速度」）。
    """
    zeros = {"last_tps": 0, "last_ttft_ms": 0, "last_out": 0,
             "last_completed_at": 0, "last_model_id": ""}
    if not {"time_to_first_token_ms", "duration_ms"}.issubset(cols):
        return zeros
    model_expr = "coalesce(model_id,'')" if "model_id" in cols else "''"
    qsrc_expr = ("and coalesce(query_source,'main_turn') in ('main_turn','compact')"
                 if "query_source" in cols else "")
    row = con.execute(LAST_REQ_SQL.format(model_expr=model_expr, qsrc_expr=qsrc_expr),
                      (sid,)).fetchone()
    if not row:
        return zeros
    out, ttft, dur, done_at, first_at, model = row
    tps = 0.0
    if out:
        gen_ms = None
        if first_at and done_at and done_at > first_at:
            gen_ms = done_at - first_at
        elif dur:
            gen_ms = dur
        if gen_ms and gen_ms >= 100:
            tps = round(out / (gen_ms / 1000), 1)
    return {"last_tps": tps, "last_ttft_ms": ttft or 0, "last_out": out,
            "last_completed_at": done_at or 0, "last_model_id": model or ""}


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


def session_usage(con: sqlite3.Connection, sid: str, has_qsrc: bool | None = None,
                  cols: list[str] | None = None) -> dict:
    if has_qsrc is None:
        has_qsrc = _has_query_source(con)
    expr = TURNS_EXPR_QSRC if has_qsrc else TURNS_EXPR_PLAIN
    row = con.execute(SESSION_SQL.format(turns_expr=expr), (sid,)).fetchone()
    (n, i, o, r, cr, cw, tot, tools, ctx, turns, retries, last) = row
    u = {"requests": n, "input": i, "output": o, "reasoning": r,
         "cache_read": cr, "cache_write": cw, "total": tot,
         "tool_calls": tools, "ctx": ctx or 0, "turns": turns,
         "retries": retries, "last_at": last}
    u.update(_last_request_metrics(con, sid, cols if cols is not None else _probe_cols(con)))
    return u


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
    """全量快照：全部有 completed 行的会话 + 今日全局。

    保留逐会话查询：客户端 DB 有 (session_id, turn_id) 索引，每个会话的
    SESSION_SQL/LAST_REQ_SQL 都是索引查找（实测 297 会话 ≈59ms）。曾尝试
    单条 GROUP BY + 窗口批量查询，查询数从 594 降到 3，但两次全表窗口排序
    反而要 ≈108ms —— 因此不采用（见 PERFORMANCE.md 的实测记录）。
    """
    if sids is None:
        sids = [r[0] for r in con.execute(
            "select distinct session_id from model_usage where status='completed'")]
    has_qsrc = _has_query_source(con)  # PRAGMA 只探一次，不逐会话重复
    cols = _probe_cols(con)
    sessions = {}
    for sid in sids:
        u = session_usage(con, sid, has_qsrc, cols)
        if u["requests"] > 0:
            sessions[sid] = u
    s, e = today_range_ms()
    return {"v": SNAPSHOT_VERSION, "stamp": int(time.time() * 1000),
            "sessions": sessions, "today": range_usage(con, s, e)}


def snapshot_path() -> Path:
    return resolve_v2_root() / SNAPSHOT_NAME


def snapshot_fresh(dest: Path, min_age_s: int) -> bool:
    """快照文件存在且 mtime 距今不足 min_age_s 秒 → 视为仍新。

    手动/兜底调用的节流快路径：只 stat 一次文件；快照仍新时连 setting.json
    与 DB 都不碰。回合内的自动刷新由 main watcher 负责，不依赖本函数。
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
                    help="快照文件距今不足 SEC 秒则直接跳过（手动调用节流，避免重复读 DB）")
    args = ap.parse_args(argv)
    quiet = quiet or args.quiet
    safe_stdio()

    def say(msg: str) -> None:
        if not quiet:
            print(msg)

    # 节流快路径：只 stat 一次文件，不碰 DB。--check/--sid 是显式查询，不受节流限制。
    # 放在 resolve_cli_db() 之前：命中时连 setting.json 都不用解析。
    if (args.min_age > 0 and not args.check and not args.sid
            and snapshot_fresh(snapshot_path(), args.min_age)):
        say(f"[.] 快照仍新（<{args.min_age}s），跳过刷新")
        return 0
    db = Path(args.db) if args.db else resolve_cli_db()
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
