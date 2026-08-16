"""消融矩阵与 graph_gain 数据集的单元测试（不依赖 TriviumDB 绑定）。"""

from __future__ import annotations

import pytest

from infos_eval.adapter.exact_dense import _cosine
from infos_eval.benchmarks.ablation import format_ablation_table, graph_gain_data
from infos_eval.models import GraphEdge


def test_锚点与语义邻居的向量关系():
    data = graph_gain_data()
    query = data.embeddings.queries["q"]

    assert _cosine(query, data.embeddings.documents["a"]) == pytest.approx(1.0, abs=1e-12)
    assert _cosine(query, data.embeddings.documents["b"]) == pytest.approx(0.0, abs=1e-12)
    # 干扰节点应排在 b 之前，使纯向量检索召回不到 b。
    assert _cosine(query, data.embeddings.documents["c"]) > 0.0


def test_qrels标注锚点与语义邻居为相关():
    data = graph_gain_data()
    relevant = {qrel.doc_id for qrel in data.qrels if qrel.relevance > 0}
    assert relevant == {"a", "b"}


def test_ground_truth边连接锚点到语义邻居():
    data = graph_gain_data()
    assert data.ground_truth_edges == (GraphEdge("a", "b", "related", 1.0),)


def test_表格格式化包含表头与指标():
    data = graph_gain_data()
    # 直接构造一行确认格式化不会报错。
    from infos_eval.benchmarks.ablation import AblationRow

    rows = (
        AblationRow(
            edge_source="exact-baseline",
            expand_depth=0,
            teleport_alpha=None,
            edge_count=0,
            metrics={"ndcg@2": 0.5, "recall@2": 0.5, "mrr@10": 1.0},
        ),
    )
    table = format_ablation_table(rows)
    assert "edge_source" in table
    assert "recall@2" in table
    assert "exact-baseline" in table
