"""TriviumDB官方Retriever Adapter。"""

from __future__ import annotations

import gc
import hashlib
import importlib
import json
import time
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

from infos_eval.embeddings import EmbeddingArtifact
from infos_eval.models import (
    BuildReport,
    CorpusDocument,
    GraphEdge,
    Query,
    SearchResponse,
    SearchResult,
)

TriviumMode = Literal["exact", "quiver", "sa-ppr"]


@dataclass(frozen=True, slots=True)
class TriviumDbRetrieverConfig:
    mode: TriviumMode = "exact"
    dtype: Literal["f32", "f16"] = "f32"
    sync_mode: Literal["full", "normal", "off"] = "off"
    expand_depth: int = 0
    teleport_alpha: float = 0.0
    enable_sparse_residual: bool = False
    enable_dpp: bool = False
    enable_refractory_fatigue: bool = False
    enable_text_hybrid_search: bool = False
    text_boost: float = 1.5

    def __post_init__(self) -> None:
        if self.mode == "exact" and self.expand_depth != 0:
            raise ValueError("Exact模式的expand_depth必须为0")
        if self.mode == "quiver" and self.expand_depth != 0:
            raise ValueError("QuIVer模式的expand_depth必须为0")
        if self.mode == "sa-ppr" and self.expand_depth <= 0:
            raise ValueError("SA-PPR模式的expand_depth必须大于0")
        if not 0.0 <= self.teleport_alpha <= 1.0:
            raise ValueError("teleport_alpha必须位于[0, 1]")

    @property
    def force_brute_force(self) -> bool:
        return self.mode == "exact"

    @property
    def auto_build_quiver(self) -> bool:
        return self.mode != "exact"

    @property
    def fingerprint(self) -> str:
        encoded = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class TriviumDbRetrieverAdapter:
    def __init__(
        self,
        embeddings: EmbeddingArtifact,
        config: TriviumDbRetrieverConfig,
        *,
        module: Any | None = None,
        edges: Sequence[GraphEdge] = (),
    ) -> None:
        self._embeddings = embeddings
        self.config = config
        self._module = module
        self._edges = tuple(edges)
        self._db: Any | None = None
        self._db_path: Path | None = None
        self._external_to_node: dict[str, int] = {}
        self._node_to_external: dict[int, str] = {}

    @property
    def name(self) -> str:
        suffix = f"-{self.config.dtype}"
        if self.config.mode == "sa-ppr":
            suffix += f"-d{self.config.expand_depth}-a{self.config.teleport_alpha:g}"
        return f"triviumdb-{self.config.mode}{suffix}"

    def _load_module(self) -> Any:
        if self._module is None:
            try:
                self._module = importlib.import_module("triviumdb")
            except ModuleNotFoundError as error:
                raise RuntimeError(
                    "未安装TriviumDB Python包，请执行 `pip install triviumdb==0.7.4`"
                ) from error
        return self._module

    def build(
        self,
        corpus: Sequence[CorpusDocument],
        *,
        artifact_dir: Path,
    ) -> BuildReport:
        started = time.perf_counter()
        if self._db is not None:
            raise RuntimeError("Adapter已经构建")
        doc_ids = tuple(document.doc_id for document in corpus)
        if len(doc_ids) != len(set(doc_ids)):
            raise ValueError("语料包含重复doc_id")
        missing = sorted(set(doc_ids) - self._embeddings.documents.keys())
        extra = sorted(self._embeddings.documents.keys() - set(doc_ids))
        if missing or extra:
            raise ValueError(f"文档Embedding集合不匹配: missing={missing}, extra={extra}")

        artifact_dir.mkdir(parents=True, exist_ok=True)
        self._db_path = artifact_dir / "index.tdb"
        if self._db_path.exists():
            raise FileExistsError(f"拒绝覆盖已有评测索引: {self._db_path}")

        ordered_ids = sorted(doc_ids)
        self._external_to_node = {
            external_id: node_id for node_id, external_id in enumerate(ordered_ids, start=1)
        }
        self._node_to_external = {
            node_id: external_id for external_id, node_id in self._external_to_node.items()
        }
        by_id = {document.doc_id: document for document in corpus}
        node_ids = [self._external_to_node[external_id] for external_id in ordered_ids]
        vectors = [list(self._embeddings.documents[external_id]) for external_id in ordered_ids]
        payloads = [
            {
                "external_doc_id": external_id,
                "title": by_id[external_id].title,
                "text": by_id[external_id].text,
                "metadata": dict(by_id[external_id].metadata),
            }
            for external_id in ordered_ids
        ]

        module = self._load_module()
        self._db = module.TriviumDB(
            str(self._db_path),
            self._embeddings.dimension,
            self.config.dtype,
            self.config.sync_mode,
            self.config.enable_text_hybrid_search,
            self.config.auto_build_quiver,
        )
        self._db.batch_insert_with_ids(node_ids, vectors, payloads)
        known_ids = set(doc_ids)
        for edge in self._edges:
            if edge.src not in known_ids or edge.dst not in known_ids:
                raise ValueError(f"边端点不在语料中: {edge.src} -> {edge.dst}")
            self._db.link(
                self._external_to_node[edge.src],
                self._external_to_node[edge.dst],
                edge.label,
                edge.weight,
            )
        if self.config.enable_text_hybrid_search:
            for external_id in ordered_ids:
                document = by_id[external_id]
                self._db.index_text(
                    self._external_to_node[external_id],
                    f"{document.title}\n{document.text}",
                )
            self._db.build_text_index()
        self._db.flush()

        mapping_payload = {
            "schema_version": 1,
            "embedding_fingerprint": self._embeddings.fingerprint,
            "config_fingerprint": self.config.fingerprint,
            "external_to_node": self._external_to_node,
        }
        (artifact_dir / "id_mapping.json").write_text(
            json.dumps(mapping_payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        (artifact_dir / "config.json").write_text(
            json.dumps(asdict(self.config), ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        corpus_encoded = json.dumps(ordered_ids, ensure_ascii=False, separators=(",", ":"))
        index_bytes = sum(
            path.stat().st_size
            for path in artifact_dir.iterdir()
            if path.is_file() and path.name.startswith("index.tdb")
        )
        return BuildReport(
            corpus_count=len(corpus),
            indexed_count=len(corpus),
            failed_count=0,
            duplicate_count=0,
            build_seconds=time.perf_counter() - started,
            peak_rss_bytes=int(self._db.estimated_memory()),
            index_bytes=index_bytes,
            corpus_fingerprint=hashlib.sha256(corpus_encoded.encode("utf-8")).hexdigest(),
            config_fingerprint=self.config.fingerprint,
        )

    def search(
        self,
        query: Query,
        *,
        top_k: int,
        recall_k: int,
        rerank_k: int,
    ) -> SearchResponse:
        if self._db is None:
            raise RuntimeError("必须先调用build()")
        try:
            query_vector = list(self._embeddings.queries[query.query_id])
        except KeyError as error:
            raise KeyError(f"缺少查询Embedding: {query.query_id}") from error

        started = time.perf_counter()
        hits = self._db.search_advanced(
            query_vector,
            top_k=top_k,
            recall_k=recall_k,
            rerank_k=rerank_k,
            expand_depth=self.config.expand_depth,
            min_score=-1.0,
            teleport_alpha=self.config.teleport_alpha,
            enable_advanced_pipeline=self.config.mode == "sa-ppr",
            enable_sparse_residual=self.config.enable_sparse_residual,
            enable_dpp=self.config.enable_dpp,
            enable_refractory_fatigue=self.config.enable_refractory_fatigue,
            enable_text_hybrid_search=self.config.enable_text_hybrid_search,
            text_boost=self.config.text_boost,
            custom_query_text=query.text if self.config.enable_text_hybrid_search else None,
            force_brute_force=self.config.force_brute_force,
        )
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        results = tuple(
            SearchResult(
                query_id=query.query_id,
                doc_id=self._node_to_external[int(hit.id)],
                rank=rank,
                score=float(hit.score),
                source=f"triviumdb_{self.config.mode}",
            )
            for rank, hit in enumerate(hits, start=1)
        )
        return SearchResponse(
            results=results,
            stage_timings_ms={"total_search": elapsed_ms},
            stage_counts={"final": len(results)},
            diagnostics={
                "embedding_fingerprint": self._embeddings.fingerprint,
                "config_fingerprint": self.config.fingerprint,
                "internal_stage_context_available": False,
            },
        )

    def reset_query_state(self) -> None:
        if self._db is not None:
            self._db.clear_search_state()

    def close(self) -> None:
        if self._db is not None:
            self._db.flush()
            self._db = None
            gc.collect()
