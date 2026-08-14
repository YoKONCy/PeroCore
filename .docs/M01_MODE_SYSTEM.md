# Channel、Thread 与角色路由

> **架构基线**：[A09_AIOS_ARCHITECTURE](./A09_AIOS_ARCHITECTURE.md)
> **最后更新**：2026-08-12

---

## 1. Channel 替代全局模式

infOS 不再将 `mode` 作为 Agent 的可变全局状态。对话场景由 Thread 创建时写入的 `channel` 决定：

| Channel | 场景 | 上下文/运行时 |
|---|---|---|
| `desktop` | 标准桌面聊天 | PrincipalAgent Context Compiler |
| `companion` | 陪伴聊天 | PrincipalAgent Context Compiler |
| `social` | 外部平台私聊 | 社交应用运行时 |
| `group` | 据点与外部群聊 | 据点/社交应用运行时 |

- 一个 Agent 可同时参与多个不同 channel 的 Thread。
- Channel 不可在同一个 Thread 内切换；要变更场景则新建 Thread。
- `lightweight` 是 Thread 的 Context Policy 配置，不是模式。
- 历史 `work` 模式不再是主 Agent 模式；未来复杂工作由 AgentApplication/SubAgent 应用层承担。

---

## 2. 角色的三类状态

| 状态 | 含义 | 权威位置 |
|---|---|---|
| Installed | 存在可加载的 Agent 定义 | 官方/Workshop/用户资产层 |
| Enabled | 可被运行时调度或参与房间/路由 | 后端 Agent 状态 |
| Active（窗口级） | 当前窗口默认显示/交互的 Agent | 前端 UI 状态 |

“Active”不是后端全局状态。不同窗口可以选择不同 Agent；桌面聊天由 Thread 自带的 `agentId` 决定，外部入站由 `InboundRoute` 决定，Scheduler 由任务自身的 `agentId` 决定。

---

## 3. 据点 Stronghold

- Facility 是据点实体，Room 是多人交互与权威消息流的最小单元。
- Dispatcher 根据 @ 提及、成员与调度策略决定 Agent 回应顺序。
- 每个 Agent 在同一房间可拥有独立 group Thread，以隔离其人格、上下文与工具权限。
- 用户可见的对话日志则必须**按 Room 聚合**，读取房间权威消息流；不得把内部 Agent Thread 当作多个独立房间会话展示。

---

## 4. 社交路径

社交/群聊具有多用户节奏、发送者身份、独立社交记忆与状态机，不能假定为桌面一问一答的简单延伸。它们由社交应用运行时处理；入站消息必须通过 `InboundRoute(source, identifier)` 显式解析为 `{ agentId, channel, threadId?, config? }`，不能依赖“当前活跃角色”。

---

*本文档由 Carola 整理，适用于 infOS Channel、Thread 与角色路由规范。*
