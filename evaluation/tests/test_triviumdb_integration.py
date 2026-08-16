"""TriviumDB真实绑定与Python Exact基线的一致性测试。"""

from __future__ import annotations

import importlib.util

import pytest

from infos_eval.adapter.exact_dense import ExactDenseAdapter
from infos_eval.adapter.synthetic import SyntheticDatasetAdapter
from infos_eval.adapter.triviumdb import (
    TriviumDbRetrieverAdapter,
    TriviumDbRetrieverConfig,
)
from infos_eval.benchmarks.stateless import StatelessIrRunner

pytestmark = pytest.mark.skipif(
    importlib.util.find_spec("triviumdb") is None,
    reason="当前环境未安装TriviumDB Python绑定",
)


def test_TDB_Exact与Python_Exact逐查询排序一致(tmp_path):
    dataset = SyntheticDatasetAdapter()
    embeddings = dataset.embeddings()
    corpus = tuple(dataset.corpus())
    runner = StatelessIrRunner(top_k=3, recall_k=64, rerank_k=32)
    python_adapter = ExactDenseAdapter(embeddings)
    tdb_adapter = TriviumDbRetrieverAdapter(
        embeddings,
        TriviumDbRetrieverConfig(mode="exact"),
    )
    python_adapter.build(corpus, artifact_dir=tmp_path / "python")
    tdb_adapter.build(corpus, artifact_dir=tmp_path / "tdb")

    try:
        python_run = runner.run(dataset, python_adapter)
        tdb_run = runner.run(dataset, tdb_adapter)
    finally:
        python_adapter.close()
        tdb_adapter.close()

    for python_response, tdb_response in zip(
        python_run.responses,
        tdb_run.responses,
        strict=True,
    ):
        assert [hit.doc_id for hit in tdb_response.results] == [
            hit.doc_id for hit in python_response.results
        ]
        assert [hit.score for hit in tdb_response.results] == pytest.approx(
            [hit.score for hit in python_response.results],
            abs=1e-6,
        )
