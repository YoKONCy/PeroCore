"""评测框架的规范化数据模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(frozen=True, slots=True)
class CorpusDocument:
    doc_id: str
    title: str
    text: str
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Query:
    query_id: str
    text: str
    metadata: Mapping[str, Any] = field(default_factory=dict)
    session_id: str | None = None
    turn_id: int | None = None
    timestamp: float | None = None


@dataclass(frozen=True, slots=True)
class Qrel:
    query_id: str
    doc_id: str
    relevance: int


@dataclass(frozen=True, slots=True)
class SearchResult:
    query_id: str
    doc_id: str
    rank: int
    score: float
    source: str


@dataclass(frozen=True, slots=True)
class BuildReport:
    corpus_count: int
    indexed_count: int
    failed_count: int
    duplicate_count: int
    build_seconds: float
    peak_rss_bytes: int
    index_bytes: int
    corpus_fingerprint: str
    config_fingerprint: str


@dataclass(frozen=True, slots=True)
class SearchResponse:
    results: tuple[SearchResult, ...]
    stage_timings_ms: Mapping[str, float] = field(default_factory=dict)
    stage_counts: Mapping[str, int] = field(default_factory=dict)
    diagnostics: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class GraphEdge:
    """infOS 记忆图中的一条有向边，端点为语料 external doc_id。

    label 为 "inhibition" 时表示抑制边（传播负能量），其余 label 按 weight 符号传播。
    """

    src: str
    dst: str
    label: str = "related"
    weight: float = 1.0
