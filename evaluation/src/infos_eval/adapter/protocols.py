"""官方 Adapter 必须实现的最小契约。"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Protocol, runtime_checkable

from infos_eval.embeddings import EmbeddingArtifact
from infos_eval.models import (
    BuildReport,
    CorpusDocument,
    GraphEdge,
    Qrel,
    Query,
    SearchResponse,
)


@runtime_checkable
class DatasetAdapter(Protocol):
    @property
    def name(self) -> str:
        """返回稳定的数据集名称。"""

    def corpus(self) -> Iterable[CorpusDocument]:
        """按稳定顺序返回规范化语料。"""

    def queries(self) -> Iterable[Query]:
        """按协议顺序返回规范化查询。"""

    def qrels(self) -> Iterable[Qrel]:
        """返回规范化相关性标注。"""


@runtime_checkable
class RetrieverAdapter(Protocol):
    @property
    def name(self) -> str:
        """返回能够区分实现和配置的检索器名称。"""

    def build(
        self,
        corpus: Sequence[CorpusDocument],
        *,
        artifact_dir: Path,
    ) -> BuildReport:
        """构建检索索引并返回可审计报告。"""

    def search(
        self,
        query: Query,
        *,
        top_k: int,
        recall_k: int,
        rerank_k: int,
    ) -> SearchResponse:
        """执行一次查询，不得擅自修改查询或评测参数。"""

    def reset_query_state(self) -> None:
        """清空疲劳、RNN、flashback等跨查询状态。"""

    def close(self) -> None:
        """释放数据库、子进程或网络资源。"""


@runtime_checkable
class GraphBuilder(Protocol):
    """把语料与 Embedding 构建为 infOS 记忆图（有向边）的契约。

    与 DatasetAdapter 解耦：DatasetAdapter 提供"文本 + 相关性标注"，
    GraphBuilder 提供"图结构"，二者组合才能跑 L2 记忆特性轨道。
    """

    @property
    def name(self) -> str:
        """返回能区分构建策略（如 similarity-deterministic / llm-extract）的名称。"""

    def build_edges(
        self,
        corpus: Sequence[CorpusDocument],
        *,
        embeddings: EmbeddingArtifact,
    ) -> tuple[GraphEdge, ...]:
        """从语料构建有向边，端点必须是 corpus 中的 doc_id。"""
