"""Adapter结果与ID映射的基础校验。"""

from __future__ import annotations

import math
from collections.abc import Collection

from infos_eval.models import SearchResponse


class AdapterContractError(ValueError):
    """Adapter违反评测契约。"""


def validate_search_response(
    response: SearchResponse,
    *,
    query_id: str,
    valid_doc_ids: Collection[str],
    top_k: int,
) -> None:
    if len(response.results) > top_k:
        raise AdapterContractError("返回结果数量超过top_k")

    seen: set[str] = set()
    for expected_rank, result in enumerate(response.results, start=1):
        if result.query_id != query_id:
            raise AdapterContractError("结果query_id与当前查询不一致")
        if result.rank != expected_rank:
            raise AdapterContractError("结果rank必须从1开始连续递增")
        if result.doc_id not in valid_doc_ids:
            raise AdapterContractError(f"结果包含未知doc_id: {result.doc_id}")
        if result.doc_id in seen:
            raise AdapterContractError(f"结果包含重复doc_id: {result.doc_id}")
        if not math.isfinite(result.score):
            raise AdapterContractError("结果score必须为有限数值")
        seen.add(result.doc_id)
