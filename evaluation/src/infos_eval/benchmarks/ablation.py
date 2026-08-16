"""图扩散增益的消融矩阵。

用一个专门构造的 ``graph_gain`` 数据集量化"图扩散的价值"：

- 文档 ``a``（锚点）与 query 向量高度相似，纯向量检索即可召回；
- 文档 ``b``（语义邻居）与 query 向量正交（余弦 0），只能靠 a→b 的图边扩散召回；
- 文档 ``c``（干扰）与 query 有一定相似度，在纯向量检索中排在 b 之前。

于是对照 expand_depth=0（纯向量基线）与 ground-truth 语义边 + 低 teleport_alpha 的 SA-PPR，
recall@2 会从 0.5 提升到 1.0，直接体现图扩散补足向量召回的作用；
同时对比"ground-truth 语义边"与"相似度建图"，说明相似度建图无法替代语义边——
正交语义邻居的相似度为 0，相似度建图要么不连边，要么产生零权重（被 SA-PPR 跳过）的无效边。
"""

from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

from infos_eval.adapter.deterministic_graph import (
    DeterministicGraphBuilder,
    SimilarityGraphConfig,
)
from infos_eval.adapter.triviumdb import (
    TriviumDbRetrieverAdapter,
    TriviumDbRetrieverConfig,
)
from infos_eval.benchmarks.metrics import evaluate_ir
from infos_eval.embeddings import EmbeddingArtifact
from infos_eval.models import CorpusDocument, GraphEdge, Qrel, Query, SearchResult


@dataclass(frozen=True, slots=True)
class GraphGainData:
    corpus: tuple[CorpusDocument, ...]
    queries: tuple[Query, ...]
    qrels: tuple[Qrel, ...]
    embeddings: EmbeddingArtifact
    ground_truth_edges: tuple[GraphEdge, ...]


def graph_gain_data() -> GraphGainData:
    """返回图扩散增益基准数据：锚点 a、语义邻居 b、干扰 c。"""
    documents = {
        "a": (1.0, 0.0, 0.0),
        "b": (0.0, 1.0, 0.0),
        "c": (0.6, 0.8, 0.0),
    }
    embeddings = EmbeddingArtifact.create(
        provider="builtin",
        model="graph-gain-v1",
        normalized=True,
        documents=documents,
        queries={"q": (1.0, 0.0, 0.0)},
    )
    return GraphGainData(
        corpus=(
            CorpusDocument("a", "锚点", "与查询直接语义匹配的文档"),
            CorpusDocument("b", "语义邻居", "向量正交但语义相关的文档"),
            CorpusDocument("c", "干扰", "与查询部分相似但不相关的文档"),
        ),
        queries=(Query("q", "命中锚点"),),
        qrels=(Qrel("q", "a", 2), Qrel("q", "b", 2)),
        embeddings=embeddings,
        ground_truth_edges=(GraphEdge("a", "b", "related", 1.0),),
    )


@dataclass(frozen=True, slots=True)
class AblationRow:
    """消融矩阵中的一行（一个配置的指标结果）。"""

    edge_source: str
    expand_depth: int
    teleport_alpha: float | None
    edge_count: int
    metrics: Mapping[str, float]


def _edge_sources(
    data: GraphGainData,
    thresholds: Sequence[float],
) -> tuple[tuple[str, tuple[GraphEdge, ...]], ...]:
    sources: list[tuple[str, tuple[GraphEdge, ...]]] = [
        ("ground-truth", data.ground_truth_edges)
    ]
    for threshold in thresholds:
        builder = DeterministicGraphBuilder(SimilarityGraphConfig(threshold=threshold))
        edges = builder.build_edges(data.corpus, embeddings=data.embeddings)
        sources.append((f"similarity-t{threshold:g}", edges))
    return tuple(sources)


def _search_and_measure(
    data: GraphGainData,
    *,
    config: TriviumDbRetrieverConfig,
    edges: tuple[GraphEdge, ...],
    top_k: int,
    artifact_dir: Path,
) -> tuple[Mapping[str, float], int]:
    adapter = TriviumDbRetrieverAdapter(data.embeddings, config, edges=edges)
    adapter.build(data.corpus, artifact_dir=artifact_dir)
    try:
        results_by_query: dict[str, tuple[SearchResult, ...]] = {}
        for query in data.queries:
            adapter.reset_query_state()
            response = adapter.search(
                query,
                top_k=top_k,
                recall_k=top_k,
                rerank_k=top_k,
            )
            results_by_query[query.query_id] = response.results
    finally:
        adapter.close()

    metrics, _ = evaluate_ir(results_by_query, data.qrels, cutoffs=(top_k,))
    return metrics, len(edges)


def run_ablation(
    data: GraphGainData,
    *,
    similarity_thresholds: Sequence[float] = (0.0, 0.5, 0.8),
    expand_depths: Sequence[int] = (1, 2),
    teleport_alphas: Sequence[float] = (0.0, 0.15),
    top_k: int = 2,
) -> tuple[AblationRow, ...]:
    """跑消融矩阵，返回基线 + SA-PPR 各配置的指标行。"""
    rows: list[AblationRow] = []
    sources = _edge_sources(data, similarity_thresholds)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        # 基线：exact 纯向量检索，无图扩散。
        baseline_metrics, _ = _search_and_measure(
            data,
            config=TriviumDbRetrieverConfig(mode="exact"),
            edges=(),
            top_k=top_k,
            artifact_dir=tmp_path / "baseline",
        )
        rows.append(
            AblationRow(
                edge_source="exact-baseline",
                expand_depth=0,
                teleport_alpha=None,
                edge_count=0,
                metrics=baseline_metrics,
            )
        )

        index = 1
        for edge_source, edges in sources:
            for depth in expand_depths:
                for alpha in teleport_alphas:
                    metrics, _ = _search_and_measure(
                        data,
                        config=TriviumDbRetrieverConfig(
                            mode="sa-ppr",
                            expand_depth=depth,
                            teleport_alpha=alpha,
                        ),
                        edges=edges,
                        top_k=top_k,
                        artifact_dir=tmp_path / str(index),
                    )
                    index += 1
                    rows.append(
                        AblationRow(
                            edge_source=edge_source,
                            expand_depth=depth,
                            teleport_alpha=alpha,
                            edge_count=len(edges),
                            metrics=metrics,
                        )
                    )
    return tuple(rows)


def format_ablation_table(rows: Sequence[AblationRow]) -> str:
    """把消融矩阵格式化为对齐文本表。"""
    metric_names = sorted({name for row in rows for name in row.metrics})
    headers = ["edge_source", "depth", "alpha", "edges", *metric_names]
    lines = [
        " | ".join(f"{header:<18}" for header in headers),
        "-+-".join("-" * 18 for _ in headers),
    ]
    for row in rows:
        alpha = "-" if row.teleport_alpha is None else f"{row.teleport_alpha:g}"
        values = [
            row.edge_source,
            str(row.expand_depth),
            alpha,
            str(row.edge_count),
            *[f"{row.metrics[name]:.4f}" for name in metric_names],
        ]
        lines.append(" | ".join(f"{value:<18}" for value in values))
    return "\n".join(lines)
