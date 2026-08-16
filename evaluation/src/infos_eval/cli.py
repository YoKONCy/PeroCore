"""infOS官方评测框架命令行入口。"""

from __future__ import annotations

import argparse
import importlib.util
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from infos_eval.adapter.exact_dense import ExactDenseAdapter
from infos_eval.adapter.synthetic import SyntheticDatasetAdapter
from infos_eval.adapter.triviumdb import (
    TriviumDbRetrieverAdapter,
    TriviumDbRetrieverConfig,
)
from infos_eval.benchmarks.artifacts import write_run_artifacts
from infos_eval.benchmarks.ablation import (
    format_ablation_table,
    graph_gain_data,
    run_ablation,
)
from infos_eval.benchmarks.graph_oracle import (
    builtin_graph_oracle_cases,
    run_graph_oracle_case,
)
from infos_eval.benchmarks.metrics import evaluate_ir
from infos_eval.benchmarks.stateless import StatelessIrRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="infOS官方评测框架")
    parser.add_argument("--version", action="store_true", help="输出框架版本")
    subparsers = parser.add_subparsers(dest="command")
    synthetic = subparsers.add_parser("synthetic", help="运行内置端到端自检")
    synthetic.add_argument("--output", type=Path, default=Path("artifacts/synthetic"))
    synthetic.add_argument("--top-k", type=int, default=3)
    synthetic.add_argument(
        "--retriever",
        choices=("exact-python", "triviumdb-exact", "triviumdb-quiver", "triviumdb-sa-ppr"),
        default="exact-python",
    )
    oracle = subparsers.add_parser("oracle", help="运行SA-PPR闭式oracle自检")
    oracle.add_argument("--output", type=Path, default=Path("artifacts/oracle"))
    subparsers.add_parser("ablate", help="运行图扩散增益消融矩阵")
    return parser


def _run_synthetic(output: Path, top_k: int, retriever_name: str) -> int:
    dataset = SyntheticDatasetAdapter()
    embeddings = dataset.embeddings()
    if retriever_name == "exact-python":
        retriever = ExactDenseAdapter(embeddings)
    else:
        mode = {
            "triviumdb-exact": "exact",
            "triviumdb-quiver": "quiver",
            "triviumdb-sa-ppr": "sa-ppr",
        }[retriever_name]
        retriever = TriviumDbRetrieverAdapter(
            embeddings,
            TriviumDbRetrieverConfig(
                mode=mode,
                expand_depth=2 if mode == "sa-ppr" else 0,
                teleport_alpha=0.15 if mode == "sa-ppr" else 0.0,
            ),
        )
    corpus = tuple(dataset.corpus())
    build_report = retriever.build(corpus, artifact_dir=output / "index")
    runner = StatelessIrRunner(top_k=top_k, recall_k=max(top_k, 64), rerank_k=max(top_k, 32))
    try:
        run = runner.run(dataset, retriever)
    finally:
        retriever.close()
    results_by_query = {
        response.results[0].query_id: response.results
        for response in run.responses
        if response.results
    }
    metrics, per_query = evaluate_ir(results_by_query, dataset.qrels())
    embeddings.save(output / "embeddings.json")
    write_run_artifacts(
        output_dir=output,
        run=run,
        build_report=build_report,
        metrics=metrics,
        per_query_metrics=per_query,
    )
    print(f"评测完成：{output}")
    print(f"nDCG@10={metrics['ndcg@10']:.4f} MRR@10={metrics['mrr@10']:.4f}")
    return 0


def _run_oracle(output: Path) -> int:
    if importlib.util.find_spec("triviumdb") is None:
        print("未安装TriviumDB Python包，无法运行oracle，请执行 `pip install triviumdb==0.7.4`")
        return 1
    cases = builtin_graph_oracle_cases()
    failed_cases = 0
    for case in cases:
        results = run_graph_oracle_case(case, artifact_dir=output / case.name / "index")
        case_ok = all(result.ranking_match and result.scores_match for result in results)
        if not case_ok:
            failed_cases += 1
        print(f"[{'PASS' if case_ok else 'FAIL'}] {case.name}")
        for result in results:
            print(
                f"  q={result.query_id} "
                f"actual=[{','.join(result.actual_ranking)}] "
                f"expected=[{','.join(result.expected_ranking)}]"
            )
    print(f"oracle完成：{len(cases)} 用例，{failed_cases} 失败")
    return 1 if failed_cases else 0


def _run_ablate() -> int:
    if importlib.util.find_spec("triviumdb") is None:
        print("未安装TriviumDB Python包，无法运行消融，请执行 `pip install triviumdb==0.7.4`")
        return 1
    rows = run_ablation(graph_gain_data())
    print(format_ablation_table(rows))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.version:
        try:
            print(version("infos-eval"))
        except PackageNotFoundError:
            print("0.1.0")
        return 0
    if args.command == "synthetic":
        return _run_synthetic(args.output, args.top_k, args.retriever)
    if args.command == "oracle":
        return _run_oracle(args.output)
    if args.command == "ablate":
        return _run_ablate()
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
