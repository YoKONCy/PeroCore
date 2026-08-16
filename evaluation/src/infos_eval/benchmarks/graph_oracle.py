"""SA-PPR 图扩散的闭式 oracle 与人工图基准。

本模块分两部分：

1. 参考实现（不依赖 TriviumDB 绑定）：精确复现 TriviumDB 的
   ``graph::traversal::expand_graph`` 在默认配置下的线性传播语义，
   作为图扩散正确性的"闭式标尺"。

2. 人工图基准用例（GraphOracleCase）：用正交单位向量与显式边构造
   分数间距足够大的小图，使期望排名可由手算唯一确定。

正确的评测闭环是：

- 单元测试用参考实现复现手算结果（证明标尺本身正确）；
- 集成测试用真实 TriviumDB 的 SA-PPR 对齐参考实现（证明实现正确）。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

from infos_eval.adapter.exact_dense import _cosine
from infos_eval.embeddings import EmbeddingArtifact, Vector
from infos_eval.models import CorpusDocument, GraphEdge, Query

# 与 TriviumDbRetrieverAdapter.search 保持一致：图扩散前不做分数阈值过滤，
# 让所有非负余弦的节点都进入种子池（能量为 0 的种子不参与传播）。
ORACLE_MIN_SCORE = -1.0


def effective_candidate_pools(top_k: int, recall_k: int, rerank_k: int) -> tuple[int, int]:
    """复现 TriviumDB ``sanitize_config`` 对三层候选池的钳位逻辑。"""
    eff_recall = (max(top_k * 8, 64) if recall_k == 0 else max(recall_k, top_k))
    eff_rerank = (max(top_k * 4, 32) if rerank_k == 0 else max(rerank_k, top_k))
    eff_rerank = min(eff_rerank, eff_recall)
    return eff_recall, eff_rerank


def build_adjacency(
    edges: Sequence[GraphEdge],
) -> dict[str, list[tuple[str, str, float]]]:
    """把边列表折叠为邻接表：src -> [(dst, label, weight), ...]。"""
    adjacency: dict[str, list[tuple[str, str, float]]] = {}
    for edge in edges:
        adjacency.setdefault(edge.src, []).append((edge.dst, edge.label, edge.weight))
    return adjacency


def compute_anchor_seeds(
    query_vector: Vector,
    documents: Mapping[str, Vector],
    *,
    rerank_k: int,
    min_score: float = ORACLE_MIN_SCORE,
) -> list[tuple[str, float]]:
    """复现「向量召回 → RRF（无稀疏时透传原始分数）→ aggregate_seeds」链路。"""
    scored = [(doc_id, _cosine(query_vector, vector)) for doc_id, vector in documents.items()]
    scored = [(doc_id, score) for doc_id, score in scored if score >= min_score]
    scored.sort(key=lambda item: (-item[1], item[0]))
    return scored[:rerank_k]


def simulate_sa_ppr(
    seeds: Sequence[tuple[str, float]],
    edges: Sequence[GraphEdge],
    *,
    max_depth: int,
    restart_alpha: float,
) -> dict[str, float]:
    """精确复现 TriviumDB 有限深度 SA-PPR（默认配置）的总激活值。

    与 ``expand_graph`` 保持逐语句对应：个性化重启按初始种子分布回注、
    传播预算按出边绝对权重归一化、抑制边携带负能量、悬挂节点回注种子。
    """
    if max_depth == 0 or not seeds:
        return {node: score for node, score in seeds}

    alpha = min(max(restart_alpha, 0.0), 1.0)
    seed_mass = math.fsum(max(score, 0.0) for _, score in seeds)
    if seed_mass > 0.0:
        seed_distribution = {node: max(score, 0.0) / seed_mass for node, score in seeds}
    else:
        uniform = 1.0 / len(seeds)
        seed_distribution = {node: uniform for node, _ in seeds}

    adjacency = build_adjacency(edges)
    total_activation: dict[str, float] = {}
    current_tier: dict[str, float] = {}
    for node, score in seeds:
        total_activation[node] = total_activation.get(node, 0.0) + score
        current_tier[node] = current_tier.get(node, 0.0) + score

    def _reinject(budget: float, target: dict[str, float]) -> None:
        for seed_id, share in seed_distribution.items():
            injected = budget * share
            target[seed_id] = target.get(seed_id, 0.0) + injected
            total_activation[seed_id] = total_activation.get(seed_id, 0.0) + injected

    for _ in range(max_depth):
        next_tier: dict[str, float] = {}
        for curr_id, curr_energy in current_tier.items():
            if curr_energy <= 0.0:
                continue

            _reinject(curr_energy * alpha, next_tier)

            spread_budget = curr_energy * (1.0 - alpha)
            if spread_budget <= 0.0:
                continue
            out_edges = adjacency.get(curr_id)
            if not out_edges:
                _reinject(spread_budget, next_tier)
                continue

            normalizer = 0.0
            weighted: list[tuple[str, float, float]] = []
            for dst, label, weight in out_edges:
                if not math.isfinite(weight) or weight == 0.0:
                    continue
                sign = -1.0 if label == "inhibition" else (1.0 if weight > 0 else -1.0)
                raw_magnitude = abs(weight)
                normalizer += raw_magnitude
                weighted.append((dst, sign, raw_magnitude))

            if normalizer <= 0.0:
                _reinject(spread_budget, next_tier)
                continue

            for dst, sign, magnitude in weighted:
                transmitted = spread_budget * (magnitude / normalizer) * sign
                next_tier[dst] = next_tier.get(dst, 0.0) + transmitted
                total_activation[dst] = total_activation.get(dst, 0.0) + transmitted

        next_tier = {
            node: energy
            for node, energy in next_tier.items()
            if energy > 0.0 and math.isfinite(energy)
        }
        if not next_tier:
            break
        current_tier = next_tier

    return total_activation


@dataclass(frozen=True, slots=True)
class GraphOracleCase:
    """一个可复现的人工图评测用例。"""

    name: str
    corpus: tuple[CorpusDocument, ...]
    embeddings: EmbeddingArtifact
    edges: tuple[GraphEdge, ...]
    queries: tuple[Query, ...]
    expand_depth: int
    teleport_alpha: float
    top_k: int
    # 金标准：query_id -> 期望的 doc_id 排名（手算推导，不依赖本模块的参考实现）
    expected_rankings: Mapping[str, tuple[str, ...]]


def builtin_graph_oracle_cases() -> tuple[GraphOracleCase, ...]:
    """返回内置的 SA-PPR 闭式 oracle 用例集。"""
    return (chain_case(), branch_case(), inhibition_case())


def chain_case() -> GraphOracleCase:
    """链式扩散：种子 A 沿 A→B→C 逐层传播，验证深度传播与个性化重启。"""
    documents = {
        "a": (1.0, 0.0, 0.0),
        "b": (0.0, 1.0, 0.0),
        "c": (0.0, 0.0, 1.0),
    }
    embeddings = EmbeddingArtifact.create(
        provider="builtin",
        model="graph-oracle-chain-v1",
        normalized=True,
        documents=documents,
        queries={"q": (1.0, 0.0, 0.0)},
    )
    return GraphOracleCase(
        name="chain",
        corpus=(
            CorpusDocument("a", "A", "锚点节点"),
            CorpusDocument("b", "B", "一跳邻居"),
            CorpusDocument("c", "C", "二跳邻居"),
        ),
        embeddings=embeddings,
        edges=(
            GraphEdge("a", "b", "related", 1.0),
            GraphEdge("b", "c", "related", 1.0),
        ),
        queries=(Query("q", "命中锚点"),),
        expand_depth=2,
        teleport_alpha=0.15,
        top_k=3,
        expected_rankings={"q": ("a", "b", "c")},
    )


def branch_case() -> GraphOracleCase:
    """分支权重：A 的两条出边按绝对权重分摊传播预算，验证归一化。"""
    documents = {
        "a": (1.0, 0.0, 0.0, 0.0),
        "b": (0.0, 1.0, 0.0, 0.0),
        "c": (0.0, 0.0, 1.0, 0.0),
        "d": (0.0, 0.0, 0.0, 1.0),
    }
    embeddings = EmbeddingArtifact.create(
        provider="builtin",
        model="graph-oracle-branch-v1",
        normalized=True,
        documents=documents,
        queries={"q": (1.0, 0.0, 0.0, 0.0)},
    )
    return GraphOracleCase(
        name="branch",
        corpus=(
            CorpusDocument("a", "A", "种子节点"),
            CorpusDocument("b", "B", "高权重邻居"),
            CorpusDocument("c", "C", "低权重邻居"),
            CorpusDocument("d", "D", "孤立节点"),
        ),
        embeddings=embeddings,
        edges=(
            GraphEdge("a", "b", "related", 2.0),
            GraphEdge("a", "c", "related", 1.0),
        ),
        queries=(Query("q", "命中种子"),),
        expand_depth=1,
        teleport_alpha=0.0,
        top_k=4,
        expected_rankings={"q": ("a", "b", "c", "d")},
    )


def inhibition_case() -> GraphOracleCase:
    """抑制边：inhibition 边携带负能量，验证符号翻转传播。"""
    documents = {
        "a": (1.0, 0.0),
        "b": (0.0, 1.0),
    }
    embeddings = EmbeddingArtifact.create(
        provider="builtin",
        model="graph-oracle-inhibition-v1",
        normalized=True,
        documents=documents,
        queries={"q": (1.0, 0.0)},
    )
    return GraphOracleCase(
        name="inhibition",
        corpus=(
            CorpusDocument("a", "A", "种子节点"),
            CorpusDocument("b", "B", "被抑制邻居"),
        ),
        embeddings=embeddings,
        edges=(GraphEdge("a", "b", "inhibition", 1.0),),
        queries=(Query("q", "命中种子"),),
        expand_depth=1,
        teleport_alpha=0.0,
        top_k=2,
        expected_rankings={"q": ("a", "b")},
    )


def expected_ranking_for_case(
    case: GraphOracleCase,
    query: Query,
) -> tuple[tuple[str, float], ...]:
    """用参考实现计算单个 query 的期望激活值排序。"""
    query_vector = case.embeddings.queries[query.query_id]
    _, rerank_k = effective_candidate_pools(case.top_k, case.top_k, case.top_k)
    seeds = compute_anchor_seeds(query_vector, case.embeddings.documents, rerank_k=rerank_k)
    total = simulate_sa_ppr(
        seeds,
        case.edges,
        max_depth=case.expand_depth,
        restart_alpha=case.teleport_alpha,
    )
    ranked = sorted(total.items(), key=lambda item: (-item[1], item[0]))
    return tuple((doc_id, score) for doc_id, score in ranked[: case.top_k])


@dataclass(frozen=True, slots=True)
class GraphOracleQueryResult:
    """单个 query 的真实实现与闭式 oracle 的对齐结果。"""

    query_id: str
    actual_ranking: tuple[str, ...]
    expected_ranking: tuple[str, ...]
    actual_scores: tuple[float, ...]
    expected_scores: tuple[float, ...]
    ranking_match: bool
    scores_match: bool


def run_graph_oracle_case(
    case: GraphOracleCase,
    *,
    artifact_dir: Path,
    module: object | None = None,
) -> tuple[GraphOracleQueryResult, ...]:
    """用真实 TriviumDB 跑单个 oracle 用例，并与闭式参考实现对齐。"""
    from infos_eval.adapter.triviumdb import (
        TriviumDbRetrieverAdapter,
        TriviumDbRetrieverConfig,
    )

    adapter = TriviumDbRetrieverAdapter(
        case.embeddings,
        TriviumDbRetrieverConfig(
            mode="sa-ppr",
            expand_depth=case.expand_depth,
            teleport_alpha=case.teleport_alpha,
        ),
        edges=case.edges,
        module=module,
    )
    adapter.build(tuple(case.corpus), artifact_dir=artifact_dir)
    try:
        results: list[GraphOracleQueryResult] = []
        for query in case.queries:
            adapter.reset_query_state()
            response = adapter.search(
                query,
                top_k=case.top_k,
                recall_k=case.top_k,
                rerank_k=case.top_k,
            )
            expected_ranked = expected_ranking_for_case(case, query)
            actual_ranked = [(hit.doc_id, hit.score) for hit in response.results]
            actual_ids = tuple(doc_id for doc_id, _ in actual_ranked)
            expected_ids = tuple(doc_id for doc_id, _ in expected_ranked)
            scores_match = all(
                math.isclose(actual, expected, rel_tol=1e-4, abs_tol=1e-5)
                for (_, actual), (_, expected) in zip(
                    actual_ranked,
                    expected_ranked,
                    strict=True,
                )
            )
            results.append(
                GraphOracleQueryResult(
                    query_id=query.query_id,
                    actual_ranking=actual_ids,
                    expected_ranking=expected_ids,
                    actual_scores=tuple(score for _, score in actual_ranked),
                    expected_scores=tuple(score for _, score in expected_ranked),
                    ranking_match=actual_ids == expected_ids,
                    scores_match=scores_match,
                )
            )
        return tuple(results)
    finally:
        adapter.close()
