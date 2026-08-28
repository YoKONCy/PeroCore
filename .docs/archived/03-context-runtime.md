# Context Runtime 模型

> **归档警示**：本文记录历史设计与迁移背景，不代表当前架构。现行规范以[A01文档索引](../A01_PROJECT_STRUCTURE.md#6-规范文档与归档)及其列出的A02–A09/S系列文档为准；旧Channel、API、Package或Application表述不得用于新实现。

> Context Runtime 是主 Agent 的上下文编译系统，从各一等资源只读消费，编译为 LLM 输入。

---

## 0. 设计决策

### 0.1 移除摘要机制

**决策日期**：2026-08-05

原设计中 ContextCompiler 包含滚动摘要机制：对超出上下文窗口的早期消息生成压缩摘要，注入 LLM 输入。

**移除理由**：

1. **职责重叠**：摘要（旧消息的模糊压缩）与长记忆（Scorer 提炼的结构化记忆）目标重叠，但长记忆更精确、可检索、可按需调用。
2. **双重压缩失真**：消息→摘要→LLM 链路存在信息损失，而长记忆直接从原始消息提炼结构化事实。
3. **维护成本**：摘要需要 stale 标记、触发时机、覆盖范围管理，增加系统复杂度。
4. **LLM 依赖**：摘要生成需要 LLM 调用，违背 Compiler"纯只读数据组装、零 LLM 介入"的设计原则。
5. **窗口兜底足够**：短上下文窗口默认 20~30 条，Scorer 后台任务在窗口耗尽前早已完成提炼，不存在"长记忆还没形成"的极端情况。

### 0.2 社交场景从 ContextCompiler 剥离

**决策日期**：2026-08-05

原设计中 ContextCompiler 支持 `social`/`group` channel，但社交场景与桌面对话存在根本差异：

| 维度     | 桌面对话               | 社交场景                                     |
| -------- | ---------------------- | -------------------------------------------- |
| 消息来源 | 单一用户               | 多用户（群聊各种人发言）                     |
| 消息节奏 | 一问一答               | 消息轰炸（短时大量消息）                     |
| 消息格式 | `role: user/assistant` | `[senderId, senderName, content]`            |
| 存储方式 | `thread_messages`      | `social_messages` 表（按 channelId）         |
| 记忆系统 | RAG 向量检索           | `social.tdb` 图谱（BM25 + 图谱扩散，零向量） |
| 状态机   | 无                     | 看群频率、水群意愿、社交心情等               |

**决策**：将社交场景从 ContextCompiler 中剥离，作为后续**子 Agent 应用**设计。

**影响**：

- ContextCompiler 只服务 `desktop`/`companion` 两个 channel
- `social`/`group` channel 从 ChannelPolicy 中移除
- 社交场景继续走现有 `SocialBridge + SocialEnricher` 独立路径
- 后续将社交改造为独立的子 Agent 应用（独立人格、独立工作区、独立状态机）
- 详见 [11-sub-agent-social.md](./11-sub-agent-social.md)（待补）

### 0.3 三层上下文机制

| 层级                   | 内容                    | LLM 介入       | 触发方式                  |
| ---------------------- | ----------------------- | -------------- | ------------------------- |
| **短上下文**（窗口内） | 最近 N 条原文消息       | 否             | Compiler 直接读取         |
| **长记忆**（窗口外）   | Scorer 提炼的结构化记忆 | 是（后台异步） | RAG 检索 / Agent 主动调用 |
| **即时检索**           | Agent 调用记忆工具      | 是（按需）     | Agent 决策                |

> 注：此机制仅适用于主 Agent（desktop/companion）。社交场景将作为子 Agent 应用独立设计。

### 0.4 摘要机制移除的影响

- `thread_summaries` 表废弃（保留 schema 不删除，但运行时不再读写）
- ContextManifest 移除 `summaryRevision`、`summaryCovers` 字段
- ContextPolicy 的 `summaryStrategy` 字段废弃
- ThreadService 移除 `getSummary`、`upsertSummary`、`markSummaryStale` 方法
- 软删除消息时不再需要"标记摘要 stale"的副作用

---

## 1. 定义

Context Runtime 是 PrincipalAgent 的一个一等资源，负责：

- 在每次 LLM 调用前编译上下文
- 从 Identity、Memory、Thread、Workspace、Tool 只读消费
- 输出 LLM Messages 和 Context Manifest
- 管理 Token 预算和裁剪策略

Context Runtime **不负责**：

- 记忆的写入和提炼（那是 Memory 的事）
- 人格的定义和修改（那是 Identity 的事）
- 消息的持久化（那是 Thread 的事）
- 工具的执行（那是 Tool Capability 的事）

---

## 2. 核心组件

```text
ContextRuntime
├─ ContextCompiler           ← 编译器（核心）
├─ ContextBundle             ← 当前上下文包
├─ ContextManifest           ← 编译清单
├─ TokenBudget               ← 预算管理
└─ ContextPolicy             ← 编译策略（来自 Thread）
```

---

## 3. Context Compiler

### 3.1 职责

Compiler 只做一件事：**把各资源的当前状态编译成一次 LLM 调用的输入**。

### 3.2 输入（只读消费）

```text
From Identity:    人格常量、channel 补丁
From Memory:      检索到的相关记忆
From Thread:      最近 N 条 active 消息
From Workspace:   相关文件引用（如果有）
From Tools:       可用工具描述
From User:        当前用户输入
```

### 3.3 输出

```text
LLM Messages
  按槽位排列的最终消息链

ContextManifest
  本轮使用了哪些资源、哪个版本
  Token 消耗明细
  裁剪和压缩记录
```

### 3.4 编译流程

```text
持有的上下文图
    ↓
1. 权限过滤
   ├─ 按 Thread.channel 过滤可用工具
   ├─ 按 MemoryPolicy 过滤记忆检索范围
   └─ 按 ContextPolicy 决定是否注入工具描述
    ↓
2. 任务相关性筛选
   ├─ 用当前用户输入检索长期记忆
   └─ 筛选与当前对话相关的记忆片段
    ↓
3. 版本选择
   ├─ 消息使用最新 revision
   └─ 跳过 status=deleted 的消息
    ↓
4. 实体去重
   └─ 记忆与历史不重复
    ↓
5. Token 预算分配
   ├─ 不可压缩：人格、安全规则、当前输入
   ├─ 高优先级：当前目标、最近消息、工具结果
   ├─ 可压缩：历史消息、工作区描述
   └─ 按需检索：长期记忆、系统知识
    ↓
6. 按槽位排序
   ├─ 见下方槽位设计
    ↓
7. 合并输出
   ├─ 相邻同角色消息合并
   └─ 输出最终 LLM Messages + Manifest
```

### 3.5 只读原则

Compiler **不反向修改任何资源**：

- 不写入记忆
- 不修改人格
- 不持久化消息
- 不执行工具
- 不创建文件

---

## 4. 槽位设计

保留 MDP 的槽位思想，但重新定义槽位语义和顺序：

```text
位置    槽位 ID              内容来源                角色
────────────────────────────────────────────────────────
100     identity             Identity.basePersona    system
150     behavior_rules       Identity.boundary       system
200     channel_patch        Identity.channelPatch   system
300     memory_context       Memory.retrieval        system
500     tool_descriptions    ToolCapability          system
600     workspace_refs       Workspace（可选）        system
700     recent_messages      Thread.activeMessages   user/assistant
800     current_input        用户当前输入             user
900     footer               时间和一致性提醒         system
```

### 4.1 与现有 MDP 的区别

| 现有 MDP                      | 新 Compiler                      |
| ----------------------------- | -------------------------------- |
| 13 个全 system 槽位合并成一条 | 槽位按语义分组，合理排列         |
| 历史序列化成 XML 放 system    | 消息保留原生 user/assistant 角色 |
| Preset ID 不匹配导致失效      | 槽位由 Compiler 直接控制         |
| 无 Token 预算                 | 按层分配预算                     |
| Footer 在合并 system 末尾     | Footer 独立处理                  |
| `extraVars` 可覆盖核心变量    | 核心变量不可被客户端覆盖         |

### 4.2 消息原生保留

最近 N 条消息保留为原生 `user/assistant` 消息，不再序列化成 XML 塞进 system prompt：

```text
之前（现有）：
  system: <history><msg role="user">U1</msg><msg role="assistant">A1</msg></history>
  user: U1
  assistant: A1
  user: U2

之后（新架构）：
  system: 人格 + 记忆 + 工具
  user: U1
  assistant: A1
  user: U2
```

彻底消除历史重复注入。

---

## 5. ContextBundle

一次编译的上下文包，是临时产物：

```text
ContextBundle
├─ id: string
├─ threadId: string
├─ agentId: string
├─ items: ContextItemRef[]
├─ compiledAt: string
└─ tokenEstimate: number
```

ContextBundle 不持久化，每次编译重新生成。

---

## 6. ContextManifest

编译清单，记录本轮使用了哪些资源：

```text
ContextManifest
├─ bundleId: string
├─ threadId: string
│
├─ identity
│  ├─ basePersonaRevision: string
│  └─ channelPatch: string
│
├─ memory
│  ├─ retrieved: MemoryRef[]
│  ├─ searchQuery: string
│  └─ retrievalEnabled: boolean
│
├─ thread
│  ├─ messageRange: { from: string, to: string }
│  └─ messageCount: number
│
├─ tools
│  ├─ included: string[]
│  └─ filtered: string[]
│
├─ tokenUsage
│  ├─ identity: number
│  ├─ memory: number
│  ├─ messages: number
│  ├─ tools: number
│  └─ total: number
│
└─ truncations
   ├─ messagesTruncated: boolean
   ├─ memoryFiltered: boolean
   └─ reason: string
```

Manifest 用于调试和审计：可以准确解释"某条信息为何进入本轮 Prompt"。

---

## 7. Token Budget

### 7.1 分层分配

```text
不可压缩（必须保留）：
  ├─ Identity basePersona
  ├─ Behavior rules
  └─ Current user input

高优先级（尽量保留）：
  ├─ Recent messages（窗口内）
  ├─ Channel patch
  └─ Tool descriptions（如果启用）

可压缩（可裁剪）：
  ├─ Older messages（超出窗口）
  └─ Workspace refs

按需检索（可省略）：
  ├─ Long-term memory
  └─ System knowledge
```

### 7.2 预算策略

```text
总预算 = 模型上下文窗口 - 输出预留

分配顺序：
1. 扣除不可压缩部分
2. 分配高优先级部分
3. 剩余分配给可压缩部分
4. 最后分配给按需检索部分

如果不足：
- 先裁剪按需检索
- 再裁剪可压缩
- 高优先级和不可压缩尽量不动
```

---

## 8. ContextPolicy

ContextPolicy 由 Thread 持有（持久属性），Compiler 在每次调用时读取：

- Policy 来源是 Thread，不是 Agent 全局状态
- 同一个 Agent 的不同 Thread 可以有不同 Policy
- Policy 不随单次调用变化，只在 Thread 创建或配置更新时改变

```text
ContextPolicy
├─ messageWindow: number             ← 最近 N 条消息
├─ tokenBudget?: number              ← Token 上限
├─ includeToolCalls: boolean
├─ includeThinking: boolean
├─ enableMemoryRetrieval: boolean
├─ enableToolDescription: boolean
```

不同 channel 的默认策略：

| Channel   | messageWindow | memoryRetrieval | toolDescription |
| --------- | ------------- | --------------- | --------------- |
| desktop   | 20            | true            | true            |
| companion | 8             | true            | false           |

> 注：`social`/`group` channel 已从 ContextCompiler 中剥离，作为子 Agent 应用独立设计。
> 见 [0.2 节](#02-社交场景从-contextcompiler-剥离)。

```text
lightweight Policy:
  messageWindow: 8
  tokenBudget: 2000
  enableMemoryRetrieval: false
  enableToolDescription: false
```

---

## 9. 编译示例

### 9.1 Desktop Thread 编译

```text
输入：
  Thread: desktop-chat-001
  Policy: { window: 20, memory: true, tools: true }
  当前输入: "我们继续讨论上下文架构吧"

编译过程：
  1. 读取 Identity basePersona（Pero 核心人格）
  2. 读取 channel_patch[desktop]（null，用完整人格）
  3. 用当前输入检索 Memory → 命中 3 条相关记忆
  4. 读取 Thread 最近 20 条 active 消息（M16-M35）
  5. 读取 Tool 描述（desktop 允许的工具）
  6. 分配 Token 预算
  7. 合并输出

输出：
  system: Pero 人格 + 行为规则 + 3条记忆 + 工具描述 + footer
  user: M16
  assistant: M17
  ...
  user: M34
  assistant: M35
  user: "我们继续讨论上下文架构吧"

Manifest:
  identity: basePersona rev 3
  memory: 3 items retrieved
  thread: M16-M35 (20 messages)
  tools: 12 included
  tokenUsage: { identity: 800, memory: 400, messages: 3000, tools: 600, total: 4800 }
```

### 9.2 Companion Thread 编译

```text
输入：
  Thread: companion-001 (channel=companion)
  Policy: { window: 8, memory: true, tools: false }
  当前输入: "陪我聊聊天"

编译过程：
  1. 读取 Identity basePersona（Pero 核心人格）
  2. 不读取 channel_patch（companion 无补丁）
  3. 用当前输入检索 Memory → 命中 2 条相关记忆
  4. 读取 Thread 最近 8 条 active 消息
  5. 不注入工具描述
  6. 分配 Token 预算
  7. 合并输出

输出：
  system: Pero 人格 + 状态 + 2条记忆 + footer
  user: ...
  assistant: ...
  user: "陪我聊聊天"

Manifest:
  memory: 2 items retrieved
  tools: disabled
```

> 社交场景的编译流程将由子 Agent 应用独立实现，不走 ContextCompiler。

---

## 10. 与现有代码的对应

| 现有模块           | 新架构角色            | 处理方式                         |
| ------------------ | --------------------- | -------------------------------- |
| `PromptService`    | Compiler 的一部分     | 重构，移除 XML 历史注入          |
| `MdpEngine`        | Compiler 的渲染后端   | 保留渲染能力，不再承担上下文组织 |
| `HistoryEnricher`  | Compiler 的消息加载   | 移除 XML 序列化，改为原生消息    |
| `MemoryEnricher`   | Compiler 的记忆检索   | 保留，接入新 Memory 模型         |
| `StateEnricher`    | 暂时移除              | Agent 状态未来重新设计           |
| `SocialEnricher`   | Compiler 的社交上下文 | 按 channel 读取，不再按 source   |
| `EnrichmentRunner` | Compiler 的编排       | 简化为线性编译流程               |
| `PresetLoader`     | 移除                  | Channel 补丁直接由 Compiler 读取 |
| `extraVars`        | 移除                  | 核心变量不可被客户端覆盖         |
| 无 Token Budget    | TokenBudget           | 新增                             |
| 无 Manifest        | ContextManifest       | 新增                             |

---

## 11. 第一版简化

第一版 Compiler 可以简化为：

```text
1. 读取 Identity basePersona
2. 按 channel 读取 persona patch
3. 从 Thread 加载最近 N 条 active 消息
4. （可选）检索记忆
5. （可选）注入工具描述
6. 按顺序排列
7. 输出 LLM Messages

暂不实现：
  - 滚动摘要（先用固定窗口）
  - Token 预算（先用固定条数）
  - Manifest（先日志记录）
  - Workspace 引用
```

即使简化版，也已经彻底消除了历史重复注入，因为消息只从后端加载一次，保留原生角色。
