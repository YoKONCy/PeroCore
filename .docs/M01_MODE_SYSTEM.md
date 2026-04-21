# 模式体系与角色管理

> **最后更新**：2026-04-21

---

## 1. 运行模式 (Sources)

PeroCore 根据消息来源划分三大顶层模式：

- **桌面模式 (`desktop`)**：标准桌伴应用，单用户。
- **群聊模式 (`group_chat`)**：据点/设施中的多角色互动。
- **社交模式 (`social`)**：通过社交桥接（Napcat/Discord）接入的外部平台。

---

## 2. 桌面模式 Profile

同一 `desktop` 源支持多种负载配置：

| Profile | Enricher 配置 | 特殊行为 |
|---|---|---|
| `default` | 全量 | 完整体验 |
| `lightweight` | 最小化 | 跳过记忆检索与工具枚举 |
| `companion` | 全量 | 激活主动对话调度器 |
| `work` | 全量 + 工作工具 | 切换到隔离的工作 session |

---

## 3. 社交模式架构 (Layered)

社交模式采用四层解耦，确保平台无关性：
- **Layer 0 (Bridge)**：主进程桥接，消息持久化。
- **Layer 1 (Manager/Scheduler)**：会话状态机、攒批逻辑。
- **Layer 2 (Abstract)**：标准 API 定义。
- **Layer 3 (Adapters)**：具体实现（Napcat, Discord, Telegram）。

---

## 4. 角色状态定义

| 状态 | 说明 |
|---|---|
| **Active (主角色)** | 桌面模式显示的唯一角色。 |
| **Enabled (启用)** | 已加载到内存，可参与群聊或接收社交消息。 |
| **Installed (已安装)** | `agents/` 目录下有完整配置文件。 |

---

## 5. 据点系统 (Stronghold)

- **Facility (设施)**：据点实体。
- **Room (房间)**：最小互动单元。
- **Dispatcher**：基于活跃度权重决定群聊接话顺序。

---

*本文档由 Carola 整理。*
