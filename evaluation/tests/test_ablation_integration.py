"""消融矩阵的集成测试（需要真实 TriviumDB 绑定）。"""

from __future__ import annotations

import importlib.util

import pytest

from infos_eval.benchmarks.ablation import graph_gain_data, run_ablation

pytestmark = pytest.mark.skipif(
    importlib.util.find_spec("triviumdb") is None,
    reason="当前环境未安装TriviumDB Python绑定",
)


def test_消融矩阵展示图扩散补足向量召回():
    data = graph_gain_data()
    rows = run_ablation(data)
    by_key = {(r.edge_source, r.expand_depth, r.teleport_alpha): r for r in rows}

    # 基线：纯向量检索召回不到语义邻居 b。
    baseline = by_key[("exact-baseline", 0, None)]
    assert baseline.metrics["recall@2"] == pytest.approx(0.5, abs=1e-6)

    # ground-truth 语义边 + 图扩散：召回 b，recall 提升到 1.0。
    ground_truth = by_key[("ground-truth", 1, 0.0)]
    assert ground_truth.metrics["recall@2"] == pytest.approx(1.0, abs=1e-6)

    # 相似度建图（threshold=0.5）建不出 a→b 的正交语义边，recall 仍为 0.5。
    similarity = by_key[("similarity-t0.5", 1, 0.15)]
    assert similarity.metrics["recall@2"] == pytest.approx(0.5, abs=1e-6)
