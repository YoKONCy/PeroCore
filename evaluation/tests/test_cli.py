"""合成评测端到端测试。"""

import json

from infos_eval.cli import main


def test_合成评测生成完整产物(tmp_path):
    output = tmp_path / "run"

    assert main(["synthetic", "--output", str(output)]) == 0

    expected = {
        "embeddings.json",
        "build_report.json",
        "metrics.json",
        "per_query_metrics.json",
        "run.trec",
        "stage_traces.json",
    }
    assert expected <= {path.name for path in output.iterdir()}
    metrics = json.loads((output / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["ndcg@10"] == 1.0
    assert metrics["mrr@10"] == 1.0
    lines = (output / "run.trec").read_text(encoding="utf-8").splitlines()
    assert lines[0].startswith("q1 Q0 d1 1 ")
