# PeroCore Phase 2 技术演进计划

## 1. 概述
本计划旨在统一 PeroCore 的通信架构，移除历史技术债，并构建支持多端同步的现代化能力框架。核心目标是实现 **"Gateway-First"** 战略，即所有实时交互均通过统一的 Gateway 进行，不再保留专用的 WebSocket 连接。

## 2. 架构统一与清理 (Cleanup & Deprecation)
目前系统中共存了旧版 WebSocket (`/ws/voice`) 和新版 Gateway 协议，造成了维护困难和资源浪费。

### 2.1 移除旧版语音链路
- **现状**: 后端 `main.py` 仍保留 `@app.websocket("/ws/voice")` 端点；`PetView.vue` 和 `ChatInterface.vue` 部分依赖此旧链路。
- **行动**:
  1. **前端**: 迁移 `ChatInterface.vue`，使其监听 Gateway 的 `action:voice_update` 广播，替代旧的 WebSocket `thinking` 状态监听。
  2. **后端**: 删除 `main.py` 中的 `/ws/voice` 路由，以及 `realtime_session_manager.py` 中的旧 WebSocket 处理逻辑。
  3. **废弃**: 正式归档并移除 `src/views/PetView.vue` (Live2D)，确立 `src/views/Pet3DView.vue` 为唯一语音交互入口。

### 2.2 统一状态分发
- **目标**: 所有系统状态（语音状态、思考过程、系统负载）均通过 Gateway 的 `Action` 机制广播，前端不再主动轮询。

## 3. 稳定性与性能优化 (Stability & Performance)

### 3.1 音频流分片传输 (Stream Chunking)
- **问题**: 当前 `sendStream` 是一次性发送完整 WAV Buffer。对于长语音或弱网环境，这可能导致阻塞或失败。
- **方案**:
  - 在 Gateway 协议层充分利用 `is_end` 标记。
  - 前端/后端支持将大音频文件切分为 4KB-16KB 的 chunks 连续发送。
  - 后端实现流式 ASR (如支持)，即收即转，降低延迟。

### 3.2 强化连接鲁棒性
- **方案**: 完善 `GatewayClient` 的断线重连机制，增加指数退避算法 (Exponential Backoff)，确保在网络波动后能自动恢复会话并重新注册 Device ID。

## 4. 能力扩展 (Capability Expansion)

### 4.1 任务管理 Gateway 化
- **现状**: 任务管理目前依赖 HTTP 轮询或手动操作。
- **方案**: 将 `task_manager.py` 接入 Gateway。
  - **指令**: 前端发送 `Action` (如 `task:add`, `task:complete`)。
  - **响应**: 后端广播 `task:update` 事件，所有客户端实时刷新任务列表。

### 4.2 系统监控广播
- **方案**: 后端定时（如每 5 秒）广播 CPU/Memory/GPU 状态，前端 Dashboard 仅需被动监听即可展示实时图表，减少 HTTP 请求开销。

## 5. 统一提醒系统设计 (Unified Reminder System)
构建“后端统一调度，多端被动响应”的分布式提醒架构。这是 Phase 2 的核心新特性。

### 5.1 架构设计
采用 **"Backend 统一调度 -> Gateway 广播分发 -> 多端被动响应"** 模式。

- **大脑 (Scheduler Service)**: 
  - Python 后端集成 `APScheduler`。
  - 作为系统中**唯一**的时间管理者和触发源。
  - 负责任务的持久化存储（Database），防止重启丢失。
  
- **神经中枢 (Gateway)**: 
  - 负责将后端的触发信号转化为广播消息。
  - 协议: `Action` 类型，例如 `action:reminder_trigger`。

- **手脚 (Clients)**: 
  - **PC 桌面端**: 监听广播 -> 唤醒 Pero 3D 模型 -> 播放语音提醒 -> 桌面弹窗。
  - **手机 APP**: 监听广播 -> 触发系统级推送通知 (Push Notification)。
  - **QQ 机器人**: 监听广播 -> 发送私聊消息给用户。

### 5.2 数据流示例
1. **意图识别**: 
   - 用户说: "提醒我12点吃饭"
   - LLM 解析意图 -> 调用工具 `add_reminder(time="12:00", content="吃饭")`
   - 后端将任务存入数据库，并注册到 `APScheduler`。

2. **触发流程**: 
   - 12:00 到达 -> `APScheduler` 触发回调。
   - 回调函数调用 `gateway_client.send_action(target="broadcast", type="reminder_trigger", data={...})`。

3. **多端响应**:
   - 所有在线设备收到广播，根据自身能力执行提醒（弹窗、震动、发消息）。

### 5.3 核心优势
- **解耦**: 客户端逻辑极简，无需编写定时器代码，只负责“显示”。
- **同步**: 任何一端设置提醒，所有端都能生效。
- **一致性**: 提醒内容和时间由后端统一控制，避免多端时间不准导致的问题。

## 6. 分布式能力网格 (Distributed Capability Grid)
通过 **"能力即服务 (Capability as a Service)"** 的理念，实现跨端能力调用，彻底解决“边缘端无法使用核心能力”的问题。

### 6.1 核心概念
系统中的每个节点（Client）都是一组特定能力的提供者。Gateway 充当能力注册中心和消息路由总线。

- **Python Backend (Core)**: 提供 `nit.executor` (脚本执行), `ai.reasoning` (逻辑思考), `db.access` (数据存取)。
- **Electron Frontend (Windows)**: 提供 `ui.display` (界面展示), `audio.playback` (音频播放), `desktop.notify` (桌面通知)。
- **Mobile App (Edge)**: 提供 `notification.push` (推送), `location.gps` (定位)。
- **Social Adapter (QQ)**: 提供 `social.qq` (消息收发)。

### 6.2 跨端调用机制
**场景**: 用户在 QQ (Edge) 上发指令“关闭电脑”。

1. **输入 (Edge -> Core)**: 
   - QQ Adapter 接收消息 -> 转发给 Backend。
   - *Adapter 不知道什么是关机，它只负责传递意图。*

2. **决策 (Core)**:
   - Backend LLM 分析意图 -> 识别为 `system_control.shutdown()`。
   - Backend 检查能力表 -> 发现自己 (Core) 拥有 `nit.executor` 权限。

3. **执行 (Core)**:
   - Backend 在本地执行 NIT 脚本 -> Windows 关机。

### 6.3 协议升级
- **Hello 包扩展**: 客户端连接时在 `Hello` 消息中声明 `capabilities: ["..."]`。
- **动态工具链**: LLM 的可用工具列表不再硬编码，而是根据当前在线的客户端能力动态生成。
  - 例如：如果 Mobile 端在线，LLM 自动获得 `get_gps_location` 工具。

---
*文档生成时间: 2026-01-30*
*状态: 规划中 (待实施)*
