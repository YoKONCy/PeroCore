"""SA-PPR 闭式 oracle 的集成测试（需要真实 TriviumDB 绑定）。"""

from __future__ import annotations

import importlib.util

import pytest

from infos_eval.benchmarks.graph_oracle import (
    builtin_graph_oracle_cases,
    run_graph_oracle_case,
)

pytestmark = pytest.mark.skipif(
    importlib.util.find_spec("triviumdb") is None,
    reason="当前环境未安装TriviumDB Python绑定",
)


@pytest.mark.parametrize("case", builtin_graph_oracle_cases(), ids=lambda c: c.name)
def test_TDB_SA_PPR与闭式oracle对齐(case, tmp_path):
    results = run_graph_oracle_case(case, artifact_dir=tmp_path / "index")

    for result in results:
        assert result.ranking_match, (
            f"用例 {case.name} 排名与 oracle 不符: "
            f"{result.actual_ranking} != {result.expected_ranking}"
        )
        assert result.scores_match, (
            f"用例 {case.name} 分数与 oracle 不符: "
            f"{result.actual_scores} != {result.expected_scores}"
        )
