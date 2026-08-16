"""Adapter结果校验测试。"""

import pytest

from infos_eval.adapter.validation import AdapterContractError, validate_search_response
from infos_eval.models import SearchResponse, SearchResult


def test_拒绝重复文档ID():
    response = SearchResponse(
        results=(
            SearchResult("q1", "d1", 1, 1.0, "test"),
            SearchResult("q1", "d1", 2, 0.9, "test"),
        )
    )
    with pytest.raises(AdapterContractError, match="重复doc_id"):
        validate_search_response(response, query_id="q1", valid_doc_ids={"d1"}, top_k=10)


def test_拒绝不连续rank():
    response = SearchResponse(
        results=(SearchResult("q1", "d1", 2, 1.0, "test"),)
    )
    with pytest.raises(AdapterContractError, match="rank"):
        validate_search_response(response, query_id="q1", valid_doc_ids={"d1"}, top_k=10)


def test_拒绝非有限分数():
    response = SearchResponse(
        results=(SearchResult("q1", "d1", 1, float("nan"), "test"),)
    )
    with pytest.raises(AdapterContractError, match="有限数值"):
        validate_search_response(response, query_id="q1", valid_doc_ids={"d1"}, top_k=10)
