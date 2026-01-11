# 🚀 PeroCore Core Benchmark Suite

本项目包含 PeroCore 认知引擎（KDN）的精简版核心性能测试与逻辑验证脚本。我们遵循“无偏见、去硬编码”的原则，通过合成复杂拓扑结构与大规模数据流，客观验证引擎在边缘侧的性能上限。

## 📊 三大核心基准测试 (Core Three)

我们已将原本繁杂的测试项合并为三个核心脚本，涵盖了从底层性能到高层逻辑的全方位验证：

| 脚本名称 | 核心关注点 | 验证目标 |
| :--- | :--- | :--- |
| [`benchmark_1_massive_scale.py`](./benchmark_1_massive_scale.py) | **极速吞吐与内存效率** | 验证亿级关联下的写入速度（Million edges/sec）与 CSR 变体结构的内存压缩比。 |
| [`benchmark_2_multi_hop_reasoning.py`](./benchmark_2_multi_hop_reasoning.py) | **多跳逻辑穿透 (Anti-Bias)** | 在数十万随机噪音中隐藏长链逻辑，验证 KDN 扩散模型是否能精准捕捉非邻域逻辑目标。 |
| [`benchmark_3_real_world_integration.py`](./benchmark_3_real_world_integration.py) | **非线性知识网集成** | 模拟真实世界“幂律分布”的复杂知识图谱，验证在 Hub-and-Spoke 拓扑下的联想稳定性。 |

## 🛠️ 内部系统测试 (Internal Tests)

除基准测试外，我们还提供针对特定子系统的内部验证工具，用于更细粒度的功能验证与理论边界探索：

| 脚本名称 | 核心功能 | 适用场景 |
| :--- | :--- | :--- |
| [`internal_test_1_memory_system.py`](./internal_tests/internal_test_1_memory_system.py) | **记忆系统全链路验证** | 验证得分逻辑、多跳关联、故事背景推理及生活模拟数据生成。 |
| [`internal_test_2_aura_vision.py`](./internal_tests/internal_test_2_aura_vision.py) | **AuraVision 视觉性能** | 验证截图预处理延迟、向量化质量与端到端推理性能。 |
| [`internal_test_3_theoretical_limits.py`](./internal_tests/internal_test_3_theoretical_limits.py) | **万亿级扩散理论极限** | 模拟超大规模递归激活传播，验证算法在极端情况下的收敛速度。 |

## 📈 运行方法

确保你已正确安装 `pero-memory-core` (Rust 核心绑定)：

```bash
# 运行完整基准测试套件
python run_all_benchmarks.py

# 或者单独运行某个测试项
python benchmark_1_massive_scale.py 10000000  # 指定千万级规模
```

## 📜 实验设计原则

1.  **去硬编码 (Zero Hardcoding)**：所有测试 ID、节点关系与噪音数据均通过随机算法生成，确保测试结果不依赖于特定的预设路径。
2.  **拓扑驱动 (Topology Driven)**：不再依赖特定的语义字符串（如 HotpotQA 文本），而是直接在拓扑结构上验证 KDN 能量扩散算法的收敛性与准确性。
3.  **边缘侧友好 (Edge-Native)**：所有指标（延迟、内存、吞吐）均针对家用级 PC 或边缘计算设备进行优化与衡量。

## 📜 实验报告

详细的实验数据与数学证明请参阅 [reports](./reports) 目录：
- [KDN 数学收敛性证明](./reports/KDN_mathematical_proof.md)
- [核心基准测试综合报告](./reports/CONSOLIDATED_BENCHMARK_REPORT.md)
