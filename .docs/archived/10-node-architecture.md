# 节点架构与能力提供者

> **归档警示**：本文记录历史设计与迁移背景，不代表当前架构。现行规范以[A01文档索引](../A01_PROJECT_STRUCTURE.md#6-规范文档与归档)及其列出的A02–A09/S系列文档为准；旧Channel、API、Package或Application表述不得用于新实现。

> 后端 Daemon 是大脑，Electron 壳是带特殊器官的身体。身体可以离开大脑独立存在（本地任务），大脑也可以接其他身体（多节点）。

---

## 1. 核心思路

PeroCore Daemon 是纯 Node 进程，不依赖任何 GUI 框架。平台特有能力（截图、通知、摄像头）通过"能力注册"机制委托给有能力的节点执行。

- Daemon 可独立启动和运行
- Electron 壳只是一个特殊的"节点客户端"
- 平台能力通过 Tool Provider 机制暴露给 Daemon
- 能力不可用时 Daemon 可降级处理

---

## 2. 节点角色

```text
PeroCore Daemon（后端运行时）
  ├─ 纯 Node 进程，可在任何机器上运行
  ├─ 不依赖任何 GUI 框架
  ├─ 承载：Agent Runtime、Thread、Memory、Context Compiler、Scheduler
  └─ 可运行在：PC、Linux 云端、Docker、移动端

Electron Shell（桌面壳）
  ├─ 一个特殊的"节点客户端"
  ├─ 自带 GUI（Vue 渲染进程）
  ├─ 自带平台能力（截图、窗口管理、系统托盘、通知）
  ├─ 启动时向 Daemon 注册自己的能力
  └─ 可运行在：Windows、macOS、Linux 桌面

CLI Client
  ├─ 纯命令行客户端
  ├─ 无 GUI，无平台能力
  ├─ 连接 Daemon 查询和操作
  └─ 可运行在：任何有 Node 的机器

Web Client
  ├─ 浏览器中的前端
  ├─ 无平台能力
  └─ 通过 HTTP/SSE 连接 Daemon

Mobile Client
  ├─ 移动端壳
  ├─ 自带移动平台能力（摄像头、定位、推送）
  ├─ 向 Daemon 注册移动能力
  └─ 可运行在：Android/iOS
```

---

## 3. 能力提供者模式

Daemon 不自己执行平台特有操作，而是通过 **Tool Provider** 机制委托给有能力的节点。

### 3.1 能力注册表

```text
NodeCapabilityRegistration
├─ nodeId: string
├─ nodeType: 'daemon' | 'electron' | 'mobile' | 'cli' | 'remote-daemon'
├─ url?: string                    ← 远程节点的连接地址
├─ capabilities: string[]          ← 能提供的能力列表
├─ status: 'online' | 'offline'
├─ registeredAt: string
└─ lastHeartbeat: string
```

### 3.2 注册表示例

```text
┌──────────────────┬──────────────┬─────────────┐
│ 能力              │ 提供节点      │ 状态         │
├──────────────────┼──────────────┼─────────────┤
│ read_file        │ daemon-local │ available   │
│ screen_capture   │ pc-electron  │ available   │
│ desktop_notify   │ pc-electron  │ available   │
│ camera_capture   │ mobile-001   │ unavailable │  ← 手机离线
│ terminal_execute │ daemon-local │ available   │
└──────────────────┴──────────────┴─────────────┘
```

### 3.3 调用流程

Agent 调用 `screen_capture` 时：

```text
1. Daemon 查能力注册表
   ├─ screen_capture → pc-electron
   └─ pc-electron 在线
2. Daemon 通过 IPC Tool Channel 向 Electron Main 发送调用请求
   ├─ { toolName: 'screen_capture', params, callId }
3. Electron Main 执行截图
   ├─ 调用 desktopCapturer 或 nut-js
   └─ 返回图片数据或文件路径
4. Daemon 收到结果
   ├─ 作为 tool_result 返回给 ReAct Loop
   └─ LLM 继续推理
```

### 3.4 能力不可用时降级

```text
screen_capture 不可用（Electron 关闭）
  → Daemon 返回工具错误：该能力当前没有可用节点
  → LLM 可回复"我现在没法看到屏幕"
  → 或降级为 read_file 读取日志

desktop_notify 不可用
  → 降级为 WebUI 内通知
  → 或写入 Thread 消息
```

---

## 4. 通信通道

两条通道分离：

```text
通道1：业务通信（HTTP/SSE/WS）
  前端 ↔ Daemon
  聊天、Thread 操作、配置管理、事件订阅
  任何客户端都走这条

通道2：能力调用（IPC/WS）
  Daemon → 有能力的节点
  截图、通知、窗口操作、摄像头
  仅在有工具调用需求时触发
```

```text
┌─────────────┐         HTTP/SSE/WS          ┌───────────────┐
│  Electron   │ ←──────────────────────────→ │   Daemon      │
│  Renderer   │    业务通信（聊天、Thread）    │   (Node)      │
│             │                              │               │
│  Main       │ ←──── IPC Tool Channel ────→ │               │
│  (平台能力)  │    能力调用（截图、通知）      │               │
└─────────────┘                              └───────────────┘
                                                      │
                                                      │ WS
                                                      ↓
                                              ┌───────────────┐
                                              │  Mobile       │
                                              │  (平台能力)    │
                                              └───────────────┘
```

---

## 5. Daemon 独立运行

### 5.1 启动模式

```text
生产模式：
  perocore-daemon --port 9120 --data /path/to/data
  ├─ 不需要 Electron
  ├─ 不需要 GUI
  ├─ 自己管理 SQLite + TriviumDB
  ├─ 自己运行 Scheduler
  ├─ 自己处理 HTTP/WS
  └─ 平台能力标记为 unavailable（直到有节点注册）

开发模式：
  pnpm dev:backend      ← 只启动后端
  pnpm dev:electron     ← 只启动前端壳
  pnpm dev              ← 同时启动（当前方式）
```

### 5.2 Electron 壳职责简化

Electron **不再负责**：

- 启动后端进程（Daemon 自己启动）
- 管理后端生命周期
- 充当后端的健康检查代理

Electron **只负责**：

- GUI 渲染
- 窗口、托盘、快捷键
- 注册和执行平台能力
- 作为业务客户端连接 Daemon

### 5.3 启动流程

```text
当前：
  Electron Main
    ├─ spawn Backend :9120
    ├─ 等待 Backend 就绪
    ├─ 创建窗口加载 Renderer
    └─ Backend 依赖 Electron 启动

新架构：
  Daemon（独立服务）
    ├─ 启动 HTTP/WS :9120
    ├─ 初始化数据库、Agent、Scheduler
    └─ 等待客户端连接

  Electron Shell（独立启动）
    ├─ 连接 Daemon HTTP/WS
    ├─ 注册平台能力
    ├─ 创建窗口加载 Renderer
    └─ Renderer 通过 HTTP/SSE 与 Daemon 通信

  两者可独立启动，也可打包为同进程组
```

---

## 6. 打包形态

```text
形态1：桌面全包（推荐给普通用户）
  perocore-setup.exe
    ├─ 安装 Daemon（注册为系统服务或开机启动）
    ├─ 安装 Electron Shell（开机启动）
    └─ 两者自动连接

形态2：Daemon 独立（推荐给服务器）
  perocore-daemon.tar.gz
    ├─ 纯 Node + 依赖
    ├─ pm2 管理
    └─ 无 GUI

形态3：Electron 独立（连接远程 Daemon）
  perocore-client.exe
    ├─ 只含 Electron Shell
    └─ 连接远程 Daemon 地址

形态4：CLI
  perocore-cli
    ├─ 命令行工具
    └─ 连接任意 Daemon
```

---

## 7. 入站路由表

替代"全局活跃 Agent"的关键机制。外部消息进来时查路由表，精确找到由谁处理。

### 7.1 路由表结构

```text
InboundRoute
├─ source: 'qq_private' | 'qq_group' | 'discord' | 'webhook' | 'monitor'
├─ identifier: string          ← QQ号、群号、webhook path 等
├─ agentId: string             ← 归属哪个 Agent
├─ channel: ThreadChannel      ← 创建什么类型的 Thread
├─ threadId?: string           ← 可选，固定到特定 Thread
└─ config?: Record<string, unknown>
```

### 7.2 路由表示例

```text
├─ qq_private, 123456     → agentId=pero,  channel=social
├─ qq_group, 789          → agentId=pero,  channel=group, participants=[pero, nana]
├─ discord, channel-42    → agentId=nana,  channel=social
├─ webhook, /alert/system → agentId=pero,  channel=desktop
└─ webhook, /alert/code   → agentId=nana,  channel=desktop
```

### 7.3 入站处理流程

```text
NapCat 收到 QQ 私聊消息
  ↓
查入站路由表：platform=qq, identifier=对方QQ号
  ↓
找到：agentId=pero, channel=social
  ↓
找到或创建对应的 Social Thread
  ↓
写入消息 → 触发 LLM 调用
```

---

## 8. "默认谁干活"的三个机制

"全局活跃 Agent"被移除后，由三个独立机制分别解决：

```text
1. Thread.agentId       → 对话场景（持久属性）
2. SchedulerTask.agentId → 后台任务（创建时指定）
3. InboundRoute.agentId  → 外部入站（路由表配置）
```

### 8.1 各场景对照

| 场景     | 决定方式                    |
| -------- | --------------------------- |
| 桌面聊天 | Thread 自带 agentId         |
| QQ 私聊  | 入站路由表决定              |
| QQ 群聊  | 入站路由表 + 运行时 @覆盖   |
| 日记生成 | Scheduler 任务自带 agentId  |
| 记忆提炼 | Scorer 按任务 agentId 分批  |
| 运维告警 | 入站路由表或 Scheduler 任务 |
| 后台反思 | Scheduler 任务自带 agentId  |

### 8.2 UI 默认 Agent

用户第一次打开客户端时"默认显示谁"，是纯 UI 偏好：

```text
UIConfig
├─ defaultAgentId: string    ← 默认显示谁（前端持久化）
├─ lastActiveThreadId?: string
└─ windowLayout: ...
```

只影响"打开客户端时默认显示哪个 Agent 的 Thread"，不影响后端任何行为。两个窗口可以有不同的默认 Agent。

---

## 9. 分布式能力注册（后续阶段）

多节点场景下，每个节点都向 Daemon 注册能力：

```text
NodeCapabilityRegistration
├─ nodeId: string
├─ nodeType: 'daemon' | 'electron' | 'mobile' | 'cli' | 'remote-daemon'
├─ url?: string
├─ capabilities: string[]
├─ status: 'online' | 'offline'
├─ registeredAt: string
└─ lastHeartbeat: string
```

### 9.1 跨节点工具调用

```text
Daemon (PC)
  ├─ Agent 调用 camera_capture
  ├─ 查注册表 → mobile-001 提供
  ├─ 通过 WS 向 mobile-001 发送调用
  │   { toolName: 'camera_capture', params, callId }
  ├─ mobile-001 执行拍照
  ├─ 返回图片（或图片引用 + Daemon 按需拉取）
  └─ 工具结果返回 ReAct Loop
```

### 9.2 工具调用决策

```text
1. 优先用 daemon-local（本地最快）
2. 其次用同局域网节点
3. 最后用远程节点
4. 多个节点都能提供时，按延迟或负载选择
```

---

## 10. 能力调用安全边界

```text
ToolProviderPolicy
├─ capability: string
├─ providerNodeId: string
├─ allowedAgents: string[]        ← 哪些 Agent 可调用
├─ requiresApproval: boolean      ← 是否需要用户批准
└─ rateLimit?: number             ← 频率限制
```

示例：

```text
screen_capture
  allowedAgents: [pero, nana]
  requiresApproval: false

camera_capture
  allowedAgents: [pero]
  requiresApproval: true

terminal_execute
  allowedAgents: [pero]
  requiresApproval: true
```

---

## 11. 第一版简化

```text
1. Daemon 独立启动，不依赖 Electron
2. Electron 连接 Daemon（而非启动 Daemon）
3. Electron 注册 screen_capture、desktop_notify 等能力
4. Daemon 通过 IPC 向 Electron 转发工具调用
5. 能力不可用时降级处理
6. 暂不实现多节点能力注册
7. 暂不实现跨节点工具调用
```

第一版目标：关掉 Electron 窗口后 Daemon 继续运行，QQ 消息和后台任务不受影响。截图等能力在 Electron 打开时可用，关闭时降级。
