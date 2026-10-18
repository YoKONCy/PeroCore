# 长记忆体系重构临时规划

> 状态：讨论阶段的约束基线。本文记录已经确认的方向、建议架构、迁移顺序和待决事项；在设计收敛前不直接改造生产链路。
>
> 范围：主 Agent 事件记忆、自动与主动检索、后台兜底炼化、记忆维护、每日人格日记，以及全 Agent 共享的系统知识库与事实库。

## 1. 重构目标

将现有“Scorer 定期生成摘要节点”的长记忆模式，重构为三个边界清晰的能力：

1. **怎么存**：Agent 主动记录事件，系统后台仅负责动态兜底；事件以系统时间轴为权威主干。
2. **怎么取**：保留对话前的轻量自动 RAG，同时向 Agent 提供可指定查询方式的主动查询工具。
3. **怎么维护**：保留反思维护，但所有合并、修订、退役和建边必须遵循统一事件记忆生命周期。

目标不是继续优化旧摘要节点，而是把长记忆重新定义为：

> Agent 对自己与用户之间真实互动的主观事件记事。

## 2. 已确认决策

- “事件”只指 Agent 与用户在 infOS 对话中发生的互动，不处理角色扮演叙事中的虚构历史时间。
- 系统消息时间是事件时间的唯一权威来源，Agent 不填写或推断时间。
- 每个 Agent 拥有独立事件记忆库，禁止不同 Agent 混用时间轴和事件节点。
- Agent 在 ReAct 中可以主动提出写记事，但正式写入必须等当前回合成功结束后提交。
- 第一版立即支持 `revise_event_note`，修订同样采用 Draft，并在回合成功结束后提交。
- Agent 可以请求覆盖当前 Thread 中更早的未覆盖 Pair，但事件记叙必须以尚未记录的事件为主，不能借扩展覆盖范围重复改写已有事件。
- 回合取消、失败、持久化失败或 Draft 被撤销时，不提交事件记事。
- 后台炼化不再使用固定批次机械产出摘要，而是仅处理尚未被事件记事覆盖的消息区间，并允许产出零条、一条或多条事件。
- 自动 RAG 与 Agent 主动查询工具并存；复杂时间、逻辑、人物、地点、主题等查询交给工具完成。
- 时间轴是绝对主干，其他关系作为从时间轴向外扩展的路网。
- 每日人格日记只是 Agent Workspace 中的 Markdown 文档，不进入复杂事件记忆生命周期。
- 系统知识库与事实库为全 Agent 共享资源，不自动 RAG 注入，只能通过工具查询。
- 事实更新默认保留 `superseded_by` 演化链；明确错误或垃圾内容才物理删除。
- 后续可将 TriviumDB 更新到 0.8.2，并补充 infOS 所需的通用图查询与原子写入能力。

## 3. 领域边界

### 3.1 每个 Agent 私有

```text
data/
├─ agent_pero/
│  └─ memory.tdb
└─ agent_nana/
   └─ memory.tdb
```

事件记忆必须按 `agentId` 物理隔离。Desktop、轻量陪伴与 infOS 据点可以共享该 Agent 的事件记忆，但必须保留真实来源 Channel、Thread、Pair 和消息。

### 3.2 全 Agent 共享

```text
data/
└─ knowledge/
   └─ facts.tdb
```

- `facts.tdb`：第一阶段实际创建的全 Agent 共享对象事实库。
- `knowledge.tdb`：第一阶段仅保留 `KnowledgeStorePort` 合同，不创建文件、不注册工具；后续单独设计资料、文档、概念和章节的摄入协议。

### 3.3 Workspace 普通文档

```text
principals/{agentId}/workspace/
└─ dailynotes/
   ├─ 2026-08-27.md
   ├─ 2026-08-28-part-1.md
   └─ 2026-08-28-part-2.md
```

每日人格日记不承担事件记忆检索和图谱职责。

## 4. 事件记事模型

第一版建议将事件记事收敛为以下核心结构，最终字段名需要在实现前冻结：

```typescript
interface EventNote {
  id: string
  agentId: string

  /** Agent 第一人称记录本次与用户发生的互动 */
  narrative: string

  /** 事件在对话时间轴中的位置，由系统消息时间生成 */
  eventAt: string

  /** 正式提交到记忆库的系统时间，仅用于审计 */
  createdAt: string

  /** 0~10 整数 */
  importance: number

  affect: {
    tones: string[]
    /** 0 表示最负面，5 表示中性，10 表示最正面 */
    valence: number
    /** 0 表示最平静，10 表示最强烈 */
    arousal: number
  }

  participants: string[]
  places: string[]
  objects: string[]
  topics: string[]

  origin: {
    mode: 'active' | 'background'
    threadId: string
    pairIds: string[]
    messageIds: string[]
    channel: string
  }

  status: 'active' | 'archived'
}
```

### 4.1 时间规则

- `eventAt` 完全由系统确定，Agent 不传入时间。
- 主动记事：取当前回合最后一条成功持久化消息的系统时间。
- 后台兜底：取被该事件覆盖的消息区间中最后一条消息的系统时间。
- `createdAt` 取事件记事正式提交时的系统时间。
- 时间轴按 `eventAt ASC` 排序。
- 同一时间戳出现多个事件时，使用稳定 ID 或提交序号作为确定性次排序键。

### 4.2 时间链

TDB 中为每个 Agent 维护：

```text
temporal_next
temporal_prev
```

时间链必须支持：

- 追加最新事件；
- 后台延迟处理后插入历史位置；
- 删除或取代事件后的前后链修复；
- 从任意事件向前或向后确定性遍历；
- 从事件时间字段重新构建整条链。

时间字段是排序事实，双向链和 TDB 时间边是可重建导航投影。

## 5. 主动记事协议

### 5.1 工具

第一版提供：

```text
write_event_note
revise_event_note
query_event_notes
```

`write_event_note` 与 `revise_event_note` 第一版同时实现。两者对 Agent 表现为写入或修订记事，内部都只创建当前 ReAct 回合的 `EventNoteDraft`，不会在工具调用发生时直接改动正式记忆。

### 5.2 Draft 内容

Agent 只负责提交认知内容，例如：

- `narrative`；
- `importance`；
- 情感基调；
- 人物、地点、事物、主题。

Agent 不在记事工具中提交关系边；关系候选发现和语义建边由后台 Reflection 完成。

系统自动附加：

- `agentId`；
- `threadId`；
- `pairId`；
- `messageIds`；
- `channel`；
- `eventAt`；
- `createdAt`；
- `toolCallId` 与 Execution 审计信息。

禁止 Agent 自行填写 Provenance、系统时间和内部消息 ID。

### 5.3 回合结束提交

```text
ReAct 调用 write_event_note
  ↓
创建内存态或Execution态 EventNoteDraft
  ↓
继续完成当前回复
  ↓
Assistant 消息成功持久化
  ↓
提交 EventNote
  ↓
登记消息覆盖关系
  ↓
更新 SQLite 备份与 pending 事务日志
  ↓
按 operationId 幂等提交 TDB 主空间
  ↓
SQLite 标记 committed
```

以下情况丢弃 Draft：

- 用户取消；
- ReAct 最终失败；
- Assistant 消息持久化失败；
- 对话回溯撤销了该 Pair；
- Agent 在同一回合显式撤销 Draft。

同一回合允许零条、一条或多条 EventNoteDraft。`revise_event_note` 必须携带目标 EventNote ID。提交修订时：

1. 创建新的 EventNote ID；
2. 继承旧事件的 `eventAt` 和原 Coverage；
3. 将本次新增覆盖范围并入新版本；
4. 在同一 TDB 图操作中用新节点替换旧节点的时间轴位置和有效关系边；
5. 从 TDB 物理删除旧 EventNote 节点；
6. SQLite 保留旧版本、修订原因、新旧 ID 映射和完整审计历史。

正常 RAG 和工具查询只会看到新版本；旧版本不留在 TDB，也不参与时间轴和图查询。

### 5.4 扩展覆盖范围

`write_event_note` 允许 Agent 请求纳入当前 Thread 中更早的未覆盖 Pair。工具不接受任意消息 ID，而是接受受限的覆盖提示，例如“向前包含最近 N 个未覆盖 Pair”或“包含当前未覆盖连续区间”；系统负责解析真实 Pair 和消息 ID。

约束：

- 只能覆盖当前 Thread；
- 只能选择尚未覆盖的 Pair；
- 不能跨越已覆盖区间拼接不连续消息；
- 记叙内容以未记录事件为主；
- 既有记忆只作为避免重复和建立关联的上下文；
- 若目标是补充已有事件，必须使用 `revise_event_note` 并指定目标 EventNote ID。

## 6. 消息覆盖与防重复

语义是否重复由 Agent 在上下文辅助下判断；代码只负责工程幂等和覆盖边界。

### 6.1 Coverage 职责

需要独立记录对话区间的覆盖结论，统一使用后文定义的 `ConversationCoverage`。它既能关联一条或多条 EventNote，也能表达“已审阅但无需形成事件”。

Coverage 用于：

- 后台任务只读取未覆盖消息；
- 防止同一 Pair 被后台重复炼化；
- 对话回溯时定位受影响事件；
- 删除 Thread 或隐私清理时追溯事件来源；
- 调试 Agent 主动记事是否遗漏或重复。

### 6.2 Agent 写记事的数据源

`write_event_note` 直接读取当前 Thread 中由系统确定的原始对话 Pair，不在工具内部检索或注入任何 EventNote Top-K。

- 默认数据源是当前 Pair 的原始用户消息、Assistant 消息和必要工具结果；
- 请求向前覆盖时，扩展的仍是当前 Thread 中连续、未覆盖的原始 Pair；
- 时间链最后一条记事已经由对话前自动 RAG 100% 注入 Agent 上下文，工具不重复拉取；
- 其他相关旧事件仅在 Agent 主动调用 `query_event_notes` 时返回；
- 工具只根据原始对话生成 `append/revise/skip` Draft，不把检索结果当成待记录事件。

## 7. 动态后台兜底炼化

后台炼化从“固定批次摘要器”改为“未覆盖事件补记器”。

### 7.1 触发条件

建议采用组合触发，而不是单一固定轮次：

- **静默触发**：Agent 累计 6 小时没有主动写记事，且存在未覆盖消息；按 daemon 有效运行时间累计，daemon 停止、退出或系统睡眠时暂停；每分钟写入 SQLite checkpoint，正常退出前额外 checkpoint，重启后从 checkpoint 续算且不补停机墙钟差；
- **容量触发**：根据当前后台模型上下文窗口，扣除系统提示、Agent 人格、结构化输出和回复预留后计算安全容量；未覆盖连续区间达到该安全容量的 80% 时切片排队；
- **Thread 边界触发**：Thread 最后一条消息后累计休眠 2 小时，且仍存在未覆盖消息；
- **日界触发**：每天系统本地时间 21:00 扫描并补记仍未覆盖区间。

具体阈值由运行时配置管理，不能硬编码在 Scorer 内。

### 7.2 输入范围

后台模型只读取连续的未覆盖消息区间，不混合不同 Agent 或 Thread：

```text
上一个 Coverage Cursor 之后
  ↓
当前最后一条稳定消息
```

### 7.3 输出合同

后台模型必须允许输出：

```text
0 条：没有值得记录的事件
1 条：该区间形成一个事件
N 条：该区间包含多个独立事件
```

后台产出的内容同样是 Agent 第一人称事件记事，不是客观摘要或工作汇报。

后台提交后必须登记覆盖结论。零事件区间使用独立的 `reviewed_no_event` 覆盖记录，表示该连续消息区间已被后台完整审阅，但没有形成值得长期保存的事件。

```typescript
interface ConversationCoverage {
  id: string
  agentId: string
  threadId: string
  pairIds: string[]
  messageIds: string[]
  outcome:
    | 'event_recorded'
    | 'reviewed_no_event'
  eventNoteIds: string[]
  mode: 'active' | 'background'
  coveredAt: string
}
```

规则：

- `event_recorded` 至少关联一个 EventNote ID；
- `reviewed_no_event` 的 `eventNoteIds` 必须为空；
- 两种结果都推进 Coverage Cursor，避免后台无限重复扫描；
- `reviewed_no_event` 不是记忆节点，不写入 TDB，不参与 RAG；
- 它只保存在 SQLite 备份与任务审计层；
- 对话回溯使区间内容变化时，对应覆盖结论失效并重新进入待审阅状态。

## 8. 事件关系路网

### 8.1 第一版边类型

```text
时间：
temporal_next
temporal_prev

逻辑：
caused_by（规范物理边）

事件与主题：
same_event（对称）
same_topic（对称）

参与关系：
involves_person
involves_place
involves_object
```

- `caused_by`：唯一物理因果边，`A caused_by B` 表示 A 由 B 明确导致；`resulted_in` 只作为反向查询语义，通过 `caused_by` 入边获得，不重复持久化。只有候选事件之间存在明确前因后果时才能建立该边，时间先后、同主题、内容相似或可能产生影响均不足以构成因果。
- `same_event/same_topic`：按两个 EventNote ID 排序端点，仅持久化一条规范边；查询必须同时遍历入边和出边。
- 第一版不实现 `contradicts` 和 `resolves`；事实冲突由 Facts Store 的查询与显式取代协议处理，事件修订由 `revise_event_note` 处理。

### 8.2 边语义与建边责任

- `same_event`：两个 EventNote 属于同一次持续互动、同一事件簇或同一事件的补充视角；它不是重复内容标记，也不要求合并节点。
- `same_topic`：两个事件讨论同一主题，但不一定属于同一事件。
- 时间边：系统确定性生成；
- `involves_*`：根据结构化字段确定性生成；
- `same_event/same_topic`：后台 Reflection 发现候选并建立；
- 逻辑边：后台 Reflection 推断并建立；
- Agent 的主动记事、修订与查询工具均不直接创建关系边。

### 8.3 Reflection 四路候选与建边

后台 Reflection 不做全库事件两两比较。每个待维护事件通过四路召回建立候选池：

1. **时间邻近**：从时间链拉取前后邻近事件；
2. **实体/主题**：拉取人物、地点、事物或主题相同的事件；
3. **现有混合检索**：使用关键词、图与现有混合相关性检索获得候选；
4. **直接向量相似**：独立执行纯向量相似度搜索，并将 Vector Top-K 加入候选池。

四路召回的第一版默认规模：

```text
时间邻近：前后合计 3
实体/主题：Top-10
现有混合检索：Top-10
直接向量相似：Top-10
合并去重后：最多 24
```

以上数值只保留在后端运行时配置与默认配置中，不提供前端设置入口。四路结果按 EventNote ID 去重并截断后交给 Reflection 模型。模型直接决定：

- 是否存在关系；
- 关系类型；
- 边方向；
- 是否需要删除既有错误边。

不设置代码置信度阈值，也不设置每类语义边数量上限。模型判断无关系时不建边；后续判断既有边错误时，从 TDB 与 SQLite 备份中直接物理删除，不保留软撤销边。

Reflection 的候选规模仍必须由各路 Top-K 和总候选上限约束，避免把全库事件塞入模型；这些限制只约束模型输入规模，不替模型决定关系。

### 8.4 情感关系

第一版不持久化大量 `same_emotion` 边，避免形成高密度图。

情感作为节点结构化属性：

```text
affect.tones
affect.valence
affect.arousal
```

情感查询先按属性筛选锚点，再沿时间或逻辑边确定性查询。

## 9. 查询体系

### 9.1 对话前自动 RAG

自动 RAG 保持轻量、稳定，不设置独立 Token 预算：

1. 100% 注入该 Agent 物理时间链最后一条事件记事；即使该事件已 archived 也照常注入，时间连续性优先；
2. 混合召回当前输入相关的 Top-K active 事件，默认 `10`；
3. Top-K 继续由现有“记忆条目数量”配置统一管辖，三类聊天入口沿用现有配置作用域；
4. 每个命中事件固定补充一个物理时间链直接前驱，前驱不占用 Top-K 名额；
5. 直接前驱即使处于 archived 状态也照常注入；
6. 若多个命中事件共享同一前驱，只注入一次；不存在前驱时不补位；
7. 去除命中节点、物理末尾节点和前驱节点之间的重复；
8. archived 事件只能作为物理末尾、直接前驱或主动查询显式 `includeArchived=true` 的结果出现；
9. 注入时携带事件 ID、时间、状态和来源摘要。

自动 RAG 默认不执行复杂多跳逻辑查询，避免历史记忆淹没当前对话。

### 9.2 Agent 主动查询工具

统一工具：

```text
query_event_notes
```

建议查询模式：

```text
recent
time_range
semantic
same_event
entity
logical
affective
mixed
```

逻辑查询应返回节点和路径，说明事件之间为什么相关，而不是只返回概率分数。

工具参数必须限制：

- 最大深度；
- 最大节点数；
- 最大返回 Token；
- 可用边标签；
- 查询方向；
- 时间范围。

## 10. 前端记忆管理

新版记忆管理页是只读观察与诊断界面，不提供用户编辑、归档、恢复或物理删除 EventNote 的操作。

### 10.1 时间轴主视图

- 默认按 `eventAt ASC` 展示 Agent 私有事件时间轴；
- 时间轴节点展示时间、narrative 摘要、importance、情感和状态；
- 点击节点展开详情、前后事件、`same_event` 事件簇、`same_topic` 和 `caused_by` 关系；
- 关系图作为辅助视图，不取代时间轴主干；
- Agent 切换时必须切换到对应私有时间轴。

### 10.2 归档展示

- 默认隐藏 archived EventNote；
- 提供“包含归档”筛选；
- 归档节点使用弱化样式并明确标注“不可恢复”；
- 归档节点仍保持其物理时间轴位置和关系。

### 10.3 来源查看

- EventNote 只保存 Pair/Message ID 和必要来源元数据，不复制原始对话全文；
- 用户展开来源时，前端按需请求对应 ThreadMessage；
- Thread 或消息已删除时，显示已有来源元数据与“原文不可用”；
- 来源接口只读，并按当前 Agent 和 Thread 权限校验。

## 11. 维护体系

Reflection 保留，但从直接修改旧 `memory_nodes` 改为统一操作 EventNote 聚合。

维护职责：

1. 修复缺失或错误的结构化标签；
2. 建立或修订 `same_event/same_topic/caused_by` 关系；
3. 只有 Reflection 模型明确判断事件已经失去长期价值时，才将其标记为 `archived`；代码不得按时间、访问次数、重要性或机械衰减规则自动归档；
4. 归档事件继续保留在 TDB、时间轴和关系图中；默认 RAG 和普通查询不返回，主动查询仅在显式 `includeArchived=true` 时返回；
5. 归档不可恢复为 active；若后续形成新的有效认知，只能新增或修订其他 active EventNote；
6. 归档事件仍可作为物理时间链末尾节点或命中事件的直接前驱被自动注入；
7. 多个 EventNote 高度重叠时，Reflection 修订其中一个主事件，其他重叠事件归档，并通过 `same_event` 保留事件簇关系；
8. 检查时间链完整性；
9. 检查孤立节点、悬空边和索引漂移；
10. 所有写入通过同一 EventNote Service 和事务日志机制。

维护任务不得直接绕过权威实体操作 TDB。

## 12. 每日人格日记

### 12.1 数据源

每日后台任务按 Agent 收集：

- 当天事件记事；
- 当天已检查但未形成事件、仍值得进入日记的互动摘要；
- Application 提供的当日摘要。

### 12.2 生成规则

- 完全以 Agent 人格主体和第一人称写作；
- 读取该 Agent 当前 `system_prompt.md`；
- 严禁捏造数据源中不存在的互动；
- 输出 Markdown，不进入事件记忆库；
- 使用 WorkspaceService 写入 `dailynotes/`。

### 12.3 Token 分片

- 生成前使用统一 Tokenizer 计算输入；
- 未超限时写 `YYYY-MM-DD.md`；
- 超限时按时间连续区间切分；
- 常见情况为两个分片，但系统不把两个写成绝对上限；
- 多分片写为 `YYYY-MM-DD-part-N.md`；
- 每个分片独立生成，不创建内容相同的文件副本；

### 12.4 执行与补写

- 日记任务必须等待该 Agent 的日界补记任务完成或明确最终失败；
- 日界补记最终失败时，仍使用已有 EventNote 和已覆盖数据生成日记；仅在内部任务审计中标记 `sourceIncomplete=true`，不得把系统错误写入日记正文；
- 日记生成失败后按 10、30、60 分钟退避重试。

## 13. 系统知识库与事实库

两个库均为全 Agent 共享，不自动进入 Prompt，只能通过注册工具访问。所有读写必须经过 ToolRegistry、CapabilityGate、对应 Service 和 Repository；Agent 不直接持有 TDB 实例，也不存在绕过工具权限的数据库入口。

第一阶段优先实现 Facts Store。Knowledge Store 只预留共享 Store、Port、工具合同和扩展框架，具体文档分块、版本和摄入流程后续讨论。

### 13.1 Knowledge Store（仅合同预留）

第一阶段仅在 Shared/Backend Port 层冻结：

```text
KnowledgeStorePort
KnowledgeQuery
KnowledgeRecord
StoreKind.knowledge
```

本阶段不创建 `knowledge.tdb`，不注册空工具，不实现文档节点、分块或摄入任务。事实库稳定后再单独设计 Knowledge Store。

### 13.2 Facts Store

写入工具必须至少指定：

```text
对象 object
事实 fact
```

建议结构：

```text
Subject Node
  └─ has_fact
      Fact Node
```

事实节点建议包含：

```typescript
interface FactRecord {
  id: string
  objectKey: string
  objectName: string
  statement: string
  status: 'active' | 'superseded'
  observedAt: string
  createdAt: string
  source?: string
  confidence?: number
  createdByAgentId: string
}
```

建议边：

```text
has_fact
fact_of
superseded_by
supersedes
supports
contradicts
```

写入与冲突处理流程：

1. Agent 先调用 `query_facts`，提交自然语言对象名或别名；
2. 系统先执行标准名、规范化名称和别名的精确匹配；
3. 精确匹配失败时，仅使用 BM25、前缀/包含匹配和编辑距离生成文本候选，不使用向量相似度自动判断对象身份；
4. 文本候选最多返回 5 个，不设置固定分数阈值，分数只用于排序，由 Agent 选择；
5. `query_facts` 返回 `exactMatch`、`candidates` 和 `requiresSelection`；每个候选包含对象 ID、标准名、别名、匹配类型、文本分数与 active 事实；
6. 唯一精确命中直接返回，多候选时要求 Agent 选择，零候选才允许创建新对象；
7. Agent 判断新事实是否与既有事实冲突；
8. 无冲突且对象已存在时，调用 `write_fact` 并引用对象 ID；
9. 零候选时，`write_fact` 必须显式提交新对象标准名与可选别名；系统完成规范化和重复检查后创建对象；
10. 对象别名后续通过独立受权限控制的工具追加或移除，不通过再次创建对象实现；
11. 有冲突时调用 `supersede_fact`，显式提交对象 ID、旧事实 ID 和新事实；
12. `supersede_fact` 校验旧事实仍为 active，并原子建立双向取代边；
13. 默认查询只返回 active 事实；
14. 明确错误、垃圾或误写内容才调用 `delete_fact`；
15. 不使用 SA-PPR 或自动图扩散。

Agent 不能自定义或猜测 `objectKey`。系统不在 `write_fact` 内自动猜测并取代冲突事实。工具说明必须要求 Agent 在写入时先查询，但最终行为仍由 CapabilityGate 的工具权限控制。

工具建议：

```text
query_facts
write_fact
supersede_fact
delete_fact
add_fact_object_alias
remove_fact_object_alias
```

Knowledge 工具本阶段不注册。`delete_fact` 只用于明确错误、垃圾或误写事实；现实变化优先使用 `supersede_fact`。

## 14. TriviumDB 0.8.2 需求建议

TDB 应提供通用图能力，不能写死 infOS 领域语义。

### P0

- 按方向、标签、深度和预算进行确定性可达性查询；
- 查询结果返回完整路径及每条边的 label、weight；
- 精确边操作：`getEdge/upsertEdge/updateEdge/unlink(label)`；
- 明确重复 `link` 的幂等或覆盖语义；
- 节点与多条边的原子 Batch/Transaction；
- 边元数据或等价的可追溯关系属性；
- 确定性图查询不得隐式执行 SA-PPR、DPP 或向量扩散。

### P1

- 返回节点、边和 `truncated` 的确定性子图查询；
- 高效多字段属性索引与组合过滤；
- 稳定自定义 ID 的 Upsert 和冲突行为；
- GraphFirst、Exact、TQL 与 reachable 的统一预算语义；
- 入边、出边和双向遍历的一致 API。

### P2

- 按边标签统计；
- 孤立节点、悬空边和高出度节点检查；
- 图结构校验与维护 API。

## 15. 权威数据与备份原则

本体系明确采用：

```text
TDB：实际运行、检索、图遍历与关系维护的权威数据空间
SQLite：完整权威备份、恢复源、审计源、覆盖账本与提交事务日志
```

正常业务读取只认 TDB；SQLite 保存足以恢复 TDB 的结构化副本，并通过事务日志协调每次修改。

### 15.1 SQLite 事务日志协议

每次写入、修订、归档、删除或建边都使用唯一 `operationId`：

```text
SQLite 事务：写完整备份变更 + operation(pending)
  ↓
提交 SQLite
  ↓
按 operationId 幂等提交 TDB
  ↓
SQLite 将 operation 标记为 committed
```

恢复规则：

- 启动时扫描 `pending` 操作并向 TDB 幂等重放；
- TDB 已完成但 SQLite 尚未标记的操作，重放不得产生重复节点或重复边；
- 连续重放失败的操作标记为 `failed` 并进入维护队列，不向正常读取暴露 SQLite 备份内容；
- TDB 全库丢失时，从 SQLite 最新备份状态完整重建，再重放尚未完成的事务日志；
- SQLite 写入失败时不得触碰 TDB；
- 正常查询永远不使用 SQLite 作为降级读库。

系统必须满足：

- EventNote 在 TDB 中拥有唯一运行时身份和生命周期；
- SQLite 同步保存 EventNote、Coverage、边关系、状态和必要元数据的完整备份；
- TDB 丢失或损坏时，可以仅依赖 SQLite 完整重建节点、时间链、向量、BM25、属性索引和图边；
- 写入、修订、归档和删除通过同一领域服务；
- Tool、Maintenance、Router 不得直接持有或修改 TDB；
- 每次提交具有幂等键；
- Thread 回溯、删除与隐私清理必须根据 Coverage 和 Provenance 精确处理。

## 16. 分阶段实施计划

### 阶段 0：冻结协议（已完成）

- 冻结 `EventNote/EventNoteDraft/ConversationCoverage` 字段；
- 冻结 `append/revise/skip` 与回合提交协议；
- 冻结时间规则；
- 冻结第一版边标签及“目标 EventNote ID 必填”规则；
- 冻结工具参数和返回合同；
- 冻结 TDB 主空间与 SQLite 备份之间的提交、补偿和重建协议；
- 确认 TDB 0.8.2 能力与发布时间。

### 阶段 1：建立新存储内核（已完成）

- 新增 EventNote Repository/Service；
- 新增 Agent 私有 Store 路由；
- 实现时间轴插入、修复和重建；
- 实现 TDB 主空间写入、SQLite 完整备份与恢复机制；
- 暂不切换生产 RAG。

### 阶段 2：接入主动记事与修订（已完成）

- 新增 `write_event_note` 和 `revise_event_note`；
- 建立 ReAct Draft 生命周期；
- 在回合成功持久化后提交；
- 支持请求覆盖当前 Thread 中更早的连续未覆盖 Pair；
- 写入 `ConversationCoverage`；
- 写记事工具直接读取所选范围的原始对话 Pair，不在工具内部额外执行旧 EventNote Top-K 检索。

### 阶段 3：替换后台 Scorer（已完成）

- 新增未覆盖区间查询；
- 实现动态触发器；
- 后台允许输出零至多条 EventNote；
- 停止旧 Scorer 创建 Canonical 摘要节点。

### 阶段 4：切换自动与主动查询（已完成）

- 自动 RAG 改为 EventNote 检索；
- 自动 RAG 100% 注入物理时间链末尾事件，并为 Top-K 命中补不占名额的直接前驱；
- 新增 `query_event_notes` 多模式查询；
- 返回确定性图路径；
- 建立查询预算和审计。

### 阶段 5：重构 Reflection（已完成）

- 所有维护动作切换到 EventNote Service；
- 增加确定性时间链、`caused_by`、`same_event`、`same_topic` 与 `involves_*` 关系检查；
- 删除旧维护模块对 `memory_nodes` 的旁路写入。

### 阶段 6：每日人格日记（已完成）

- DailyNotesService 读取 Agent 人格；
- 使用 EventNote、`reviewed_no_event` 原始互动与 Application 当日摘要三路数据源；
- 使用统一 `o200k_base` Tokenizer 分片；
- 写入 Workspace `dailynotes/*.md`；
- 已移除 `diary.tdb` 依赖。

### 阶段 7：共享事实库与知识库预留（已完成）

- 新增全局 `facts.tdb` Store；
- 实现对象与事实结构；
- 实现确定性多跳查询；
- 提供受 CapabilityGate 管辖的写入、查询、取代和删除工具；
- Agent 不直接访问 Repository 或 TDB；
- 为 Knowledge Store 预留 Store、Port、工具合同与扩展框架，暂不实现文档摄入；
- 将现有 `infos.knowledge` 从主记忆别名迁离，避免继续冒充正式知识库。

### 阶段 8：旧数据清空与清理（已完成）

- 不实现旧 CanonicalMemory、memory_nodes 或旧 TDB 数据迁移；
- 升级时直接清空旧记忆数据和旧索引；
- 删除旧双重事实源和无调用方检索实现；
- 更新前端记忆页、配置页与正式架构文档；
- 更新重置、重建索引、备份和隐私清理流程。

## 17. 测试与验收矩阵

### 17.1 语义合同

- 建立固定中文对话样本集，覆盖主动记事、`revise`、`skip`、后台零事件、一对多事件、关系判断和事实冲突；
- CI 使用 Mock LLM 固定输出，硬门禁验证 Prompt 输入、结构化输出、Coverage、Draft 和提交流程；
- 提供可选真实模型评估脚本，用于人工比较记叙质量、漏记、重复和错误连边，不作为 CI 硬门禁；
- 真实模型评估结果不得改变生产数据。

### 17.2 真实双库集成

Repository 与 Service 集成测试使用临时真实 SQLite 和真实 TriviumDB；只 Mock LLM、Embedding 和外部服务。必须验证：

- EventNote 写入、查询、时间链和规范单边；
- SQLite 事务日志与 TDB 幂等重放；
- revise 节点替换和 SQLite 历史保留；
- archived 过滤、物理末尾注入和直接前驱补充；
- Facts 对象解析、Top-5 文本候选、显式取代和物理删除；
- 从 SQLite 完整重建 TDB。

### 17.3 必测故障注入

1. SQLite 已写 `pending`、TDB 尚未提交时崩溃；
2. TDB 已完成、SQLite 尚未标记 `committed` 时崩溃；
3. 同一 operationId 被重复重放；
4. revise 替换节点、时间边或关系边任一步骤失败；
5. 主动记事与后台 Worker 同时争抢同一 Coverage 区间；
6. TDB 文件完全删除或损坏后，从 SQLite 全库恢复。

所有故障测试必须证明：无重复节点、无重复边、无 Coverage 丢失、时间链不断裂、正常查询不读取 SQLite 降级数据。

### 17.4 前端验收

- 时间轴排序、Agent 隔离、归档筛选和关系展开；
- 来源 Pair 按需加载、加载失败和原文已删除状态；
- 浅色/暗色主题；
- 窄栏布局、超长 narrative、大量时间轴节点和关系；
- 归档弱化样式与不可恢复提示；
- 关系图辅助视图不得破坏时间轴主视图。

## 18. 后续扩展事项

以下内容不属于第一阶段实现范围：

1. Knowledge Store 后续的文档分块、版本、来源与摄入协议；
2. 新前端时间轴的大数据量虚拟滚动优化。

## 19. 完成标准

当前实现已满足以下核心完成标准；测试矩阵中的固定中文样本扩展、可选真实模型评估，以及前端极端布局和主题视觉验收作为后续增强继续维护：

- Agent 可以主动写事件记事，且只在回合成功结束后正式提交；
- 后台只处理未覆盖消息，不再固定批次机械生成摘要；
- 每个 Agent 拥有独立、可重建的系统时间轴；
- 自动 RAG 始终包含物理时间链最后一条事件，即使它已归档，并能召回当前相关 active 事件；
- Agent 可以按时间、语义、实体、逻辑、情感和混合方式主动查询；
- 查询结果能解释图路径，不把概率相似误当成确定关系；
- Reflection 不再旁路修改 TDB；
- 每日人格日记稳定写入 Workspace Markdown，并支持 Token 分片；
- Facts Store 全 Agent 共享、仅工具访问、不会自动注入 Prompt；Knowledge Store 第一阶段仅保留合同；
- 事实支持取代链和明确物理删除；
- 重置、回溯、删除、备份、索引重建和隐私清理覆盖完整生命周期；
- 旧 CanonicalMemory、memory_nodes 与旧 TDB 数据直接清空，旧检索双轨完成删除。

### 19.1 实际落地说明

- 生产依赖使用 TriviumDB 0.8.2；节点写入、边写入和替换通过 `commitTransaction()`、`insertWithId`、`upsertEdge` 等实际 Node API 完成。
- TriviumDB 0.8.2 当前 Node API 未提供满足查询预算和方向/标签约束的通用图遍历入口，因此 EventMemory 与 Facts 的确定性多跳查询在 Service 层使用受深度、节点数、Token、方向和边标签预算约束的 BFS 实现。
- 后台容量基于模型配置的完整上下文窗口，扣除系统/人格等 Prompt 预留与输出预留后取 80%；文本计数统一使用 `o200k_base` Tokenizer。
- 最终验证：Shared、Backend、Frontend、Social 类型检查通过；EventMemory、后台兜底、Facts、CapabilityGate、MemoryRouter、MemoriesTab 共 61 项专项测试通过。
