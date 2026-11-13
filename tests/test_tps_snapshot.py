#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tps_snapshot.py 口径回归：用内存库造表，真跑聚合函数。

锁死从 xhwxt/zcode-token-usage-statusbar (MIT) 移植的口径：
  ① 只计 status='completed'；② 合计=computed_total(=input+output)；
  ③ cache_read 已含在 input 内，不重复加；④ 命中率=cache_read/input；
  ⑤ turn_usage 缺失时按 model_usage 现场聚合（本实现直接查 model_usage，
     与 turn_usage 自洽，见 docstring）。
"""

import sqlite3
import sys
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
for _cand in (_HERE.parent / "scripts",
              _HERE.parent / "skills" / "zcode-tools" / "scripts"):
    if (_cand / "tps_snapshot.py").is_file():
        sys.path.insert(0, str(_cand))
        break
import tps_snapshot as ts  # noqa: E402


class TpsSnapshotTestBase(unittest.TestCase):
    SID = "sess-test-0001"

    def setUp(self):
        self.con = sqlite3.connect(":memory:")
        self.con.execute("""create table model_usage(
            id text, session_id text, turn_id text, status text,
            input_tokens integer, output_tokens integer, reasoning_tokens integer,
            cache_read_input_tokens integer, cache_creation_input_tokens integer,
            computed_total_tokens integer, tool_call_count integer, retry_count integer,
            completed_at integer)""")
        self.addCleanup(self.con.close)

    def add(self, turn, status, i, o, r=0, cr=0, cw=0, at=1000, tools=0, retries=0):
        self.con.execute(
            "insert into model_usage values (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (f"id-{turn}-{at}", self.SID, turn, status, i, o, r, cr, cw,
             i + o, tools, retries, at))
        self.con.commit()


class TestSessionUsage(TpsSnapshotTestBase):

    def test_completed_only(self):
        """非 completed 行不计入（cancelled/error 无部分用量）。"""
        self.add("t1", "completed", 100, 10)
        self.add("t1", "cancelled", 999, 999)
        self.add("t2", "error", 888, 888)
        u = ts.session_usage(self.con, self.SID)
        self.assertEqual(u["requests"], 1)
        self.assertEqual(u["input"], 100)
        self.assertEqual(u["output"], 10)
        self.assertEqual(u["total"], 110)

    def test_total_is_input_plus_output(self):
        """合计=computed_total=Σ(input+output)，cache 不重复加。"""
        self.add("t1", "completed", 1000, 50, cr=800)
        self.add("t1", "completed", 2000, 60, cr=1500)
        u = ts.session_usage(self.con, self.SID)
        self.assertEqual(u["input"], 3000)
        self.assertEqual(u["cache_read"], 2300)
        self.assertEqual(u["total"], 3110)   # 不是 3000+110+2300

    def test_ctx_is_latest_not_max(self):
        """ctx 取最近一次 completed 的 input，不是 max（压缩后会回落）。"""
        self.add("t1", "completed", 50000, 10, at=1000)
        self.add("t2", "completed", 3000, 10, at=2000)   # 压缩后骤降
        u = ts.session_usage(self.con, self.SID)
        self.assertEqual(u["ctx"], 3000)

    def test_turns_distinct(self):
        self.add("t1", "completed", 10, 1)
        self.add("t1", "completed", 10, 1)
        self.add("t2", "completed", 10, 1)
        u = ts.session_usage(self.con, self.SID)
        self.assertEqual(u["requests"], 3)
        self.assertEqual(u["turns"], 2)

    def test_empty_session_zero(self):
        u = ts.session_usage(self.con, "sess-nobody")
        self.assertEqual(u["requests"], 0)
        self.assertEqual(u["total"], 0)
        self.assertEqual(u["ctx"], 0)


class TestRangeUsage(TpsSnapshotTestBase):

    def test_range_bounds(self):
        self.add("t1", "completed", 100, 10, at=1000)
        self.add("t2", "completed", 200, 20, at=2000)
        self.add("t3", "completed", 400, 40, at=3000)
        u = ts.range_usage(self.con, 1500, 2500)
        self.assertEqual(u["requests"], 1)
        self.assertEqual(u["total"], 220)


class TestBuildSnapshot(TpsSnapshotTestBase):

    def test_skips_empty_sessions(self):
        """无 completed 行的会话不进快照。"""
        self.add("t1", "completed", 10, 1)
        snap = ts.build_snapshot(self.con)
        self.assertIn(self.SID, snap["sessions"])
        self.assertEqual(snap["v"], ts.SNAPSHOT_VERSION)
        self.assertIn("today", snap)
        self.assertIn("stamp", snap)


if __name__ == "__main__":
    unittest.main()
