"""确定性图合成器与 TriviumDB SA-PPR 的端到端集成测试。"""

from __future__ import annotations

import importlib.util

import pytest

from infos_eval.adapter.deterministic_graph import (
    DeterministicGraphBuilder,
    SimilarityGraphConfig,
)
from infos_eval.adapter.synthetic import SyntheticDatasetAdapter
from infos_eval.adapter.triviumdb import (
    TriviumDbRetrieverAdapter,
    TriviumDbRetrieverConfig,
)

pytestmark = pytest.mark.skipif(
    importlib.util.find_spec("triviumdb") is None,
    reason="当前环境未安装TriviumDB Python绑定",
)


def test_确定性合成图喂给TDB_SA_PPR端到端(tmp_path):
    dataset = SyntheticDatasetAdapter()
    embeddings = dataset.embeddings()
    corpus = tuple(dataset.corpus())

    builder = DeterministicGraphBuilder(SimilarityGraphConfig(threshold=0.0))
    edges = builder.build_edges(corpus, embeddings=embeddings)
    # 三个正交节点两两相似度均为 0.0，threshold=0.0 下全连通，共 3 对双向边。
    assert len(edges) == 6

    adapter = TriviumDbRetrieverAdapter(
        embeddings,
        TriviumDbRetrieverConfig(
            mode="sa-ppr",
            expand_depth=2,
            teleport_alpha=0.15,
        ),
        edges=edges,
    )
    adapter.build(corpus, artifact_dir=tmp_path / "index")

    try:
        for query in dataset.queries():
            adapter.reset_query_state()
            response = adapter.search(query, top_k=3, recall_k=3, rerank_k=3)
            assert len(response.results) == 3
    finally:
        adapter.close()
