"""可审计的精确余弦检索基线。"""

from __future__ import annotations

import hashlib
import json
import math
import time
from collections.abc import Sequence
from pathlib import Path

from infos_eval.embeddings import EmbeddingArtifact, Vector
from infos_eval.models import BuildReport, CorpusDocument, Query, SearchResponse, SearchResult


def _cosine(left: Vector, right: Vector) -> float:
    dot = math.fsum(a * b for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(math.fsum(value * value for value in left))
    right_norm = math.sqrt(math.fsum(value * value for value in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return dot / (left_norm * right_norm)


class ExactDenseAdapter:
    name = "exact-dense-python"

    def __init__(self, embeddings: EmbeddingArtifact) -> None:
        self._embeddings = embeddings
        self._doc_ids: tuple[str, ...] = ()

    def build(
        self,
        corpus: Sequence[CorpusDocument],
        *,
        artifact_dir: Path,
    ) -> BuildReport:
        started = time.perf_counter()
        doc_ids = tuple(document.doc_id for document in corpus)
        if len(set(doc_ids)) != len(doc_ids):
            raise ValueError("语料包含重复doc_id")
        missing = sorted(set(doc_ids) - self._embeddings.documents.keys())
        extra = sorted(self._embeddings.documents.keys() - set(doc_ids))
        if missing or extra:
            raise ValueError(f"文档Embedding集合不匹配: missing={missing}, extra={extra}")
        self._doc_ids = doc_ids
        artifact_dir.mkdir(parents=True, exist_ok=True)
        corpus_json = json.dumps(doc_ids, ensure_ascii=False, separators=(",", ":"))
        corpus_fingerprint = hashlib.sha256(corpus_json.encode("utf-8")).hexdigest()
        return BuildReport(
            corpus_count=len(doc_ids),
            indexed_count=len(doc_ids),
            failed_count=0,
            duplicate_count=0,
            build_seconds=time.perf_counter() - started,
            peak_rss_bytes=0,
            index_bytes=sum(
                len(vector) * 8 for vector in self._embeddings.documents.values()
            ),
            corpus_fingerprint=corpus_fingerprint,
            config_fingerprint=self._embeddings.fingerprint,
        )

    def search(
        self,
        query: Query,
        *,
        top_k: int,
        recall_k: int,
        rerank_k: int,
    ) -> SearchResponse:
        del recall_k, rerank_k
        started = time.perf_counter()
        if not self._doc_ids:
            raise RuntimeError("必须先调用build()")
        try:
            query_vector = self._embeddings.queries[query.query_id]
        except KeyError as error:
            raise KeyError(f"缺少查询Embedding: {query.query_id}") from error
        scored = [
            (doc_id, _cosine(query_vector, self._embeddings.documents[doc_id]))
            for doc_id in self._doc_ids
        ]
        scored.sort(key=lambda item: (-item[1], item[0]))
        results = tuple(
            SearchResult(query.query_id, doc_id, rank, score, "exact_dense")
            for rank, (doc_id, score) in enumerate(scored[:top_k], start=1)
        )
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        return SearchResponse(
            results=results,
            stage_timings_ms={"dense_recall": elapsed_ms},
            stage_counts={"dense_recall": len(scored)},
            diagnostics={"embedding_fingerprint": self._embeddings.fingerprint},
        )

    def reset_query_state(self) -> None:
        return None

    def close(self) -> None:
        self._doc_ids = ()
