"""无状态IR运行器契约测试。"""

from pathlib import Path

import pytest

from infos_eval.adapter.validation import AdapterContractError
from infos_eval.benchmarks.stateless import StatelessIrRunner
from infos_eval.models import (
    BuildReport,
    CorpusDocument,
    Qrel,
    Query,
    SearchResponse,
    SearchResult,
)


class SyntheticDataset:
    name = "synthetic"

    def corpus(self):
        return [
            CorpusDocument("d1", "", "第一篇文档"),
            CorpusDocument("d2", "", "第二篇文档"),
        ]

    def queries(self):
        return [Query("q1", "第一"), Query("q2", "第二")]

    def qrels(self):
        return [Qrel("q1", "d1", 1), Qrel("q2", "d2", 1)]


class RecordingRetriever:
    name = "recording"

    def __init__(self) -> None:
        self.reset_count = 0
        self.calls: list[tuple[int, int, int]] = []

    def build(self, corpus, *, artifact_dir: Path):
        return BuildReport(
            corpus_count=len(corpus),
            indexed_count=len(corpus),
            failed_count=0,
            duplicate_count=0,
            build_seconds=0.0,
            peak_rss_bytes=0,
            index_bytes=0,
            corpus_fingerprint="synthetic",
            config_fingerprint="recording",
        )

    def search(self, query, *, top_k, recall_k, rerank_k):
        self.calls.append((top_k, recall_k, rerank_k))
        doc_id = "d1" if query.query_id == "q1" else "d2"
        return SearchResponse(
            results=(SearchResult(query.query_id, doc_id, 1, 1.0, "synthetic"),)
        )

    def reset_query_state(self):
        self.reset_count += 1

    def close(self):
        return None


def test_无状态运行器逐查询重置并传递候选池参数():
    retriever = RecordingRetriever()
    runner = StatelessIrRunner(top_k=10, recall_k=200, rerank_k=50)

    result = runner.run(SyntheticDataset(), retriever)

    assert len(result.responses) == 2
    assert retriever.reset_count == 2
    assert retriever.calls == [(10, 200, 50), (10, 200, 50)] * 1


def test_运行器拒绝非法候选池顺序():
    with pytest.raises(ValueError, match="top_k"):
        StatelessIrRunner(top_k=10, recall_k=20, rerank_k=30)


class UnknownIdRetriever(RecordingRetriever):
    def search(self, query, *, top_k, recall_k, rerank_k):
        return SearchResponse(
            results=(SearchResult(query.query_id, "unknown", 1, 1.0, "synthetic"),)
        )


def test_运行器拒绝未知文档ID():
    runner = StatelessIrRunner(top_k=10, recall_k=200, rerank_k=50)
    with pytest.raises(AdapterContractError, match="未知doc_id"):
        runner.run(SyntheticDataset(), UnknownIdRetriever())
