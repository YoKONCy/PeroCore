"""Embedding Artifact完整性测试。"""

import json

import pytest

from infos_eval.adapter.synthetic import SyntheticDatasetAdapter
from infos_eval.embeddings import EmbeddingArtifact


def test_EmbeddingArtifact保存加载后指纹一致(tmp_path):
    artifact = SyntheticDatasetAdapter().embeddings()
    path = tmp_path / "embeddings.json"
    artifact.save(path)

    restored = EmbeddingArtifact.load(path)

    assert restored.fingerprint == artifact.fingerprint
    assert restored.documents == artifact.documents


def test_EmbeddingArtifact拒绝篡改(tmp_path):
    artifact = SyntheticDatasetAdapter().embeddings()
    path = tmp_path / "embeddings.json"
    artifact.save(path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["documents"]["d1"][0] = 0.5
    path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError, match="指纹"):
        EmbeddingArtifact.load(path)
