# Channel 隔离策略

> **归档警示**：本文记录历史设计与迁移背景，不代表当前架构。现行规范以[A01文档索引](../A01_PROJECT_STRUCTURE.md#6-规范文档与归档)及其列出的A02–A09/S系列文档为准；旧Channel、API、Package或Application表述不得用于新实现。

> Channel 是 Thread 的持久属性，不是 Agent 状态，也不是运行时状态。
> 主 Agent 通过 Thread channel 实现不同对话场景的上下文、记忆、人格、工具隔离。

---

## 0. 适用范围

本文档描述的 Channel 隔离策略**仅适用于主 Agent（PrincipalAgent）**，即由 ContextCompiler 编译上下文的场景。

| Channel     | 是否由主 Agent 编译 | 说明                                  |
| ----------- | ------------------- | ------------------------------------- |
| `desktop`   | ✅ 是               | 桌面聊天（主场景）                    |
| `companion` | ✅ 是               | 陪伴模式                              |
| `social`    | ❌ 否               | 社交平台私聊（子 Agent 应用，待重构） |
| `group`     | ❌ 否               | 群聊（子 Agent 应用，待重构）         |

> `social`/`group` 场景将由独立的社交子 Agent 应用处理，不走 ContextCompiler。
> 详见 [03-context-runtime.md 第 0.2 节](./03-context-runtime.md#02-社交场景从-contextcompiler-剥离)。

---

## 1. Channel 定义

```text
type ThreadChannel =
  | 'desktop'       ← 桌面聊天（主 Agent）
  | 'companion'     ← 陪伴模式（主 Agent）
  | 'social'        ← 社交平台私聊（预留，子 Agent 应用）
  | 'group'         ← 群聊（预留，子 Agent 应用）
```

### 1.1 Channel 的性质

- **持久属性**：Thread 创建时确定，存入数据库，跨重启保留。
- **不是 Agent 状态**：Agent 没有"当前 channel"，可以同时参与多个不同 channel 的 Thread。
- **不是运行时状态**：每次 LLM 调用时从 Thread 读取，不在运行时切换。
- **不可变**：Thread 创建后 channel 不可更改（如需变更，创建新 Thread）。

### 1.2 Channel 不是模式切换

主 Agent 始终是同一个，channel 只影响 Thread 的策略配置。不存在"切换到 companion 模式"这个动作，只有"在 companion Thread 中发消息"。

---

## 2. 三层隔离（主 Agent）

### 2.1 Thread 隔离

不同 channel 的 Thread 拥有完全独立的消息存储。一个 Thread 的消息永远不会出现在另一个 Thread 的上下文中。

### 2.2 Context Policy 隔离

| Channel   | messageWindow | memoryRetrieval | toolDescription | stateInjection |
| --------- | ------------- | --------------- | --------------- | -------------- |
| desktop   | 20            | true            | true            | true           |
| companion | 8             | true            | false           | true           |

### 2.3 Memory Policy 隔离

| Channel   | 写入 Main | 检索 Main |
| --------- | --------- | --------- |
| desktop   | 是        | 是        |
| companion | 是        | 是        |

> 社交记忆（social.tdb）属于社交子 Agent 应用，不在主 Agent 策略范围内。

---

## 3. 人格补丁

核心人格始终存在，补丁只叠加差异部分：

```text
Identity
├─ basePersona: Pero 核心人格（常驻）
└─ channelPatches:
   ├─ desktop: null（用完整人格）
   └─ companion: +陪伴人格
```

补丁由 Context Compiler 在编译时读取，不修改人格定义。

> `social`/`group` 补丁将由社交子 Agent 应用独立管理。

---

## 4. 工具权限隔离

| Channel   | 文件工具        | 终端          | 搜索 | 网络 |
| --------- | --------------- | ------------- | ---- | ---- |
| desktop   | workspace scope | workspace cwd | 允许 | 允许 |
| companion | workspace scope | 禁止          | 允许 | 允许 |

> 社交场景的工具权限由社交子 Agent 应用独立管理。

---

## 5. 模式清理

| 当前模式    | 重构后                          |
| ----------- | ------------------------------- |
| default     | channel=desktop                 |
| work        | **移除**，留给未来 Coding App   |
| social      | 社交子 Agent 应用（待重构）     |
| group_chat  | 社交子 Agent 应用（待重构）     |
| companion   | channel=companion               |
| lightweight | Context Policy 配置项，不是模式 |

---

## 6. 多 Thread 共存示例（主 Agent）

```text
Pero
├─ Thread: desktop-chat-001 (channel=desktop)
│  ├─ Policy: window=20, memory=true, tools=true
│  ├─ Memory: 写入 main.tdb
│  └─ Persona: 完整人格
│
└─ Thread: companion-001 (channel=companion)
   ├─ Policy: window=8, memory=true, tools=false
   ├─ Memory: 写入 main.tdb
   └─ Persona: companion 补丁
```

切换 Thread 不影响其他 Thread。新建 Thread 不清除记忆。

---

## 7. 社交场景（待重构）

社交场景（`social`/`group`）将从主 Agent 剥离，作为独立的子 Agent 应用设计：

- **独立人格**：社交子 Agent 有自己的社交语气补丁
- **独立工作区**：社交观察日志、水群策略
- **独立状态机**：看群频率、水群意愿、社交心情
- **独立记忆系统**：social.tdb 图谱（BM25 + 图谱扩散）
- **独立工具集**：send_social_message、recall_social_memory 等

当前社交场景继续走现有 `SocialBridge + SocialEnricher` 独立路径，不受主 Agent 重构影响。

详见 [11-sub-agent-social.md](./11-sub-agent-social.md)（待补）。
