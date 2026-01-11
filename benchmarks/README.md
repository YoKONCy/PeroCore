# 🚀 PeroCore Benchmark Suite

本项目包含 PeroCore 认知引擎（KDN）的完整性能测试与逻辑验证脚本。我们不仅关注毫秒级的响应速度，更关注在复杂逻辑下的“认知穿透”能力。

## 📊 权威数据集说明 (Authority Datasets)

为了确保测试的科学性与客观性，我们引入了工业界公认的硬核数据集：

### 1. HotpotQA (Multi-hop Reasoning)
*   **来源**：由斯坦福大学、CMU 及蒙特利尔大学联合发布（EMNLP 2018）。
*   **地位**：RAG 领域衡量“多跳推理”能力的金标准。
*   **挑战**：传统的向量 RAG 只能处理单点检索，而 HotpotQA 要求 AI 必须能够跨越多个文档，通过逻辑链条找到答案。
*   **验证脚本**：[`06_hotpotqa_multi_hop.py`](./06_hotpotqa_multi_hop.py)
*   **验证结果**：KDN 引擎成功在 **0.4ms** 内通过“能量扩散”跨越了语义孤岛，找出了跨文档的逻辑关联。

## 📂 脚本说明

| 脚本名称 | 描述 | 核心关注点 |
| :--- | :--- | :--- |
| `01_rag_vs_perocore.py` | 传统向量 RAG vs KDN | 逻辑关联 vs 语义相似 |
| `02_massive_scale_performance.py` | 亿级规模性能测试 | 稀疏矩阵优化与 CSR 性能 |
| `03_cognitive_precision.py` | 认知精确度测试 | 噪音干扰下的目标定位 |
| `04_story_intent_reasoning.py` | 故事情节意图推理 | 动态语义流的捕捉 |
| `05_scientific_rag_validation.py` | 跨学科科学 RAG 验证 | 解决长链条逻辑断层 |
| `06_hotpotqa_multi_hop.py` | **HotpotQA 权威评测** | 工业级多跳推理验证 |

## 📈 运行方法

确保你已安装 `pero-memory-core` (Rust 核心绑定)：

```bash
# 运行所有基准测试
python run_all_benchmarks.py

# 运行 HotpotQA 权威验证
python 06_hotpotqa_multi_hop.py
```

## 📜 实验报告

详细的实验数据与数学证明请参阅 [reports](./reports) 目录：
- [KDN 数学收敛性证明](./reports/KDN_mathematical_proof.md)
- [综合性能验证报告](./reports/PEROCORE_FULL_BENCHMARK_REPORT.md)
- [HotpotQA 验证日志](./reports/06_hotpotqa_results.md)
