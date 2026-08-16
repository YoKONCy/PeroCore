"""TriviumDB Retriever Adapter契约测试。"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from infos_eval.adapter.synthetic import SyntheticDatasetAdapter
from infos_eval.adapter.triviumdb import (
    TriviumDbRetrieverAdapter,
    TriviumDbRetrieverConfig,
)
from infos_eval.models import Query


class FakeTriviumDb:
    def __init__(self, path, dim, dtype, sync_mode, load_text_index, auto_build_quiver):
        self.path = path
        self.dim = dim
        self.dtype = dtype
        self.sync_mode = sync_mode
        self.load_text_index = load_text_index
        self.auto_build_quiver = auto_build_quiver
        self.vectors = {}
        self.clear_count = 0
        self.last_search = None

    def batch_insert_with_ids(self, ids, vectors, payloads):
        self.vectors = dict(zip(ids, vectors, strict=True))
        assert len(payloads) == len(ids)

    def flush(self):
        return None

    def estimated_memory(self):
        return sum(len(vector) * 4 for vector in self.vectors.values())

    def search_advanced(self, query_vector, **kwargs):
        self.last_search = kwargs
        scores = [
            (node_id, sum(a * b for a, b in zip(query_vector, vector, strict=True)))
            for node_id, vector in self.vectors.items()
        ]
        scores.sort(key=lambda item: (-item[1], item[0]))
        return [
            SimpleNamespace(id=node_id, score=score)
            for node_id, score in scores[: kwargs["top_k"]]
        ]

    def clear_search_state(self):
        self.clear_count += 1


class FakeModule:
    TriviumDB = FakeTriviumDb


def test_TDB_Exact映射稳定并透传三层候选池(tmp_path):
    dataset = SyntheticDatasetAdapter()
    adapter = TriviumDbRetrieverAdapter(
        dataset.embeddings(),
        TriviumDbRetrieverConfig(mode="exact"),
        module=FakeModule(),
    )

    report = adapter.build(tuple(dataset.corpus()), artifact_dir=tmp_path / "index")
    response = adapter.search(Query("q1", "内存安全"), top_k=3, recall_k=64, rerank_k=32)
    internal = adapter._db

    assert report.indexed_count == 3
    assert [result.doc_id for result in response.results] == ["d1", "d2", "d3"]
    assert internal.last_search["recall_k"] == 64
    assert internal.last_search["rerank_k"] == 32
    assert internal.last_search["force_brute_force"] is True
    adapter.reset_query_state()
    assert internal.clear_count == 1
    assert (tmp_path / "index" / "id_mapping.json").exists()
    assert (tmp_path / "index" / "config.json").exists()


def test_TDB配置拒绝模式与扩散深度冲突():
    with pytest.raises(ValueError, match="Exact"):
        TriviumDbRetrieverConfig(mode="exact", expand_depth=2)
    with pytest.raises(ValueError, match="SA-PPR"):
        TriviumDbRetrieverConfig(mode="sa-ppr", expand_depth=0)


def test_TDB缺少绑定时给出安装提示(monkeypatch, tmp_path):
    dataset = SyntheticDatasetAdapter()
    adapter = TriviumDbRetrieverAdapter(
        dataset.embeddings(),
        TriviumDbRetrieverConfig(mode="exact"),
    )

    def missing_module(name):
        raise ModuleNotFoundError(name)

    monkeypatch.setattr("infos_eval.adapter.triviumdb.importlib.import_module", missing_module)
    with pytest.raises(RuntimeError, match="pip install triviumdb==0.7.4"):
        adapter.build(tuple(dataset.corpus()), artifact_dir=tmp_path / "index")
