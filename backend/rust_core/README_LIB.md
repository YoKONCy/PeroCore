# Pero-Memory-Core (pero-rust-core)

🚀 **一个为 AI 记忆而生的极致性能引擎。**

基于 Rust 开发，专为本地化、低功耗、大规模 AI Agent 记忆检索场景设计。

## 🌟 核心特性

- **千万级联想秒开**：基于 Spreading Activation（激活扩散）算法，在 2000 万节点、2000 万关联边的图谱上，5 步联想检索仅需 **0.18ms**。
- **深度记忆回溯**：支持高达 50 步的深度联想，在 1 秒内可处理数十万个关联节点的能量传播。
- **内存极致优化**：使用 Rust CSR 变体结构，内存占用仅为同类向量数据库的 1/10。
- **安全性防护**：内置正则表达式清洗器，原生防止 ReDoS 攻击，并支持意图向量的动态安全验证。
- **开箱即用**：提供纯净的 Python 接口，无需配置复杂的数据库环境。

## 📊 性能表现

| 任务 | 规模 | 耗时 |
| :--- | :--- | :--- |
| 图谱构建 | 4000 万边 | ~24.0s |
| 浅层联想 (5步) | 4000 万规模 | **0.18ms** |
| 深度联想 (50步)| 4000 万规模 | 830ms |
| 文本清洗 | 10万字符 | 0.6ms |

## 🛠 安装方法 (即将发布)

```bash
pip install pero-memory-core
```

## 💻 快速开始

```python
from pero_rust_core import CognitiveGraphEngine

# 初始化引擎
engine = CognitiveGraphEngine()

# 批量添加记忆关联 (src_id, target_id, strength)
engine.batch_add_connections([(1, 2, 0.8), (2, 3, 0.5)])

# 执行记忆扩散联想
# initial_scores: 初始激活点, steps: 扩散步数
results = engine.propagate_activation({1: 1.0}, steps=5)

print(f"联想到的相关记忆点: {results}")
```

## 📜 许可证

GNU General Public License v3.0 (GPL-3.0)
