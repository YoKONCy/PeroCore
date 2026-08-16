"""确定性图合成器的单元测试（不依赖 TriviumDB 绑定）。"""

from __future__ import annotations

import math

import pytest

from infos_eval.adapter.deterministic_graph import (
    DeterministicGraphBuilder,
    SimilarityGraphConfig,
)
from infos_eval.embeddings import EmbeddingArtifact
from infos_eval.models import CorpusDocument


def _corpus(*ids: str) -> tuple[CorpusDocument, ...]:
    return tuple(CorpusDocument(doc_id, doc_id, doc_id) for doc_id in ids)


def test_正交向量低于阈值不建边():
    embeddings = EmbeddingArtifact.create(
        provider="builtin",
        model="orthogonal-v1",
        normalized=True,
        documents={"a": (1.0, 0.0, 0.0), "b": (0.0, 1.0, 0.0), "c": (0.0, 0.0, 1.0)},
        queries={},
    )
    builder = DeterministicGraphBuilder(SimilarityGraphConfig(threshold=0.8))

    edges = builder.build_edges(_corpus("a", "b", "c"), embeddings=embeddings)

    assert edges == ()


def test_相似向量建双向边且权重等于相似度():
    embeddings = EmbeddingArtifact.create(
        provider="builtin",
        model="similar-v1",
        normalized=True,
        documents={"a": (1.0, 0.0), "b": (1.0, 1.0)},
        queries={},
    )
    builder = DeterministicGraphBuilder(SimilarityGraphConfig(threshold=0.7))

    edges = builder.build_edges(_corpus("a", "b"), embeddings=embeddings)

    expected_weight = 1.0 / math.sqrt(2.0)
    assert len(edges) == 2
    assert edges[0].src == "a" and edges[0].dst == "b"
    assert edges[0].label == "related"
    assert edges[0].weight == pytest.approx(expected_weight, abs=1e-12)
    assert edges[1].src == "b" and edges[1].dst == "a"


def test_建图结果完全确定():
    embeddings = EmbeddingArtifact.create(
        provider="builtin",
        model="similar-v1",
        normalized=True,
        documents={"a": (1.0, 0.0), "b": (1.0, 1.0)},
        queries={},
    )
    builder = DeterministicGraphBuilder(SimilarityGraphConfig(threshold=0.7))
    corpus = _corpus("a", "b")

    assert builder.build_edges(corpus, embeddings=embeddings) == builder.build_edges(
        corpus, embeddings=embeddings
    )


def test_语料与Embedding不匹配时拒绝建图():
    embeddings = EmbeddingArtifact.create(
        provider="builtin",
        model="similar-v1",
        normalized=True,
        documents={"a": (1.0, 0.0)},
        queries={},
    )
    builder = DeterministicGraphBuilder(SimilarityGraphConfig(threshold=0.8))

    with pytest.raises(ValueError, match="不匹配"):
        builder.build_edges(_corpus("a", "missing"), embeddings=embeddings)


def test_threshold越界拒绝():
    with pytest.raises(ValueError, match="threshold"):
        SimilarityGraphConfig(threshold=2.0)
