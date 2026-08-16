"""标准信息检索指标的无依赖实现。"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Iterable, Sequence

from infos_eval.models import Qrel, SearchResult


def _qrel_map(qrels: Iterable[Qrel]) -> dict[str, dict[str, int]]:
    mapped: dict[str, dict[str, int]] = defaultdict(dict)
    for qrel in qrels:
        mapped[qrel.query_id][qrel.doc_id] = qrel.relevance
    return dict(mapped)


def _dcg(relevances: Sequence[int]) -> float:
    return math.fsum(
        (2**relevance - 1) / math.log2(rank + 1)
        for rank, relevance in enumerate(relevances, start=1)
    )


def evaluate_ir(
    results_by_query: dict[str, tuple[SearchResult, ...]],
    qrels: Iterable[Qrel],
    *,
    cutoffs: tuple[int, ...] = (10, 100),
) -> tuple[dict[str, float], dict[str, dict[str, float]]]:
    relevance = _qrel_map(qrels)
    per_query: dict[str, dict[str, float]] = {}
    for query_id in sorted(relevance):
        judged = relevance[query_id]
        relevant_ids = {doc_id for doc_id, grade in judged.items() if grade > 0}
        ranked = results_by_query.get(query_id, ())
        query_metrics: dict[str, float] = {}
        for cutoff in cutoffs:
            top = ranked[:cutoff]
            grades = [judged.get(hit.doc_id, 0) for hit in top]
            ideal = sorted((grade for grade in judged.values() if grade > 0), reverse=True)[:cutoff]
            ideal_dcg = _dcg(ideal)
            query_metrics[f"ndcg@{cutoff}"] = _dcg(grades) / ideal_dcg if ideal_dcg else 0.0
            query_metrics[f"recall@{cutoff}"] = (
                sum(hit.doc_id in relevant_ids for hit in top) / len(relevant_ids)
                if relevant_ids
                else 0.0
            )
        reciprocal_rank = next(
            (1.0 / hit.rank for hit in ranked[:10] if hit.doc_id in relevant_ids),
            0.0,
        )
        query_metrics["mrr@10"] = reciprocal_rank
        per_query[query_id] = query_metrics

    metric_names = sorted({name for metrics in per_query.values() for name in metrics})
    aggregate = {
        name: math.fsum(metrics[name] for metrics in per_query.values()) / len(per_query)
        for name in metric_names
    } if per_query else {}
    return aggregate, per_query
