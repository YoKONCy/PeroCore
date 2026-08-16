"""不可变Embedding Artifact及其完整性校验。"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Mapping

Vector = tuple[float, ...]


def _canonical_payload(
    *,
    provider: str,
    model: str,
    normalized: bool,
    documents: Mapping[str, Vector],
    queries: Mapping[str, Vector],
) -> dict[str, object]:
    return {
        "schema_version": 1,
        "provider": provider,
        "model": model,
        "normalized": normalized,
        "documents": {key: list(documents[key]) for key in sorted(documents)},
        "queries": {key: list(queries[key]) for key in sorted(queries)},
    }


def _fingerprint(payload: Mapping[str, object]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class EmbeddingArtifact:
    provider: str
    model: str
    dimension: int
    normalized: bool
    documents: Mapping[str, Vector]
    queries: Mapping[str, Vector]
    fingerprint: str

    @classmethod
    def create(
        cls,
        *,
        provider: str,
        model: str,
        normalized: bool,
        documents: Mapping[str, Vector],
        queries: Mapping[str, Vector],
    ) -> EmbeddingArtifact:
        frozen_documents = MappingProxyType({key: tuple(value) for key, value in documents.items()})
        frozen_queries = MappingProxyType({key: tuple(value) for key, value in queries.items()})
        vectors = [*frozen_documents.values(), *frozen_queries.values()]
        if not vectors:
            raise ValueError("Embedding Artifact不能为空")
        dimension = len(vectors[0])
        if dimension == 0 or any(len(vector) != dimension for vector in vectors):
            raise ValueError("所有Embedding必须具有相同且非零的维度")
        payload = _canonical_payload(
            provider=provider,
            model=model,
            normalized=normalized,
            documents=frozen_documents,
            queries=frozen_queries,
        )
        return cls(
            provider=provider,
            model=model,
            dimension=dimension,
            normalized=normalized,
            documents=frozen_documents,
            queries=frozen_queries,
            fingerprint=_fingerprint(payload),
        )

    def save(self, path: Path) -> None:
        payload = _canonical_payload(
            provider=self.provider,
            model=self.model,
            normalized=self.normalized,
            documents=self.documents,
            queries=self.queries,
        )
        payload["fingerprint"] = self.fingerprint
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )

    @classmethod
    def load(cls, path: Path) -> EmbeddingArtifact:
        payload = json.loads(path.read_text(encoding="utf-8"))
        artifact = cls.create(
            provider=payload["provider"],
            model=payload["model"],
            normalized=payload["normalized"],
            documents={key: tuple(value) for key, value in payload["documents"].items()},
            queries={key: tuple(value) for key, value in payload["queries"].items()},
        )
        if payload.get("schema_version") != 1 or payload.get("fingerprint") != artifact.fingerprint:
            raise ValueError("Embedding Artifact指纹校验失败")
        return artifact
