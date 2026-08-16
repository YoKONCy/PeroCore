"""内置合成数据集，用于评测框架端到端自检。"""

from __future__ import annotations

from infos_eval.embeddings import EmbeddingArtifact
from infos_eval.models import CorpusDocument, Qrel, Query


class SyntheticDatasetAdapter:
    name = "synthetic-v1"

    def corpus(self) -> tuple[CorpusDocument, ...]:
        return (
            CorpusDocument("d1", "Rust", "Rust提供内存安全与零成本抽象"),
            CorpusDocument("d2", "数据库", "向量数据库支持语义检索"),
            CorpusDocument("d3", "烹饪", "苹果派需要苹果和面粉"),
        )

    def queries(self) -> tuple[Query, ...]:
        return (
            Query("q1", "内存安全语言"),
            Query("q2", "语义向量检索"),
        )

    def qrels(self) -> tuple[Qrel, ...]:
        return (
            Qrel("q1", "d1", 2),
            Qrel("q1", "d2", 0),
            Qrel("q2", "d2", 2),
        )

    def embeddings(self) -> EmbeddingArtifact:
        return EmbeddingArtifact.create(
            provider="builtin",
            model="synthetic-orthogonal-v1",
            normalized=True,
            documents={
                "d1": (1.0, 0.0, 0.0),
                "d2": (0.0, 1.0, 0.0),
                "d3": (0.0, 0.0, 1.0),
            },
            queries={"q1": (1.0, 0.1, 0.0), "q2": (0.1, 1.0, 0.0)},
        )
