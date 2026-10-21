# 记忆引擎架构 (PEDSA)

> **适用范围**：`packages/backend/src/services/memory/`
> **核心引擎**：SQLite (Drizzle) + TriviumDB (Vector + Graph)
> **理论基础**：PEDSA v2 (Pipeline for Embedded Directed Semantic Analysis)
> **最后更新**：2026-10-17

---

## 1. 记忆存储层级

| 分层                  | 载体                   | 存储内容                       | 检索方式              | 生命周期         |
| --------------------- | ---------------------- | ------------------------------ | --------------------- | ---------------- |
| **Layer 0 (Working)** | JSON / LLM Context     | 当前会话 Context               | 顺序读取              | 短期（单次会话） |
| **Layer 1 (Vector)**  | **TriviumDB**          | 事件向量 + 文本索引            | 向量检索 + BM25       | 长期             |
| **Layer 2 (Graph)**   | **TriviumDB**          | 事件图谱 + 关系边              | 图谱扩散 + 确定性 BFS | 长期             |
| **Layer 3 (Diary)**   | **Workspace Markdown** | 每日人格日记 `dailynotes/*.md` | 按日期读取            | 永久             |

> Layer 3 的每日人格日记写入 Agent Workspace，**不进入事件记忆库**；另有全 Agent 共享的 **Facts Store**（`facts.tdb`），仅经工具访问、不自动注入 Prompt。TriviumDB 为运行/检索权威，SQLite 保存完整备份与事务日志。

---

## 2. 写入管线 (EventNote Pipeline)

长记忆不再经"摘要节点"，而是 **Agent 主动记事 + 后台兜底补记**：

1. **主动记事**：Agent 在 ReAct 中调用 `write_event_note` / `revise_event_note`，只创建本回合 `EventNoteDraft`。
2. **回合提交**：Assistant 消息成功持久化后，Draft 才正式提交为 EventNote，并登记消息覆盖关系。
3. **后台补记**：只处理尚未被覆盖的连续消息区间，可产出 0~N 条事件，并写入 `ConversationCoverage`（含 `reviewed_no_event`）。
4. **时间链**：按 `eventAt` 追加/插入并修复 `temporal_next` / `temporal_prev`。
5. **关系维护**：由后台 Reflection 建立 `caused_by` / `same_event` / `same_topic` / `involves_*` 边。

---

## 3. 检索策略

记忆检索拆成两条合同不同的路径：

1. **对话前自动 RAG**：默认向量 + BM25；可在总览页启用 **SA-PPR 高级管线**（含 FISTA / DPP / ContextRNN / Leiden / 反馈闭环）。固定补充物理时间轴末尾事件与每个命中事件的直接前驱，均不占 `top_k`。
2. **Agent 主动图查询**（`query_event_notes`）：确定性 **BFS**，严格遵守方向、边标签、最大深度、最大节点数与返回 Token 预算，**不受 SA-PPR 开关影响**。

---

## 4. 记忆维护与补记

当前事件记忆由主动记录、后台补记和关系维护分工处理：

- **后台补记**：每个已启用 Agent 累计在线运行 8 小时后，补记其所有普通 Thread 中尚未主动记录或审阅的完整对话。每分钟只检查是否到点；轮数、容量、Thread 休眠、日界和窗口退出均不能提前触发补记。
- **持久计时**：独立轻量心跳每 30 秒把在线时长累加到 SQLite，正常关闭时补存尾段。关机、退出、关闭长记忆后台开关和角色停用期间暂停累计，恢复后沿用原值；进程重启不根据墙上时钟补算离线时间，长时间系统挂起也不补算。意外断电最多可能损失最后一个尚未落盘的心跳间隔。新版计时与旧静默计时隔离，不继承旧门控积攒的时长。
- **主动记事与周期结算**：主动记事只覆盖对应来源，不清零八小时时钟。周期到点固定消息 ID 上界，分批和重试只处理该边界之前的数据，后来追加或尚未回复完整的对话留到后续周期。所有批次审阅完成后才推进 Agent 的周期进度；无事件时也保存 `reviewed_no_event`，不重复调用模型。
- **容量分批**：按补记模型的上下文容量，扣除已渲染人格、任务提示词和输出预留后动态分成多批；通常保留完整轮次，单轮正文过大时进一步按 Token 切片，不截掉正文。片段结果持久保存，整轮所有片段完成且来源仍有效后才提交覆盖；不受前台聊天窗口或最近一万轮读取上限影响。
- **人格与叙事**：补记、反思均读取所属 Agent 的人设、名称、专属称呼和通道人格补充。补记以角色自己的视角记事；关系维护保留已有叙事声音，不为了统一格式重写主动记事。只同步已确认未被用户修改的旧内置任务提示词，用户定制正文保留。
- **失败与并发**：失败按 5、10、20、40、60 分钟退避，最长间隔 1 小时；Coverage Claim 防重复，执行前重新校验覆盖范围，提炼期间消息发生变化则丢弃旧结果。分片及整批模型结果先持久化，后续写入失败时沿用原结果。编辑、撤回只重开命中的来源，未变化轮次的已审阅结论保留，不会整批重新凑数。
- **关系维护**：每 5 分钟增量维护；失败按 5、15、30、60 分钟退避，连续五次失败停止自动调用。维护修订不重新触发维护自身；决策持久化后可恢复未完成操作。
- **时间语义**：数据库存储 UTC 时刻；上下文、提炼与关系维护中的时间使用设备本地时间并附显式时区偏移。`eventAt` 为事件时间，`createdAt` 为记录或修订时间。

2026-10-21 验证：全量 334 个测试文件、2,112 项测试通过；工作区与测试代码类型检查、ESLint 均通过。回归覆盖累计在线与离线暂停、重启续接、主动记事排除、空事件覆盖、容量分批、重复正文分片身份、失败缓存恢复与来源编辑失效。本次未运行应用构建。

---

## 5. TriviumDB 接入规范

后端与社交应用统一固定 **0.8.9**。Store 注册表负责旧格式写入前备份、完整文件组重建/清理及一致性快照；持久化正文旁路文件 `.tdb.pld.<generation>`、属性/图索引与 flush marker 必须随主库一起处理。升级本身不修改 Embedding 维度，也不要求重新生成向量。每个常驻 Store 的 Payload 缓存上限为 32 MiB、单条缓存上限为 4 MiB；只读临时 Store 使用 8 MiB。具体回退约束见 [A08_DEVOPS](./A08_DEVOPS.md#23-迁移原则)。

TS 层必须通过 `VectorWriteHelper` 操作数据库，确保原子性：

```typescript
// insertWithId 确保 SQLite ID ↔ TriviumDB ID 一致
store.insertWithId(sqliteId, vector, payload)
// 必须调 buildTextIndex() 增量索引才生效
store.buildTextIndex()
// 开启自动压缩防止内存膨胀
store.enableAutoCompaction(300)
```

---

## 6. 核心数据对象

### 6.1 EventNote (TDB + SQLite 备份)

Agent 第一人称事件记事：`id`、`agentId`、`narrative`、`eventAt`（系统权威时间）、`createdAt`、`importance`、`affect{tones,valence,arousal}`、`participants/places/objects/topics`、`origin{mode,threadId,pairIds,messageIds,channel}`、`status(active/archived)`。运行时以 TriviumDB 为权威，SQLite 保存完整备份与事务日志。

### 6.2 ConversationCoverage (SQLite)

记录对话区间的覆盖结论：`outcome = event_recorded | reviewed_no_event`，据此避免后台重复炼化，并在对话回溯/清理时定位受影响事件。

### 6.3 Facts (共享 Store)

全 Agent 共享的对象事实库（`facts.tdb`）：`objectKey` / `statement`，支持 `superseded_by` 取代链；仅经工具访问。

## 7. 记忆边界与来源追溯

长记忆的事件记事体系必须遵守以下约束：

1. 事件记忆归属 `agentId`，不归属 Session 或 Thread；Thread 仅提供可追溯来源（`origin.pairIds/messageIds/channel`）。
2. 系统消息时间是事件时间的唯一权威（`eventAt`），Agent 不填写或推断时间。
3. 同一事件由 `EventNote` 承载；后台只对未覆盖区间补记，零事件区间以 `reviewed_no_event` 记录，避免重复扫描。
4. 每个 EventNote 保留完整 **Provenance**（来源消息、channel、创建方式），可回答"从哪来、是否已被修订"。
5. Agent 私有 Store（`memory.tdb`）与共享 `facts.tdb` 按 Agent/全局隔离；TriviumDB 为运行权威，SQLite 为完整备份 + 事务日志（`operationId` 幂等提交，可全量重建）。

---

## 8. Memory Resource与Context映射

长期记忆是跨Execution持久的Resource，不是Prompt字符串或Context Compiler私有状态。Memory Region进入模型前必须记录：

- `agentId`、Store与来源对象；
- Snapshot/Revision或查询时间；
- 检索Query、命中依据和排序分数；
- Token预算、裁剪原因与可见性；
- Provenance、Trust与是否为Derived Observation。

Context Compiler只能按Policy将Memory Resource物化为Region，不得在编译期间修改事件记忆。RAG按需检索等价于Context地址空间的缺页处理；相同资源Snapshot、Query和Policy应产生可复现的Context Manifest。Observer产生的Agent State属于独立Derived Resource，默认不进入Prompt，必须由Thread ContextPolicy与Observer Policy双重启用。

记忆跨Application回流必须经过`infos.knowledge.submit_candidate`或等价Checkpoint/MemoryCandidate Port与主Agent MemoryGate；Application自己的领域状态和私有记忆仍由其Store/Authority持有，不能直接写入Agent的事件记忆。Application查询知识使用收窄的`infos.knowledge.query` Capability，只获得结果与Provenance，不获得TriviumDB文件、Repository或数据库连接。具体协议见 [A10_APPLICATION_INTEGRATION](./A10_APPLICATION_INTEGRATION.md)。

---

## 9. ContextRNN 按需生命周期

ContextRNN 是 SA-PPR 高级管线的可选子模块，默认关闭。只有 `advanced.enableSaPpr && advanced.enableContextRnn` 同时成立且实际进入自动 RAG 时，`ContextRnnRuntime` 才创建模型实例并加载权重；打开设置本身不创建实例。基础向量/BM25 查询和 Agent 主动图谱查询不调用 RNN。

- 反馈训练还要求 `advanced.enableFeedback`；关闭 ContextRNN 时配置校验与前端会同时关闭反馈，检索不再保留训练轨迹。
- 热关闭高级管线或 ContextRNN 后，统一落盘尚未保存的变更并释放实例。配置代次使等待 Embedding 的旧检索、旧反馈失效，防止迟到请求重新创建或训练已关闭的模型。
- 隐状态按 Agent 与 Channel 隔离；投影、输出、minGRU 权重保持现有共享格式，已有二进制文件可继续读取。
- 状态和各类权重分别记录脏标记。检查点只写发生变更的项，加载已有文件不会产生脏标记，无变更时不写盘、不打印保存日志。
- KernelScheduler 的周期计划支持轻量 `shouldRun` 条件；RNN 未实例化、关闭或无变更时，保存计划不创建 Execution，也不增加运行统计。
- 专用记忆配置接口和通用配置的单项、批量、导入、删除入口都同步生命周期。进程退出只刷新已创建实例的未保存变更，不创建模型。

_本文档由 Carola 整理，适用于 infOS-TS 记忆引擎架构规范。_
