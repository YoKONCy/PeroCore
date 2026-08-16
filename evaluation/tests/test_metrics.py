"""IR指标测试。"""

import pytest

from infos_eval.benchmarks.metrics import evaluate_ir
from infos_eval.models import Qrel, SearchResult


def test_完美排序获得满分():
    results = {
        "q1": (
            SearchResult("q1", "d1", 1, 2.0, "test"),
            SearchResult("q1", "d2", 2, 1.0, "test"),
        )
    }
    qrels = (Qrel("q1", "d1", 2), Qrel("q1", "d2", 1))

    metrics, per_query = evaluate_ir(results, qrels)

    assert metrics["ndcg@10"] == pytest.approx(1.0)
    assert metrics["recall@10"] == pytest.approx(1.0)
    assert per_query["q1"]["mrr@10"] == pytest.approx(1.0)


def test_无结果查询计入零分():
    metrics, _ = evaluate_ir({}, (Qrel("q1", "d1", 1),))
    assert metrics["ndcg@10"] == 0.0
    assert metrics["recall@100"] == 0.0
    assert metrics["mrr@10"] == 0.0
