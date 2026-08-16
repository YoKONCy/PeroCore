"""SA-PPR 闭式参考实现的单元测试（不依赖 TriviumDB 绑定）。"""

from __future__ import annotations

import pytest

from infos_eval.benchmarks.graph_oracle import (
    builtin_graph_oracle_cases,
    compute_anchor_seeds,
    expected_ranking_for_case,
    simulate_sa_ppr,
)
from infos_eval.models import GraphEdge


def test_chain传播与重启的手算值():
    edges = (
        GraphEdge("a", "b", "related", 1.0),
        GraphEdge("b", "c", "related", 1.0),
    )
    seeds = [("a", 1.0), ("b", 0.0), ("c", 0.0)]

    total = simulate_sa_ppr(seeds, edges, max_depth=2, restart_alpha=0.15)

    assert total["a"] == pytest.approx(1.30, abs=1e-12)
    assert total["b"] == pytest.approx(0.9775, abs=1e-12)
    assert total["c"] == pytest.approx(0.7225, abs=1e-12)


def test_分支按绝对权重归一化():
    edges = (
        GraphEdge("a", "b", "related", 2.0),
        GraphEdge("a", "c", "related", 1.0),
    )
    seeds = [("a", 1.0), ("b", 0.0), ("c", 0.0), ("d", 0.0)]

    total = simulate_sa_ppr(seeds, edges, max_depth=1, restart_alpha=0.0)

    assert total["a"] == pytest.approx(1.0, abs=1e-12)
    assert total["b"] == pytest.approx(2.0 / 3.0, abs=1e-12)
    assert total["c"] == pytest.approx(1.0 / 3.0, abs=1e-12)
    assert total["d"] == pytest.approx(0.0, abs=1e-12)


def test_抑制边传播负能量():
    edges = (GraphEdge("a", "b", "inhibition", 1.0),)
    seeds = [("a", 1.0), ("b", 0.0)]

    total = simulate_sa_ppr(seeds, edges, max_depth=1, restart_alpha=0.0)

    assert total["a"] == pytest.approx(1.0, abs=1e-12)
    assert total["b"] == pytest.approx(-1.0, abs=1e-12)


def test_最大深度为零时不扩散():
    edges = (GraphEdge("a", "b", "related", 1.0),)
    seeds = [("a", 1.0), ("b", 0.0)]

    total = simulate_sa_ppr(seeds, edges, max_depth=0, restart_alpha=0.0)

    assert total == {"a": 1.0, "b": 0.0}


def test_悬挂节点回注种子():
    edges = (GraphEdge("a", "b", "related", 1.0),)
    seeds = [("a", 1.0)]

    total = simulate_sa_ppr(seeds, edges, max_depth=2, restart_alpha=0.0)

    # A→B(第0层)后，B 无出边，其能量应回注 A。
    assert total["a"] == pytest.approx(2.0, abs=1e-12)
    assert total["b"] == pytest.approx(1.0, abs=1e-12)


def test_锚点种子由余弦召回确定():
    documents = {
        "a": (1.0, 0.0, 0.0),
        "b": (0.0, 1.0, 0.0),
        "c": (0.0, 0.0, 1.0),
    }
    seeds = compute_anchor_seeds((1.0, 0.0, 0.0), documents, rerank_k=3)
    assert [node for node, _ in seeds] == ["a", "b", "c"]
    assert seeds[0][1] == pytest.approx(1.0, abs=1e-12)
    assert seeds[1][1] == pytest.approx(0.0, abs=1e-12)


def test_内置用例参考实现复现金标准排名():
    for case in builtin_graph_oracle_cases():
        for query in case.queries:
            ranked = expected_ranking_for_case(case, query)
            actual = tuple(doc_id for doc_id, _ in ranked)
            assert actual == case.expected_rankings[query.query_id], (
                f"用例 {case.name} 的参考实现排名与金标准不符: "
                f"{actual} != {case.expected_rankings[query.query_id]}"
            )
