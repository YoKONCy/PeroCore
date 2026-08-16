"""无状态IR评测运行器。"""

from __future__ import annotations

from dataclasses import dataclass

from infos_eval.adapter.protocols import DatasetAdapter, RetrieverAdapter
from infos_eval.adapter.validation import validate_search_response
from infos_eval.models import SearchResponse


@dataclass(frozen=True, slots=True)
class StatelessRun:
    dataset_name: str
    retriever_name: str
    responses: tuple[SearchResponse, ...]


class StatelessIrRunner:
    def __init__(self, *, top_k: int, recall_k: int, rerank_k: int) -> None:
        if not 0 < top_k <= rerank_k <= recall_k:
            raise ValueError("必须满足 0 < top_k <= rerank_k <= recall_k")
        self.top_k = top_k
        self.recall_k = recall_k
        self.rerank_k = rerank_k

    def run(
        self,
        dataset: DatasetAdapter,
        retriever: RetrieverAdapter,
    ) -> StatelessRun:
        valid_doc_ids = {document.doc_id for document in dataset.corpus()}
        responses: list[SearchResponse] = []

        for query in dataset.queries():
            retriever.reset_query_state()
            response = retriever.search(
                query,
                top_k=self.top_k,
                recall_k=self.recall_k,
                rerank_k=self.rerank_k,
            )
            validate_search_response(
                response,
                query_id=query.query_id,
                valid_doc_ids=valid_doc_ids,
                top_k=self.top_k,
            )
            responses.append(response)

        return StatelessRun(
            dataset_name=dataset.name,
            retriever_name=retriever.name,
            responses=tuple(responses),
        )
