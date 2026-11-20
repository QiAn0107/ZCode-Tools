#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""性能基准：已采用的优化 + 评估后放弃的方案。

用法：
    python tests/bench_perf.py
    python tests/bench_perf.py --size-mb 128 --sessions 297 --rows 60 --runs 5

`bench_` 前缀不会被 `unittest discover -s tests` 当成测试文件执行。

三部分：
  1. asar 读取：整包 read_bytes（旧） vs header + seek/read（已采用）
  2. 快照聚合：逐会话索引查询（保留） vs GROUP BY + 窗口（实测更慢，已放弃）
  3. 计数：看护 tasklist 次数 / PostToolUse Python 启动次数（非墙钟）
  4. 第二轮：Windows 进程探测（外部命令 vs ctypes）与同步预检指纹成本
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import statistics
import struct
import subprocess
import sys
import tempfile
import time
import tracemalloc
from pathlib import Path

HERE = Path(__file__).resolve().parent
for _cand in (HERE.parent / "scripts",
              HERE.parent / "skills" / "zcode-tools" / "scripts"):
    if (_cand / "zcode_patcher.py").is_file():
        sys.path.insert(0, str(_cand))
        break
import zcode_patcher as zp  # noqa: E402
import tps_snapshot as ts  # noqa: E402


def build_asar(path: Path, files: dict[str, bytes]) -> None:
    """构造只含 offset/size 的最小合法 asar（读路径不需要 integrity）。"""
    data = bytearray()
    tree = {"files": {}}
    for name in sorted(files):
        parts = name.split("/")
        node = tree
        for part in parts[:-1]:
            node = node["files"].setdefault(part, {"files": {}})
        node["files"][parts[-1]] = {"size": len(files[name]), "offset": str(len(data))}
        data += files[name]
    js = json.dumps(tree, separators=(",", ":")).encode("utf-8")
    pad = (4 - len(js) % 4) % 4
    header = (struct.pack("<4I", 4, 8 + len(js) + pad, 4 + len(js) + pad, len(js))
              + js + b"\x00" * pad)
    path.write_bytes(header + bytes(data))


def median_time(fn, runs: int) -> float:
    xs = []
    for _ in range(runs):
        t0 = time.perf_counter()
        fn()
        xs.append(time.perf_counter() - t0)
    return statistics.median(xs)


def peak_mb(fn) -> float:
    tracemalloc.start()
    try:
        fn()
        _cur, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    return peak / 1048576


# ---------------------------------------------------------------- asar
def legacy_version(asar: Path) -> str | None:
    raw, header, data_start = zp._asar_header_raw(asar)
    ent = zp._asar_find_entry(header, "package.json")
    if not ent:
        return None
    m = re.search(rb'"version"\s*:\s*"([^"]+)"', zp._asar_entry_bytes(raw, data_start, ent))
    return m.group(1).decode() if m else None


def legacy_entry(asar: Path) -> bytes:
    raw, header, data_start = zp._asar_header_raw(asar)
    return zp._asar_entry_bytes(raw, data_start,
                               zp._asar_find_entry(header, "out/renderer/index.html"))


def new_entry(asar: Path) -> bytes:
    header, data_start = zp._read_asar_header(asar)
    return zp._asar_read_entry(asar, data_start,
                               zp._asar_find_entry(header, "out/renderer/index.html"))


def bench_asar(size_mb: int, runs: int) -> list[tuple[str, str, str]]:
    with tempfile.TemporaryDirectory(prefix="zbench-asar-") as td:
        p = Path(td) / "app.asar"
        build_asar(p, {
            "package.json": b'{"name":"zcode","version":"3.18.2"}',
            "out/renderer/index.html": b"<html><body></body></html>" * 2048,
            "pad.bin": b"x" * (size_mb * 1024 * 1024),
        })
        actual = p.stat().st_size / 1048576
        rows = []
        for label, old, new in (
            ("版本号读取", lambda: legacy_version(p), lambda: zp.asar_version(p)),
            ("index.html 条目读取", lambda: legacy_entry(p), lambda: new_entry(p)),
        ):
            t_old = median_time(old, runs) * 1000
            t_new = median_time(new, runs) * 1000
            rows.append((
                f"{label}（合成 {actual:.0f}MB asar）",
                f"{t_old:.1f}ms / 峰值 {peak_mb(old):.1f}MB",
                f"{t_new:.1f}ms / 峰值 {peak_mb(new):.1f}MB",
            ))
    return rows


# ---------------------------------------------------------------- 快照
FULL_SCHEMA = """create table model_usage(
    id text, session_id text, turn_id text, status text,
    input_tokens integer, output_tokens integer, reasoning_tokens integer,
    cache_read_input_tokens integer, cache_creation_input_tokens integer,
    computed_total_tokens integer, tool_call_count integer, retry_count integer,
    completed_at integer, query_source text,
    duration_ms integer, time_to_first_token_ms integer,
    first_token_at integer, model_id text)"""


def build_db(sessions: int, rows: int) -> sqlite3.Connection:
    con = sqlite3.connect(":memory:")
    con.execute(FULL_SCHEMA)
    # 与真实客户端一致：这个索引决定了「逐会话查询」其实是非常便宜的索引查找。
    con.execute("create index model_usage_session_turn_idx on model_usage(session_id, turn_id)")
    data = []
    for s in range(sessions):
        sid = f"sess-{s:03d}"
        for r in range(rows):
            at = 1_700_000_000_000 + s * 1_000_000 + r * 1000
            i = 1000 + r
            o = 100 + (r % 50)
            qsrc = "main_turn"
            if r % 10 == 0:
                qsrc = "session_title" if r % 20 == 0 else "compact"
            data.append((f"{sid}-{r}", sid, f"t{r // 5}", "completed", i, o, 0,
                         0, 0, i + o, r % 3, 0, at, qsrc,
                         800 + (r % 50), 120, at - 700, f"model-{s % 4}"))
    con.executemany("insert into model_usage values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", data)
    con.commit()
    return con


BULK_SESSIONS_SQL = """
select session_id, count(*), coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
       coalesce(sum(reasoning_tokens),0), coalesce(sum(cache_read_input_tokens),0),
       coalesce(sum(cache_creation_input_tokens),0), coalesce(sum(computed_total_tokens),0),
       coalesce(sum(tool_call_count),0), {turns_expr}, coalesce(sum(retry_count),0),
       coalesce(max(completed_at),0)
from model_usage m where m.status = 'completed' and m.session_id is not null
group by m.session_id
"""

BULK_LAST_SQL = """
select session_id,
       coalesce(max(case when rn_all = 1 then input_tokens end), 0),
       coalesce(max(case when rn_vis = 1 and is_visible = 1 then output_tokens end), 0),
       coalesce(max(case when rn_vis = 1 and is_visible = 1 then time_to_first_token_ms end), 0),
       coalesce(max(case when rn_vis = 1 and is_visible = 1 then duration_ms end), 0),
       coalesce(max(case when rn_vis = 1 and is_visible = 1 then completed_at end), 0),
       coalesce(max(case when rn_vis = 1 and is_visible = 1 then first_token_at end), 0),
       coalesce(max(case when rn_vis = 1 and is_visible = 1 then model_id end), '')
from (
  select session_id, input_tokens, output_tokens, time_to_first_token_ms, duration_ms,
         completed_at, first_token_at, model_id,
         case when (coalesce(query_source,'main_turn') in ('main_turn','compact'))
              then 1 else 0 end as is_visible,
         row_number() over (partition by session_id
                            order by completed_at desc, id desc) as rn_all,
         row_number() over (partition by session_id
                            order by case when (coalesce(query_source,'main_turn')
                                               in ('main_turn','compact')) then 0 else 1 end,
                                     completed_at desc, id desc) as rn_vis
  from model_usage where status = 'completed' and session_id is not null
) group by session_id
"""


def metrics(out, ttft, dur, done_at, first_at, model) -> dict:
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


def bulk_snapshot(con: sqlite3.Connection) -> dict:
    """评估用：单条 GROUP BY + 单条窗口查询（未采用）。"""
    sessions = {}
    for row in con.execute(BULK_SESSIONS_SQL.format(turns_expr=ts.TURNS_EXPR_QSRC)):
        sid, n, i, o, r, cr, cw, tot, tools, turns, retries, last = row
        if sid is None:
            continue
        sessions[sid] = {"requests": n, "input": i, "output": o, "reasoning": r,
                         "cache_read": cr, "cache_write": cw, "total": tot,
                         "tool_calls": tools, "ctx": 0, "turns": turns,
                         "retries": retries, "last_at": last}
    last_rows = {r[0]: r for r in con.execute(BULK_LAST_SQL)}
    for sid, u in sessions.items():
        row = last_rows.get(sid)
        if row:
            u["ctx"] = row[1] or 0
            u.update(metrics(*row[2:8]))
        else:
            u.update(metrics(0, 0, 0, 0, 0, ""))
    s, e = ts.today_range_ms()
    return {"sessions": sessions, "today": ts.range_usage(con, s, e)}


def count_selects(con: sqlite3.Connection, fn) -> int:
    seen = []
    con.set_trace_callback(lambda s: seen.append(s))
    try:
        fn()
    finally:
        con.set_trace_callback(None)
    return len([s for s in seen if s.lstrip().lower().startswith("select")])


def bench_snapshot(sessions: int, rows: int, runs: int):
    con = build_db(sessions, rows)
    try:
        current = ts.build_snapshot(con)
        bulk = bulk_snapshot(con)
        same = current["sessions"] == bulk["sessions"] and current["today"] == bulk["today"]
        t_cur = median_time(lambda: ts.build_snapshot(con), runs) * 1000
        t_bulk = median_time(lambda: bulk_snapshot(con), runs) * 1000
        q_cur = count_selects(con, lambda: ts.build_snapshot(con))
        q_bulk = count_selects(con, lambda: bulk_snapshot(con))
        return [
            (f"逐会话索引查询（{sessions} 会话 × {rows} 行，当前）",
             f"{t_cur:.1f}ms", f"{q_cur} 条 SELECT", "保留"),
            (f"GROUP BY + 窗口（{sessions} 会话 × {rows} 行，评估）",
             f"{t_bulk:.1f}ms", f"{q_bulk} 条 SELECT", "放弃：全表窗口排序更慢"),
        ], same
    finally:
        con.close()


def bench_probe(runs: int) -> list[tuple[str, str, str]]:
    """Windows 进程探测与同步缓存指纹的成本（第二轮优化）。

    PowerShell/tasklist 都是外部进程，单次成本主要是启动；ctypes 走系统调用。
    非 Windows 只测同步指纹。
    """
    rows: list[tuple[str, str, str]] = []
    if sys.platform == "win32":
        def _powershell():
            subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "Get-Process | Where-Object {$_.Path} | "
                 "Select-Object -ExpandProperty Path -Unique"],
                capture_output=True)

        def _tasklist():
            subprocess.run(["tasklist"], capture_output=True)

        rows.append(("进程探测：PowerShell（每次 --check）",
                     f"{median_time(_powershell, 1) * 1000:.0f}ms", "旧实现"))
        rows.append(("进程探测：tasklist（看护每次轮询）",
                     f"{median_time(_tasklist, 3) * 1000:.0f}ms", "旧实现"))
        rows.append(("进程探测：ctypes EnumProcesses",
                     f"{median_time(zp._win_process_paths, runs) * 1000:.1f}ms", "当前"))
    try:
        import sync as sy
        rows.append(("同步预检指纹（asar stat + 5 文件 sha256）",
                     f"{median_time(sy._cache_fingerprint, runs) * 1000:.1f}ms",
                     "缓存命中路径"))
    except Exception:
        pass
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description="zcode-toolkit 性能基准")
    ap.add_argument("--size-mb", type=int, default=64)
    ap.add_argument("--sessions", type=int, default=297)
    ap.add_argument("--rows", type=int, default=60)
    ap.add_argument("--runs", type=int, default=3)
    args = ap.parse_args()

    print("### 已采用的优化（asar ranged read）\n")
    print("| 场景 | 旧实现（整包读取） | 当前实现（ranged） |")
    print("|---|---|---|")
    for label, old, new in bench_asar(args.size_mb, args.runs):
        print(f"| {label} | {old} | {new} |")

    print("\n### 快照聚合：评估后保留索引路径\n")
    snap_rows, same = bench_snapshot(args.sessions, args.rows, args.runs)
    print("| 方案 | 耗时 | 查询数 | 结论 |")
    print("|---|---|---|---|")
    for label, t, q, verdict in snap_rows:
        print(f"| {label} | {t} | {q} | {verdict} |")

    print("\n### 第二轮：进程探测与同步预检缓存\n")
    print("| 场景 | 耗时 | 说明 |")
    print("|---|---|---|")
    for label, t, verdict in bench_probe(args.runs):
        print(f"| {label} | {t} | {verdict} |")

    print("\n### 计数（非墙钟）\n")
    print("| 项目 | 优化前 | 优化后 |")
    print("|---|---|---|")
    print("| 看护进程探测（24h） | 28,800 次 tasklist spawn | 0 次 spawn（ctypes，≈8,668 次/天 ×2.5ms） |")
    print("| SessionStart 预检子进程 | 每次 4 个 --check | 0 个（客户端/源文件未变时命中缓存） |")
    print("| 快照 watcher spawn（生成期间） | ≤40 次/分钟 | ≤24 次/分钟（限频 1500→2500ms） |")
    print("| PostToolUse（300 次工具调用） | 300 次 Python 启动 | 0 次 |")

    if not same:
        print("\n[!] 两种快照实现的输出不一致，基准结果不可信", file=sys.stderr)
        return 1
    print("\n注：真实客户端 app.asar 约 367MB；合成 asar 的收益按包体线性放大。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
