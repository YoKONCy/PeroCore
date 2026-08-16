"""基于 Embedding 相似度的确定性图合成器。

不调用 LLM，仅用余弦相似度阈值建双向 ``related`` 边，结果完全确定、
零 token、可复现。作为 L2 记忆特性轨道的"默认图"基线与消融实验的对照组。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from infos_eval.adapter.exact_dense import _cosine
from infos_eval.embeddings import EmbeddingArtifact
from infos_eval.models import CorpusDocument, GraphEdge


@dataclass(frozen=True, slots=True)
class SimilarityGraphConfig:
    """相似度建图的配置。"""

    threshold: float = 0.8

    def __post_init__(self) -> None:
        if not -1.0 <= self.threshold <= 1.0:
            raise ValueError("threshold必须位于[-1, 1]")


class DeterministicGraphBuilder:
    """按余弦相似度阈值建双向 related 边。"""

    def __init__(self, config: SimilarityGraphConfig | None = None) -> None:
        self._config = config or SimilarityGraphConfig()

    @property
    def name(self) -> str:
        return f"similarity-deterministic-t{self._config.threshold:g}"

    def build_edges(
        self,
        corpus: Sequence[CorpusDocument],
        *,
        embeddings: EmbeddingArtifact,
    ) -> tuple[GraphEdge, ...]:
        doc_ids = tuple(document.doc_id for document in corpus)
        if len(doc_ids) != len(set(doc_ids)):
            raise ValueError("语料包含重复doc_id")
        missing = sorted(set(doc_ids) - embeddings.documents.keys())
        extra = sorted(embeddings.documents.keys() - set(doc_ids))
        if missing or extra:
            raise ValueError(f"文档Embedding集合不匹配: missing={missing}, extra={extra}")

        ordered = sorted(doc_ids)
        edges: list[GraphEdge] = []
        for i in range(len(ordered)):
            for j in range(i + 1, len(ordered)):
                left, right = ordered[i], ordered[j]
                similarity = _cosine(embeddings.documents[left], embeddings.documents[right])
                if similarity >= self._config.threshold:
                    # 相似关系对称，建双向有向边供 SA-PPR 双向扩散。
                    edges.append(GraphEdge(left, right, "related", similarity))
                    edges.append(GraphEdge(right, left, "related", similarity))
        return tuple(edges)
