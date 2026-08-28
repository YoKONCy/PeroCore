# 11. AIOS 重构收尾修复计划

> **归档警示**：本文记录历史设计与迁移背景，不代表当前架构。现行规范以[A01文档索引](../A01_PROJECT_STRUCTURE.md#6-规范文档与归档)及其列出的A02–A09/S系列文档为准；旧Channel、API、Package或Application表述不得用于新实现。

> 基于 2026-08-07 全面审计的结论制定。
> 范围：修复 P0/P1 级缺陷、补齐未完成项、清理技术债。
> 不涉及新特性开发（分布式多节点、AgentApplication 等不在本计划内）。

## 0. 修复原则

1. **第一版优先**：本计划只解决"让第七阶段真正可用"的问题，不做架构跃迁
2. **安全先行**：涉及权限/隔离的 Bug 优先级高于功能 Bug
3. **最小改动**：能改一行不重写一个函数，能加适配层不重构协议
4. **保留备份**：重构文件保留 `xxx.bak`（遵循用户偏好）
5. **测试覆盖**：每个修复点必须有对应的测试用例验证

---

## 1. 修复批次总览

| 批次   | 内容                                                    | 优先级 | 依赖     |
| ------ | ------------------------------------------------------- | ------ | -------- |
| 批次 A | 启动链路与能力桥接修复（P0-1/2/3）                      | P0     | 无       |
| 批次 B | 权限隔离修复（P0-4 + P1-1/2）                           | P0     | 无       |
| 批次 C | 前端 runtimeApi 接入 + 失败测试修复（P1-3）             | P1     | 无       |
| 批次 D | 入站路由补全（P1-4）                                    | P1     | 批次 B   |
| 批次 E | 架构加固（fail-closed / 协议提取 / WS 鉴权 / 注销语义） | P1     | 批次 A/B |
| 批次 F | 技术债清理（.bak / work 残留 / 注释）                   | P2     | 批次 A-E |

每批独立可验证，建议顺序 A → B → C → D → E → F。

---

## 2. 批次 A：启动链路与能力桥接修复

### 目标

让 `pnpm start` 后，Electron 能成功注册能力、截图工具能真正执行、多模态截图能正确注入。

### A1. 修复启动链路断开（P0-1）

**问题**：`pnpm start` → `start-dev.mjs` spawn `pnpm dev` → `backend/main.ts`，不启动 CapabilityBridge。Electron CapabilityProvider 连不上 :9121。

**方案**：让 `backend/main.ts` 也启动 CapabilityBridge，与 `daemon/main.ts` 复用同一套启动逻辑。

**改动**：

1. 在 `backend/src/main.ts` 的启动流程中，于 HTTP 服务启动后追加：
   - 实例化 `CapabilityBridge`（复用 `ctx.capabilityBridge`）
   - 调用 `capabilityBridge.start(port)` 监听 :9121
   - 在 `app.shutdown()` 时 `capabilityBridge.stop()`
2. 不删除 `daemon/main.ts`（保留作为独立进程入口，未来形态2/3使用）
3. 在 `backend/main.ts` 启动日志中打印 CapabilityBridge 端口

**验证**：

- `pnpm start` 后日志显示 "CapabilityBridge listening on :9121"
- Electron CapabilityProvider 日志显示 "registered success"
- `curl http://localhost:9120/api/health` 仍正常

**备选方案**（若方案1引入循环依赖）：将 `capabilityBridge.start()` 抽到 `container.ts` 的 `init()` 钩子里，由 main.ts 统一调用。

### A2. 修复工具名不匹配（P0-2）

**问题**：

- 真实工具名：`take_screenshot`
- toolExecutor 平台名单：`screen_capture` + `take_screenshot`
- Electron handler 注册：只有 `screen_capture`

LLM 调 `take_screenshot` 时，`findProvider('take_screenshot')` 返回 null。

**方案**：在 toolExecutor 的平台工具路由层加一个**能力名映射表**，把工具名映射到能力名。

**改动**：

1. 在 `toolExecutor.ts` 的平台工具名单附近新增映射：
   ```typescript
   /** 工具名 → 能力名映射（同一能力可被多个工具名调用） */
   const TOOL_TO_CAPABILITY: Record<string, string> = {
     take_screenshot: 'screen_capture',
   }
   ```
2. 修改平台工具路由逻辑：查找能力时用 `TOOL_TO_CAPABILITY[fnName] ?? fnName`
3. 同步在 Electron `CAPABILITY_HANDLERS` 注释里标注 `screen_capture` 会被 `take_screenshot` 工具调用

**验证**：

- LLM 调 `take_screenshot` → toolExecutor 路由到 `screen_capture` 能力 → Electron handler 执行 → 返回结果

### A3. 修复返回格式不匹配（P0-3）

**问题**：

- reactLoop 期望：`{ success, screenshots: [{ index, dataUri }], message }`
- Electron `captureScreen()` 返回：`{ dataUrl, width, height, timestamp }`

**方案**：在 Electron 的 `screen_capture` handler 内做格式适配，返回 reactLoop 期望的结构。

**改动**：

1. 修改 `capabilityProvider.ts` 的 `screen_capture` handler：
   ```typescript
   screen_capture: async (args) => {
     const maxWidth = (args.maxWidth as number) ?? 1280
     const raw = await captureScreen(maxWidth)
     // 适配为 reactLoop 期望的格式
     return {
       success: true,
       screenshots: [{ index: 0, dataUri: raw.dataUrl }],
       message: `已截取屏幕 (${raw.width}x${raw.height})`,
     }
   },
   ```
2. 不改 `captureScreen()` 本身（保持底层能力通用）
3. 不改 reactLoop 的解析逻辑（保持多模态注入逻辑稳定）

**验证**：

- LLM 调 `take_screenshot` → 收到 `{ success, screenshots: [{ index, dataUri }] }` 格式
- 多模态模型能"看到"截图（reactLoop 正确提取 image_url 块）

### A 批次测试

- 新增 `toolExecutor.test.ts` 测试：模拟 `take_screenshot` 调用，验证路由到 `screen_capture` 能力
- 新增 `capabilityProvider.test.ts`（如可测）：验证 `screen_capture` handler 返回格式
- 手动验证：`pnpm start` → 发送截图请求 → 检查日志和模型回复

---

## 3. 批次 B：权限隔离修复

### 目标

修复多 Agent 权限隔离失效、社交场景工具集过宽、平台工具绕过权限校验三个安全漏洞。

### B1. 修复 ToolExecutor agentId 硬编码（P0-4）

**问题**：

- `toolExecutor.ts:155` `const agentId = this.defaultContext.agentId ?? 'pero'`
- `container.ts` 创建 ToolExecutor 时根本没传 `defaultContext`
- `runtimeContext` 只传 threadId/channel，不传 agentId
- 结果：所有 Agent 的工具权限校验都用 Pero 的配置

**方案**：把 `agentId` 提升为 `execute()` 的必填 runtimeContext 字段，删除 `defaultContext` 兜底。

**改动**：

1. 修改 `ToolExecutor` 接口（`reactLoop.ts` 中定义）：
   ```typescript
   export interface ToolExecutor {
     execute(
       name: string,
       args: Record<string, unknown>,
       source: string,
       context?: {
         threadId?: string
         channel?: string
         agentId?: string // 新增：必填，工具权限校验依赖
       },
     ): Promise<ToolExecutionResult>
   }
   ```
2. 修改 `toolExecutor.ts` 的 `execute()`：
   - 删除 `const agentId = this.defaultContext.agentId ?? 'pero'`
   - 改为 `const agentId = context?.agentId`
   - 若 `agentId` 缺失，日志 warn 并用 'pero' 兜底（过渡期，最终应抛错）
3. 修改 `reactLoop.ts` 调用处：在 `toolExecutor.execute(fnName, fnArgs, source, params.threadContext)` 的 threadContext 中加入 `agentId`
4. 修改 `reactLoop.ts` 的 `runReActLoop` 参数：新增 `agentId: string` 必填字段
5. 修改所有 `runReActLoop` 调用方：传入正确的 agentId

**影响面排查**：

- `agentService.ts` 的 `chat()` / `chatStreamWithCompiled()` 需要透传 agentId 到 reactLoop
- `socialBridge.ts` 的 `agentService.chat()` 已传 agentId，需要 chat() 不再丢弃它
- `companionScheduler.ts` 同理

**验证**：

- 新增测试：两个不同 agentId 调用同一工具，验证走各自的 capabilities.yaml
- Nana 调用 Pero 独有的工具 → 被拒绝

### B2. 修复 agentService.chat() 丢弃 source（P1-1）

**问题**：

- `agentService.ts:218` 硬编码 `runChat(..., 'desktop')`
- socialBridge 传的 `source: 'social'` 被丢弃
- 社交场景拿到 desktop 工具集（含 terminal_execute 等）

**方案**：移除 `chat()` 兼容层的硬编码，透传 source 到 `chatWithCompiledMessages()`。

**改动**：

1. 修改 `agentService.ts` 的 `chat()` 方法：
   - 删除 `const source = 'desktop'`（第218行附近）
   - 改为 `const source = params.source ?? 'desktop'`
2. 同理修改 `chatWithCompiledMessages()`（第93行附近）：
   - 删除硬编码 `'desktop'`
   - 改为接收 source 参数
3. 确认所有调用方都传了正确的 source：
   - `socialBridge.ts` → `source: 'social'` ✅（已传）
   - `stronghold.router.ts` → `source: 'group_chat'` ✅（已传）
   - `companionScheduler.ts` → 检查并补传 `source: 'companion'`

**验证**：

- 社交场景日志显示 `source=social`
- MODE_MAX_TURNS 按社交配置（2轮而非30轮）
- 工具集按 social channel 过滤

### B3. 修复 CapabilityGate fail-open（P1-1）

**问题**：

- `capabilityGate.ts:93` 未配置 channel 回退 desktop
- 当前 capabilities.yaml 没有 social/group 配置
- fail-open 等于"忘记配置=全开放"

**方案**：改为 fail-closed——未配置 channel 返回空能力集。

**改动**：

1. 修改 `capabilityGate.ts` 的 `resolveChannelConfig()`：
   ```typescript
   const channelConfig = config?.channels[channel]
   if (!channelConfig) {
     logger.warn(`Channel "${channel}" 未配置能力，fail-closed 返回空集`)
     return { allowedTools: [], deniedTools: [], defaultEnabled: false }
   }
   ```
2. 删除 `?? config?.channels['desktop']` 回退逻辑

**注意**：此改动需要在 B4 补充 social/group channel 配置后才能真正生效，否则社交场景会完全没有工具可用（过渡期可接受——空集比全开放安全）。

**验证**：

- 未配置的 channel 调用任何工具 → 被拒绝
- 日志打印 warn 提示配置缺失

### B4. 补充 social/group channel 配置

**问题**：`capabilities.yaml` 只有 desktop/companion 配置，缺 social/group。

**方案**：在 Pero 和 Nana 的 `capabilities.yaml` 中补充 social/group channel 的最小配置。

**改动**：

1. `packages/backend/src/services/mdp/agents/pero/capabilities.yaml` 新增：
   ```yaml
   social:
     defaultEnabled: false
     allowedTools:
       - take_screenshot
       - clipboard_read
       - send_social_message
     deniedTools:
       - terminal_execute
       - write_file
       - run_script
       - delete_file
   group:
     defaultEnabled: false
     allowedTools:
       - send_social_message
     deniedTools:
       - terminal_execute
       - write_file
       - run_script
       - delete_file
       - take_screenshot
   ```
2. Nana 的 `capabilities.yaml` 同理补充
3. 注释说明这是"第一版最小配置"，未来由社交子 Agent 应用独立管理

**验证**：

- social channel 调用 `terminal_execute` → 被拒绝
- social channel 调用 `take_screenshot` → 允许
- group channel 调用 `take_screenshot` → 被拒绝

### B5. 修复平台工具绕过权限校验（P1-2）

**问题**：

- `toolExecutor.ts:203` 平台能力路由在 CapabilityGate 校验**之前**返回
- 截图/剪贴板等工具不受白名单约束

**方案**：把平台工具路由移到 CapabilityGate 校验之后，或在校验前先做一次白名单检查。

**改动**：

1. 重构 `toolExecutor.ts` 的 `execute()` 流程：
   ```
   1. 解析 agentId/channel（来自 runtimeContext）
   2. CapabilityGate 校验工具是否允许 ← 先做
   3. 若是平台工具 → 路由到 CapabilityBridge
   4. 若是普通工具 → 走 ToolRegistry
   ```
2. 具体实现：把 `isPlatformTool` 判断和 `capabilityBridge.invokeTool` 调用移到 `capabilityGate.check()` 之后
3. 注意：`take_screenshot` 在 B4 配置中已加入 social channel 白名单，所以不会因 fail-closed 被误拒

**验证**：

- social channel 调用 `take_screenshot` → 通过校验 → 路由到 CapabilityBridge
- group channel 调用 `take_screenshot` → 被 CapabilityGate 拒绝（不在白名单）
- social channel 调用 `terminal_execute` → 被拒绝（不进入平台路由）

### B 批次测试

- 新增 `toolExecutor.test.ts`：多 Agent 权限隔离测试
- 新增 `capabilityGate.test.ts`：fail-closed 行为测试
- 新增 `capabilityGate.test.ts`：social/group channel 配置测试
- 修改 `agentService.test.ts`：验证 source 透传
- 修改现有测试：补充 agentId 参数

---

## 4. 批次 C：前端 runtimeApi 接入

### 目标

让前端真正消费后端 `/api/runtime/window-agent` 接口，修复失败测试。

### C1. 新建 frontend runtimeApi 模块

**改动**：

1. 新建 `packages/frontend/src/api/modules/runtimeApi.ts`：

   ```typescript
   import { http } from '../transport'

   export const runtimeApi = {
     /** 设置窗口级 Agent */
     setWindowAgent: (windowId: string, agentId: string) =>
       http.post(`/api/runtime/window-agent`, { windowId, agentId }),

     /** 获取窗口级 Agent */
     getWindowAgent: (windowId: string) => http.get(`/api/runtime/window-agent/${windowId}`),

     /** 清除窗口级 Agent */
     clearWindowAgent: (windowId: string) => http.delete(`/api/runtime/window-agent/${windowId}`),

     /** 获取所有窗口 Agent 映射 */
     getAllWindowAgents: () => http.get(`/api/runtime/window-agent`),
   }
   ```

2. 在 `packages/frontend/src/api/index.ts` 中导出 `runtimeApi`

### C2. 改造 useAgentStore

**改动**：

1. 修改 `useAgentStore.ts` 的 `switchAgent()`：
   - 删除对 `agentApi.setActive()` 的调用（API 已删除）
   - 改为调用 `runtimeApi.setWindowAgent(windowId, agentId)`
   - `windowId` 从 `useWindowStore` 或 IPC 获取
2. 删除头部 TODO 注释（任务已完成）

### C3. 修复失败的 coreStores 测试

**改动**：

1. 修改 `packages/frontend/tests/unit/stores/coreStores.test.ts`：
   - 删除对 `agentApi.agentSetActive` 的 mock 和断言
   - 改为 mock `runtimeApi.setWindowAgent`
   - 断言 `switchAgent` 调用了 `runtimeApi.setWindowAgent`

**验证**：

- `pnpm test:run` 全绿（447/447 通过）

### C 批次测试

- 修改 `coreStores.test.ts`：验证 runtimeApi 调用
- 新增 `runtimeApi.test.ts`（可选）：验证 API 路径和参数

---

## 5. 批次 D：入站路由补全

### 目标

让入站路由的 `channel` / `threadId` 真正被使用，社交路径接入 Thread 模型。

### D1. socialBridge 使用路由的 channel

**问题**：`socialBridge.ts:199-206` 只取 `resolved.agentId`，丢弃 `channel` / `threadId` / `config`。

**方案**：把路由解析出的 channel 和 threadId 透传到 agentService.chat()。

**改动**：

1. 修改 `socialBridge.ts` 的 `handleInbound()`：
   ```typescript
   if (resolved) {
     inbound.agentId = resolved.agentId
     // 使用路由指定的 channel，否则按 channelType 推断
     inbound.routeChannel = resolved.channel ?? (channelType === 'private' ? 'social' : 'group')
     inbound.routeThreadId = resolved.threadId
   }
   ```
2. 在 `InboundMessage` 类型中新增 `routeChannel?` / `routeThreadId?` 字段
3. 修改 `executeReply()`：把 `routeChannel` 和 `routeThreadId` 透传到 `agentService.chat()`
4. 修改 `agentService.chat()`：接收 `threadId` 参数，传给 `chatWithCompiledMessages()`

### D2. 社交路径接入 Thread 模型（最小实现）

**问题**：社交消息当前不走 Thread 模型，sessionId 是临时拼的 `social_xxx_yyy`。

**方案**：第一版最小实现——若路由指定了 threadId 则复用，否则按 (agentId, platform, channelId) 查找或创建 Thread。

**改动**：

1. 在 `socialBridge.ts` 注入 `ThreadRepository`（container.ts 已有）
2. 在 `executeReply()` 中：
   ```typescript
   let threadId = session.routeThreadId
   if (!threadId) {
     // 按 (agentId, channel标识) 查找最近活跃的 Thread
     threadId = await threadRepo.findRecentByAgentAndChannel(agentId, channelKey)
     if (!threadId) {
       // 创建新 Thread
       threadId = await threadRepo.create({ agentId, channel: routeChannel, ... })
     }
   }
   ```
3. 在 `ThreadRepository` 新增 `findRecentByAgentAndChannel()` 方法（若不存在）
4. 用 `threadId` 作为 `agentService.chat()` 的 `sessionId`

**注意**：此改动较大，需要谨慎评估对现有社交逻辑的影响。若风险高，可拆为 D2a（透传 threadId）和 D2b（自动查找/创建）两步。

### D 批次测试

- 修改 `socialBridge.test.ts`：验证路由 channel/threadId 被使用
- 新增 `threadRepo.test.ts`：验证 `findRecentByAgentAndChannel()`

---

## 6. 批次 E：架构加固

### E1. CapabilityGate fail-closed（与 B3 合并或独立）

**说明**：B3 已将 fail-closed 作为修复的一部分。此处独立列出是为了强调它也是架构加固——未来新增 channel 必须显式配置，不能再依赖回退。

**额外改动**：

1. 在 `capabilityGate.ts` 新增 `validateChannelConfig()` 方法：启动时检查所有 Agent 的 capabilities.yaml 是否覆盖了所有支持的 channel
2. 在 `agentManager.ts` 的 Agent 加载流程中调用此校验
3. 缺失 channel 配置时打印 warn（不阻断启动）

### E2. 能力协议提取到 shared 包

**问题**：Daemon 和 Electron 各写一套消息类型定义，P0-2/P0-3 的根因。

**方案**：把 IPC 消息类型和能力返回格式提到 `@perocore/shared`。

**改动**：

1. 新建 `packages/shared/src/types/capability.types.ts`：

   ```typescript
   /** Daemon → 节点消息 */
   export type DaemonToNodeMessage =
     | { type: 'tool_call'; callId: string; toolName: string; args: Record<string, unknown> }
     | { type: 'registered'; success: boolean; message?: string }

   /** 节点 → Daemon 消息 */
   export type NodeToDaemonMessage =
     | { type: 'register'; nodeId: string; nodeType: string; capabilities: string[]; url?: string }
     | { type: 'heartbeat'; nodeId: string }
     | { type: 'tool_result'; callId: string; result: unknown; success: boolean; errorMsg?: string }

   /** 截图能力返回格式（标准化） */
   export interface ScreenCaptureResult {
     success: boolean
     screenshots: Array<{ index: number; dataUri: string }>
     message: string
   }
   ```

2. 在 `packages/shared/src/types/index.ts` 中导出
3. `capabilityBridge.ts` 和 `capabilityProvider.ts` 改为 import 共享类型

### E3. CapabilityBridge WS 鉴权

**问题**：[capabilityBridge.ts](file:///c:/Users/Administrator/OneDrive/桌面/workspace/PeroCore-TS/packages/backend/src/capabilities/capabilityBridge.ts) 的 WS 服务端接受任何本地连接。

**方案**：复用 `PEROCORE_API_TOKEN` 机制。

**改动**：

1. 在 `capabilityBridge.ts` 的 `handleConnection()` 中：
   - 等待第一条消息，必须是 `{ type: 'auth', token: '...' }`
   - 验证 token 与 `process.env.PEROCORE_API_TOKEN` 一致
   - 验证通过后才允许 register，否则关闭连接
2. 在 `capabilityProvider.ts` 中：
   - 连接后立即发送 `{ type: 'auth', token: process.env.PERO_CAPABILITY_TOKEN }`
   - `PERO_CAPABILITY_TOKEN` 从 Electron 启动时由后端注入（或从 env 读取）
3. 在 `daemon/main.ts` 和 `backend/main.ts` 启动时：
   - 若 `PEROCORE_API_TOKEN` 未设置，打印 warn 提示开发环境无鉴权
   - 生产环境必须设置

**注意**：开发环境无 token 时不阻断功能（兼容现有开发流程）。

### E4. 代码小瑕疵修复

**改动**：

1. `capabilityBridge.ts:228` 删除无意义的 `void resolve`
2. `capabilityBridge.ts:321` 在 `invokeTool` 中正确计算 `durationMs` 并透传
3. `electron/main/index.ts:11` 更新头部注释（删除"启动后端子进程"）

### E5. 修复 CapabilityRegistry 注销语义不一致

**问题**：`capabilityRegistry.ts` 的 `unregister()` 调用 `repo.delete(nodeId)` 物理删除节点记录，但 `markStaleOffline()` 只标记 `status='offline'`。两种离线路径语义不一致：

- 主动断连 → 物理删除（重连后历史丢失，nodeId 重新生成）
- 心跳超时 → 标记 offline（重连后可恢复，nodeId 保持）

**方案**：统一为"标记 offline"，保留节点历史记录。

**改动**：

1. 修改 `capabilityRegistry.ts` 的 `unregister()`：
   - 改为调用 `repo.markOffline(nodeId)` 而非 `repo.delete(nodeId)`
   - 保留节点记录，便于重连时复用 nodeId 和历史能力配置
2. 物理删除仅在手动清理（如管理 API 显式删除）时使用
3. 新增 `cleanupStaleNodes(daysOld: number)` 方法：清理超过 N 天未活跃的节点（可选）

**验证**：

- 节点断连后查询 `findOnline()` → 不包含该节点
- 节点断连后查询 `findById(nodeId)` → 仍存在，status=offline
- 节点重连后 `upsert()` → status 恢复 online，nodeId 保持不变

---

## 7. 批次 F：技术债清理

### F1. 清理 .bak 文件

**清单**：21 个 `.bak` 文件（backend 19 + frontend 2 + electron 1）

**改动**：

1. 用 `git log` 确认每个 .bak 的原始文件已稳定（无未迁移的改动）
2. 逐个删除（用户偏好保留备份，但这些是重构完成后的残留，应清理）
3. 若用户要求保留，移到 `.archive/` 目录统一存放

**注意**：删除前用 `git diff` 对比 .bak 和当前文件，确认无未迁移的逻辑。

### F2. 清理 work 模式残留

**清单**：5 处残留

- `packages/shared/src/types/memory.types.ts`
- `packages/shared/src/types/extension.types.ts`
- `packages/backend/src/schemas/memory.schema.ts`
- `packages/backend/src/services/mdp/agents/pero/agent.json`
- `packages/backend/src/services/agent/reactLoop.ts`（MODE_MAX_TURNS）

**改动**：

1. 评估每处 `work` 的实际用途：
   - 若是历史遗留且无消费者 → 删除
   - 若仍有逻辑依赖 → 保留并标注"待社交子 Agent 应用迁移"
2. `reactLoop.ts` 的 `MODE_MAX_TURNS` 中 `work: 30` 可保留（向后兼容，未来可删）
3. 类型定义中的 `'work'` 字面量可保留（类型联合，不影响运行时）

**决策标准**：删除只影响类型而不影响运行的，可以删；会影响运行的，保留并加注释。

### F3. 其他小项

- `container.ts:1216` TODO：陪伴模式日记功能（评估是否第一版必要，不必要则保留 TODO）
- `socialScheduler.ts:319-322` TODO：人设注入 agent_name 填的是 channelId（修正为 agentId 或 agent.name）
- `useAgentStore.ts:48` TODO：在 C2 中已处理

---

## 8. 修复后的验证清单

### 8.1 功能验证

- [ ] `pnpm start` 后 CapabilityBridge :9121 启动
- [ ] Electron CapabilityProvider 注册成功
- [ ] LLM 调 `take_screenshot` → 收到正确格式截图 → 多模态模型看到图片
- [ ] 社交消息场景使用 social channel（2轮而非30轮）
- [ ] 社交场景不能调用 terminal_execute
- [ ] Nana 的工具权限与 Pero 不同
- [ ] 前端切换 Agent 调用 runtimeApi.setWindowAgent
- [ ] 入站路由的 channel/threadId 被使用

### 8.2 安全验证

- [ ] 未配置的 channel 调用工具 → 被拒绝（fail-closed）
- [ ] 平台工具也受 CapabilityGate 约束
- [ ] CapabilityBridge WS 需要 token 鉴权（生产环境）
- [ ] 不同 Agent 的工具权限完全隔离
- [ ] 节点断连后重连，nodeId 保持不变（注销语义统一）

### 8.3 测试验证

- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm test:run` 全绿（447+ 通过，含新增测试）
- [ ] 无新增的 `.bak` 文件

### 8.4 文档验证

- [ ] `electron/main/index.ts` 头部注释准确
- [ ] `.docs/archived/11-remediation-plan.md` 标记完成项
- [ ] `project_memory.md` 更新 lessons learned

---

## 9. 风险与回滚

### 9.1 高风险改动

| 改动                   | 风险                         | 缓解                                     |
| ---------------------- | ---------------------------- | ---------------------------------------- |
| B1 删除 defaultContext | 影响 ToolExecutor 所有调用方 | 分两步：先加 agentId 参数+兜底，再删兜底 |
| B3 fail-closed         | 社交场景可能短暂无工具       | 与 B4 同时发布                           |
| B5 平台工具路由后移    | 截图可能在配置错误时被拒     | 确保 B4 白名单包含 take_screenshot       |
| D2 社交接入 Thread     | 影响现有社交消息流           | 拆为 D2a/D2b，先透传再自动创建           |

### 9.2 回滚策略

- 每个批次独立提交，可单独 revert
- 高风险改动保留 `.bak` 备份
- B1 的兜底逻辑（`?? 'pero'`）最后删除，留作应急回滚点

---

## 10. 不在本计划范围内

以下项明确排除（属于后续版本或独立工作）：

- 分布式多节点能力注册（第二版）
- 跨节点工具调用（第二版）
- ToolProviderPolicy 完整实现（allowedAgents/requiresApproval/rateLimit）
- AgentApplication / SubAgent
- 社交子 Agent 应用剥离
- 形态3（连接远程 Daemon）的网络配置 UI
- mobile 节点支持

这些项在 `00-overview.md` 和 `10-node-architecture.md` 中有明确标注"暂不实现"或"后续版本"。

---

## 11. 完成标准

本计划完成的标志：

1. **所有 P0/P1 Bug 已修复并有测试覆盖**
2. **`pnpm start` → Electron 注册能力 → 截图可用**（端到端验证）
3. **社交场景工具集受限**（security 验证）
4. **`pnpm test:run` 全绿**
5. **无阻断性的 .bak 残留或 work 模式残留**

满足以上五点，第七阶段才算真正"可用"，可以进入日常使用和后续版本规划。
