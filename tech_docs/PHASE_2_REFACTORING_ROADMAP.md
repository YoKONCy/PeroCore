# Phase 2 Refactoring Roadmap (重构路线图)

本文档详细拆解了 Phase 2 的实施步骤，重点关注代码层面的重构与清理。

## Stage 1: 基础设施铺垫 (Infrastructure)

### 1.1 Gateway 协议升级
- **目标**: 支持能力声明与动态注册。
- **任务**:
  - [ ] 修改 `backend/proto/perolink.proto`:
    - 在 `Hello` 消息中增加 `repeated string capabilities = 4;` 字段。
  - [ ] 重新生成 Python 和 TypeScript 的 Protobuf 代码。
  - [ ] 更新 `GatewayClient` (TS & Python)，在连接时自动发送预定义的 `capabilities` 列表。

### 1.2 引入 APScheduler
- **目标**: 建立统一的定时任务调度中心。
- **任务**:
  - [ ] `backend/requirements.txt` 添加 `APScheduler`。
  - [ ] 创建 `backend/services/scheduler_service.py`:
    - 初始化 `AsyncIOScheduler`。
    - 配置 SQLAlchemyJobStore (任务持久化)。
  - [ ] 在 `main.py` 启动时挂载 Scheduler。

## Stage 2: 核心链路统一 (Core Unification)

### 2.1 移除旧版语音链路 (WebSocket Deprecation)
- **目标**: 彻底断绝 `/ws/voice` 依赖。
- **任务**:
  - [ ] **Frontend**: 重构 `src/components/chat/ChatInterface.vue`:
    - 移除 `new WebSocket('/ws/voice')`。
    - 注入 `GatewayClient`。
    - 监听 `action:voice_update` (Thinking/Listening/Speaking 状态)。
  - [ ] **Backend**:
    - 删除 `backend/main.py` 中的 `@app.websocket("/ws/voice")`。
    - 清理 `realtime_session_manager.py` 中所有关于 `WebSocket` 对象的引用，改为纯 `GatewayClient` 发送。
  - [ ] **Cleanup**: 删除 `src/views/PetView.vue` 及其相关资源。

### 2.2 任务管理 Gateway 化
- **目标**: 统一前后端任务同步机制。
- **任务**:
  - [ ] **Backend**: 修改 `backend/services/task_manager.py`:
    - 增加 `broadcast_update()` 方法，调用 Gateway 发送 `task:update` 事件。
    - 在 `add_task`, `complete_task` 等操作后自动触发广播。
  - [ ] **Frontend**:
    - 在 `DashboardView.vue` 或 `Pet3DView.vue` 中监听 `task:update`，实时刷新 UI。
    - 移除原有的 HTTP 轮询逻辑。

## Stage 3: 能力网格与动态工具 (Capability Grid)

### 3.1 Social Service 轻量化重构
- **目标**: 让 Social Adapter 回归“管道”本质。
- **任务**:
  - [ ] **Backend**: 重构 `backend/nit_core/plugins/social_adapter/social_service.py`:
    - 移除内部的 `SocialAgent` 和独立 Prompt 渲染逻辑。
    - 收到 QQ 消息 -> 包装为标准 `UserMessage` -> 扔给 `AgentManager` 统一处理。
    - 收到后端 `Action` -> 转换为 OneBot API 调用。

### 3.2 动态工具过滤 (Dynamic Tooling)
- **目标**: 移除 `social_chat` 中的硬编码白名单。
- **任务**:
  - [ ] **Backend**: 修改 `backend/services/agent_service.py`:
    - 废弃 `social_chat()` 方法。
    - 在 `chat()` 方法中引入 `CapabilityFilter`:
      ```python
      # 伪代码
      available_tools = plugin_manager.get_tools()
      if source == "social":
          available_tools = [t for t in tools if t.required_capability in ["social", "logic"]]
      ```
  - [ ] **Config**: 在 `plugin_manager` 中为每个工具添加 `required_capability` 元数据（默认为 "core"）。

## Stage 4: 统一提醒系统 (Unified Reminder System)

### 4.1 核心架构：异构协议适配
由于各端交互协议不同（PC用NIT，移动端用XML，QQ用纯文本），我们需要在后端建立一个 **"协议适配层"**，将不同来源的提醒请求标准化后存入 `APScheduler`。

- **Unified Backend Service**: `SchedulerService` (单例，负责 CRUD 和调度)。
- **Data Source**:
  - **PC (NIT)**: 通过 `SchedulerPlugin` 直接调用 Service。
  - **Mobile (XML)**: 移动端解析 LLM 的 `<REMINDER>` 标签 -> 调用 API `POST /api/reminders/sync` -> Service。
  - **Social (ReAct)**: 社交模式下 Agent 拥有工具调用能力，直接调用 `add_reminder` 工具 -> Service。

### 4.2 提醒工具实现 (Backend)
- **目标**: 让 LLM 能设定闹钟。
- **任务**:
  - [ ] 创建 NIT 工具 `backend/nit_core/plugins/Scheduler/scheduler_ops.py`:
    - `add_reminder(time, content, repeat_rule)`
    - `list_reminders()`
    - `delete_reminder(id)`
  - [ ] 创建 API 端点 `backend/routers/scheduler.py`:
    - `POST /sync`: 接收移动端上传的 XML 解析结果。

### 4.3 多端响应实现 (Frontend/Client)
- **目标**: 各端实现对 `action:reminder_trigger` 的响应。
- **任务**:
  - [ ] **Backend**: Scheduler 触发时，通过 Gateway 广播 `action:reminder_trigger`。
  - [ ] **Frontend (PC)**: `Pet3DView.vue` 收到广播 -> 播放 TTS -> 弹窗。
  - [ ] **Mobile App**: 
    - 监听 Gateway 消息（在线时）。
    - 增加“同步机制”：启动时拉取后端未完成的提醒，覆盖本地 LocalStorage。
  - [ ] **Social Adapter**: 收到广播 -> 发送私聊消息。

## Stage 5: 验收与测试 (Verification)

### 5.1 关键测试用例
- [ ] **语音链路**: PC 端说话 -> 后端处理 -> PC 端听到回复 (纯 Gateway 链路)。
- [ ] **跨端控制**: QQ 发送“关闭电脑” -> 电脑关机。
- [ ] **全端提醒**: QQ 设定“1分钟后提醒我喝水” -> 1分钟后 PC 弹窗 + QQ 收到消息。
- [ ] **断网恢复**: 拔网线 30 秒 -> 插回 -> Gateway 自动重连成功。

---
*建议执行顺序: 2.1 (止血) -> 1.1 & 1.2 (基建) -> 4 (新特性) -> 3 (深水区重构)*
