"""评测运行产物的稳定序列化。"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from infos_eval.benchmarks.stateless import StatelessRun
from infos_eval.models import BuildReport


def write_trec_run(run: StatelessRun, path: Path, *, run_name: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"{result.query_id} Q0 {result.doc_id} {result.rank} {result.score:.12g} {run_name}"
        for response in run.responses
        for result in response.results
    ]
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )


def write_run_artifacts(
    *,
    output_dir: Path,
    run: StatelessRun,
    build_report: BuildReport,
    metrics: dict[str, float],
    per_query_metrics: dict[str, dict[str, float]],
) -> None:
    write_trec_run(run, output_dir / "run.trec", run_name=run.retriever_name)
    write_json(output_dir / "build_report.json", asdict(build_report))
    write_json(output_dir / "metrics.json", metrics)
    write_json(output_dir / "per_query_metrics.json", per_query_metrics)
    traces = [
        {
            "query_id": response.results[0].query_id if response.results else None,
            "timings_ms": dict(response.stage_timings_ms),
            "counts": dict(response.stage_counts),
            "diagnostics": dict(response.diagnostics),
        }
        for response in run.responses
    ]
    write_json(output_dir / "stage_traces.json", traces)
