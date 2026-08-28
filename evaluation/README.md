# infOS 评测标准（Evaluation Standard）

本文档定义 infOS 记忆系统与底层 TriviumDB 的官方评测标准，回答三个问题：

1. **数据从哪来** —— 如何用 LLM 把标准数据集转成 infOS 可跑的图化数据集；
2. **怎么跑常规评测** —— 无状态 IR 的正确性与指标；
3. **怎么做语义相关评测** —— LLM 打分、端到端 + LLM 打分。

阅读前先明确一个定位原则：**infOS 记忆系统的目标不是 IR@10 高分，而是"在正确的时间召回正确的那条记忆、抑制噪声、节省上下文，从而支撑正确回答"**。因此本标准的北极星是"证据召回 + 端到端答对"，而非单榜排序指标。

---

## 1. 评测分层矩阵

官方不产出"单榜 @10"，而是分层评测，每层回答不同的问题：

| 层 | 名称 | 回答的问题 | 状态 |
|---|---|---|---|
| L0 | 契约层 | Adapter 输入输出/ID 映射/确定性是否正确 | ✅ 已实现 |
| L1 | 无状态 IR | 检索"没做坏"（锚点，非目标） | ✅ 已实现 |
| L2 | 记忆特性层 | 记忆系统"做得好不好"（真正的目标） | 📐 标准已定，部分实现 |
| L3 | 系统性能层 | 构建/延迟/内存/大规模 ANN 质量 | 📐 标准已定 |

- L0/L1 与性能无关，任何提交必须通过；
- L2 是 infOS 的核心评测轨道，见 [第 4 节](#4-语义相关评测l2--端到端)；
- L3 用于回归防退化。

---

## 2. 数据准备：如何用 LLM 转数据集

这是评测记忆系统**最痛**的一环。标准数据集（BEIR、对话语料等）给的是"文本 + 相关性标注"，而 infOS 检索依赖"带边语义的演化图"。二者之间的 gap 不是字段映射能填的——必须真的把文本"炼化"成图。海量对话养数据、或把标准数据丢进完整炼化生命周期，都会把 token/时间成本转嫁给每个复现者，不可接受。

因此官方约定三条图供给路径，按成本从高到低：

### 2.1 三条图供给路径

| 路径 | 说明 | 复现成本 | 适用场景 |
|---|---|---|---|
| A. 官方图化工件 | 官方离线跑一次"文本→图"，固化为版本化工件分发 | 零（只下载） | 官方基准、公平对比 |
| B. 确定性图合成器 | embedding 相似度 + 规则连边，不调 LLM（✅ 已实现） | 极低（O(N) 向量计算） | 消融实验、自定义数据 |
| C. LLM 关系抽取 | 用 LLM 从文本抽取记忆节点与边（完整流程见下） | 中（只对选定小基准做一次） | 需要高保真语义边的基准 |

**核心原则**：图评测的"正确性"只能靠自建 oracle（见 [第 5 节](#5-图扩散正确性sa-ppr-oracle)），标准数据只当"文本底料"。因此"官方图化工件"只需对**选定的、小规模**基准做一次，永久复用。

#### 路径 B 用法（`DeterministicGraphBuilder`）

```python
from infos_eval.adapter.deterministic_graph import (
    DeterministicGraphBuilder,
    SimilarityGraphConfig,
)
from infos_eval.adapter.triviumdb import (
    TriviumDbRetrieverAdapter,
    TriviumDbRetrieverConfig,
)

builder = DeterministicGraphBuilder(SimilarityGraphConfig(threshold=0.8))
edges = builder.build_edges(corpus, embeddings=embeddings)

retriever = TriviumDbRetrieverAdapter(
    embeddings,
    TriviumDbRetrieverConfig(mode="sa-ppr", expand_depth=2, teleport_alpha=0.15),
    edges=edges,
)
```

相似度超过阈值即连双向 `related` 边，权重等于余弦相似度，结果完全确定。

### 2.2 LLM 转数据集的完整流程（路径 C）

目标：把一份标准数据（文档集 / 多会话对话）转成 infOS 可直接加载的图化数据集。

```
原始数据
   │  ① 分块 & 语义去重
   ▼
语料块（corpus）
   │  ② embedding 向量化（固定 provider/model，规范化）
   ▼
EmbeddingArtifact
   │  ③ LLM 抽取记忆节点（记忆 = 一条可独立召回的事实/事件，附时间戳/主体）
   ▼
记忆节点（nodes）
   │  ④ LLM 标注关系（边类型 + 权重）
   ▼
GraphEdge[]（有向边）
   │  ⑤ 生成查询 + 相关性标注（qrels，可 LLM 辅助 + 人工复核）
   ▼
图化数据集（corpus + embeddings + edges + queries + qrels）
```

#### 产物 schema（与框架数据模型一一对应）

```json
{
  "schema_version": 1,
  "dataset": "sci-fact-graphified-v1",
  "corpus": [
    {"doc_id": "d1", "title": "标题", "text": "正文", "metadata": {"ts": 1700000000}}
  ],
  "edges": [
    {"src": "d1", "dst": "d2", "label": "related", "weight": 1.0}
  ],
  "queries": [
    {"query_id": "q1", "text": "问题", "metadata": {}}
  ],
  "qrels": [
    {"query_id": "q1", "doc_id": "d1", "relevance": 2}
  ]
}
```

对应代码中的 `CorpusDocument` / `GraphEdge` / `Query` / `Qrel`（见 `infos_eval.models`）。

#### 关系抽取判据（供 LLM 使用的 rubric）

| 边类型 | 语义 | 权重建议 |
|---|---|---|
| `related` | 一般语义相关 | 1.0 |
| `supports` / `refutes` | 证据支持/反驳 | 1.0（refutes 可用 `inhibition` 表示负能量） |
| `inhibition` | 抑制边，传播负能量 | 按负权重处理 |
| `temporal_next` | 时间先后 | 按时间差归一化 |

LLM 抽取关系时要求输出 `(src, dst, label, weight)` 四元组，并满足：

- `src`/`dst` 必须指向已存在的记忆节点 id；
- 一条边必须能从一个判断句推导（可追溯、可人工复核）；
- 抽取后用 schema 校验、端点闭合校验、去重（同向同 label 合并）。

#### 成本控制与可复现

- **只对选定小基准做**（长记忆对话基准通常几十~几千条，见下），不做全量；
- 固定 `seed`、`model`、`prompt_version`，产物落盘后指纹校验（对齐 `EmbeddingArtifact` 的做法）；
- 官方工件带版本号，本地缓存，复现者零 token。

---

## 3. 常规评测（L1 无状态 IR）

已实现，可直接运行。

### 3.1 指标

`infos_eval.benchmarks.metrics.evaluate_ir` 输出逐 query 与宏平均：

- `ndcg@10` / `ndcg@100`：分级相关性的归一化折损累计增益；
- `recall@10` / `recall@100`：相关文档召回率；
- `mrr@10`：首个相关文档的倒数排名。

### 3.2 内置检索器

| 检索器 | 说明 |
|---|---|
| `exact-dense-python` | 纯 Python 精确余弦，**审计锚点** |
| `triviumdb-exact` | TriviumDB 暴力精确 |
| `triviumdb-quiver` | TriviumDB QuIVer ANN |
| `triviumdb-sa-ppr` | TriviumDB SA-PPR 图扩散 |

### 3.3 运行方式

CLI 内置合成数据自检：

```powershell
infos-eval synthetic --retriever triviumdb-sa-ppr --top-k 3 --output artifacts/synthetic
```

程序化运行：

```python
from infos_eval.adapter.synthetic import SyntheticDatasetAdapter
from infos_eval.adapter.exact_dense import ExactDenseAdapter
from infos_eval.benchmarks.stateless import StatelessIrRunner
from infos_eval.benchmarks.metrics import evaluate_ir
from infos_eval.benchmarks.artifacts import write_run_artifacts

dataset = SyntheticDatasetAdapter()
embeddings = dataset.embeddings()
retriever = ExactDenseAdapter(embeddings)
corpus = tuple(dataset.corpus())

build_report = retriever.build(corpus, artifact_dir=Path("artifacts/index"))
runner = StatelessIrRunner(top_k=3, recall_k=64, rerank_k=32)
run = runner.run(dataset, retriever)

results_by_query = {r.results[0].query_id: r.results for r in run.responses if r.results}
metrics, per_query = evaluate_ir(results_by_query, dataset.qrels())
write_run_artifacts(
    output_dir=Path("artifacts"),
    run=run,
    build_report=build_report,
    metrics=metrics,
    per_query_metrics=per_query,
)
```

### 3.4 产物

每次运行产出可审计文件：`run.trec`（TREC 标准格式）、`build_report.json`、`metrics.json`、`per_query_metrics.json`、`stage_traces.json`。

---

## 4. 语义相关评测（L2 + 端到端）

这是 infOS 的核心轨道。评分不依赖手工 qrels，而用 **LLM + 判据标准**。两种打分模式：

### 4.1 模式一：LLM 直接打分（retrieval-as-judged）

对每个 query，把「query + 召回结果列表」交给 LLM，按判据逐条打相关性分（0~3），再计算 nDCG/Recall/Precision。

**相关性判据（rubric）**：

- `3` 完全相关：直接回答 query，或提供回答所必需的关键事实；
- `2` 部分相关：提供部分证据，需结合其他记忆才能完整回答；
- `1` 弱相关：同主题但不足以支撑回答；
- `0` 不相关。

**优点**：不依赖预先标注 qrels，适合没有 ground-truth 的开放数据。

### 4.2 模式二：端到端 + LLM 打分（answer-as-judged）

这是最能代表"记忆系统真实价值"的模式：

```
query → 检索（召回记忆）→ 拼接上下文（固定 token 预算）→ 生成答案 → LLM 按判据打分
```

**答案判据（rubric）**：

- 正确性：答案事实是否准确、是否被召回记忆支撑（不编造）；
- 完整性：是否覆盖 query 的所有要点；
- 证据利用率：答案是否真正用上了召回的记忆（而非无视召回硬答）；
- 忠实度：答案是否与召回记忆一致（幻觉检测）。

### 4.3 记忆特性轨道（L2 的核心指标）

这些指标不是 @10，而是记忆系统特有的能力：

| 指标 | 定义 | 判据 |
|---|---|---|
| 证据召回率（Evidence Recall） | 给定需引用历史的问题，能否召回到支撑答案的记忆片段 | LLM 判断"召回集是否含足以作答的证据" |
| 端到端答对率（E2E Accuracy） | 召回→拼上下文→生成，最终答案对不对 | 模式二打分 |
| 上下文预算命中（Hit@Budget） | 固定 token 预算下能答对多少 | 在 1k/2k/4k token 预算下分别测 |
| 时间一致性 | 新记忆是否压过旧记忆（recency） | 构造新旧冲突记忆，看是否选新 |
| 重复抑制 | 召回集去重后的信息密度 | 相同语义记忆不应重复占用预算 |
| 图扩散质量 | SA-PPR 是否沿语义边扩散到"向量不相似但图相关"的节点 | 用 [第 5 节](#5-图扩散正确性sa-ppr-oracle) 的 oracle 校准 |

---

## 5. 图扩散正确性（SA-PPR Oracle）

图评测的"正确性标尺"，不依赖任何外部数据，零 token、完全可复现。

### 5.1 原理

`infos_eval.benchmarks.graph_oracle.simulate_sa_ppr` 逐语句复现 TriviumDB 的有限深度 SA-PPR（个性化重启、绝对权重归一化、抑制边负能量、悬挂节点回注）。用人工构造的正交向量小图，期望排名可手算唯一确定。

### 5.2 运行方式

```powershell
infos-eval oracle --output artifacts/oracle
```

内置三个用例：`chain`（深度传播 + 重启）、`branch`（出边权重归一化）、`inhibition`（抑制边负能量）。

### 5.3 约束

图扩散的正确性**只能靠 oracle 自证**，标准数据集里没有"边真值"。任何改动 SA-PPR 的实现，必须让 `infos-eval oracle` 全 PASS，否则视为回归。

### 5.4 图扩散价值消融

oracle 回答"算没算对"，消融矩阵回答"值不值、参数怎么调"。`infos-eval ablate` 在一个专门构造的 `graph_gain` 数据集上，对照纯向量基线、ground-truth 语义边、相似度建图三者的 recall：

| 观察 | 结论 |
|---|---|
| 基线 recall@2 = 0.5 | 语义邻居向量正交，纯向量检索召回不到 |
| ground-truth 边 + 低 alpha recall@2 = 1.0 | 图扩散补足了向量召回 |
| 相似度建图 recall@2 = 0.5 | 相似度建图建不出正交语义边（零权重边被跳过），无法替代语义边 |
| alpha 增大时扩散收益被重启稀释 | teleport_alpha 是图扩散质量的敏感参数 |

---

## 6. 可复现性规范

所有评测必须满足：

1. **确定性**：固定 seed、固定 embedding（provider/model）、固定候选池参数；
2. **可审计**：产出 TREC + 各阶段 trace + build report，任何结论可追溯；
3. **锚点对比**：任何检索器结果必须与 `exact-dense-python` 锚点对照，排除"实现坏了"；
4. **版本化**：数据集工件、图工件、prompt 都带版本号与指纹；
5. **默认/调优分离**：报告同时给 `Default`（官方默认配置）与 `Tuned`（最优配置），禁止只报调优结果。

---

## 7. 快速上手（最小闭环）

```powershell
# 1. 常规 IR 自检（无需外部数据）
infos-eval synthetic

# 2. SA-PPR 图扩散正确性（需 triviumdb==0.8.1）
infos-eval oracle

# 3. 图扩散价值消融矩阵（需 triviumdb==0.8.1）
infos-eval ablate
```

从零接入一个新数据集，只需实现 `DatasetAdapter`（corpus/queries/qrels）与 `EmbeddingArtifact`；若要做图评测，再补 `GraphEdge` 与 [第 2.2 节](#22-llm-转数据集的完整流程路径-c) 的 LLM 抽取产物。
