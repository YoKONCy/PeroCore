# 后端生产力工具与安全执行运行时设计

> 状态：第一期实施基线
> 范围：Backend / Daemon，不包含前端审批与终端 UI
> 目标：在保留现有 ReAct、ToolRegistry 和 CapabilityGate 的前提下，建立可扩展的执行会话、沙箱、终端与文件工具底座。

## 1. 设计原则

1. **Channel 与 Sandbox 正交**：Channel 选择业务权限策略；Sandbox 负责不可绕过的执行边界。
2. **所有副作用进入执行运行时**：终端、文件写入、编辑、删除和外部进程不得直接在 Tool handler 中操作主机。
3. **结构化结果**：工具错误不能再伪装为普通字符串；结果必须携带成功状态、错误码、截断信息和元数据。
4. **可取消**：AbortSignal 必须贯穿 ReAct、ToolExecutor、进程和长时工具。
5. **句柄化长任务**：长时命令返回 Terminal ID，不阻塞单次 ReAct 工具调用。
6. **安全写入**：编辑采用内容/哈希保护，写入采用同目录临时文件与原子替换。
7. **渐进式强隔离**：先实现跨平台 LocalPolicyRunner，再接入 Windows Restricted Token/Job Object、Linux bubblewrap、macOS Seatbelt 与容器 Runner。

## 2. 总体架构

```text
Conversation / BackgroundTask
        ↓
      ReActLoop
        ↓
  RegistryToolExecutor
        ↓
 CapabilityGate + PolicyEngine
        ↓
    ExecutionService
   ┌──────┴────────┐
SandboxManager   ExecutionSession
   │                ├─ VirtualWorkspace
   │                ├─ TerminalManager
   │                ├─ artifacts
   │                └─ lifecycle
   └─ SandboxRunner
      ├─ LocalPolicyRunner（第一期）
      ├─ WindowsRestrictedRunner（后续）
      ├─ BubblewrapRunner（后续）
      ├─ SeatbeltRunner（后续）
      └─ ContainerRunner（后续）
```

## 3. 领域模型

### 3.1 ExecutionSession

执行会话是副作用资源的归属单位。

```ts
interface ExecutionSession {
  id: string
  ownerAgentId: string
  threadId?: string
  taskId?: string
  channel: string
  workspaceRoot: string
  sandboxProfile: SandboxProfile
  state: 'active' | 'closing' | 'closed'
  createdAt: string
  lastActiveAt: string
}
```

生命周期规则：

- 普通对话默认按 Thread 复用执行会话。
- BackgroundTask 按 Task 创建执行会话。
- Task 完成、失败或取消时关闭其终端并释放临时资源。
- 执行会话只能被所属 Agent/Thread/Task 操作。

### 3.2 SandboxProfile

```ts
type SandboxProfileName =
  | 'read-only'
  | 'workspace-write'
  | 'task-isolated'
  | 'full-access'

interface SandboxProfile {
  name: SandboxProfileName
  readableRoots: string[]
  writableRoots: string[]
  protectedPaths: string[]
  network: 'deny' | 'allow'
  inheritEnv: string[]
  maxProcesses: number
  maxRuntimeMs: number
  maxOutputBytes: number
}
```

第一期 `LocalPolicyRunner` 提供策略检查、环境清理、进程管理和路径边界，但不宣称 OS 强隔离。后续 Runner 必须保持同一接口。

## 4. 统一工具结果

```ts
interface StructuredToolResult {
  ok: boolean
  output: string
  error?: {
    code: string
    message: string
    retryable?: boolean
  }
  truncated?: boolean
  metadata?: Record<string, unknown>
}
```

兼容策略：

- ToolRegistry handler 第一阶段允许返回 `string | StructuredToolResult`。
- ToolExecutor 统一归一化为现有 `ToolExecutionResult`。
- `ok=false` 必须映射为 `isError=true`，参与 ReAct 熔断。
- 旧工具逐步迁移，不一次性破坏全部 handler。

## 5. SandboxRunner

```ts
interface SandboxRunner {
  readonly kind: string
  createSession(session: ExecutionSession): Promise<void>
  spawn(session: ExecutionSession, spec: ProcessSpec): Promise<SandboxProcess>
  terminateProcess(processId: string, force?: boolean): Promise<void>
  disposeSession(sessionId: string): Promise<void>
}
```

第一期 `LocalPolicyRunner`：

- 使用 `spawn`，禁止通过字符串拼接调用搜索二进制。
- Shell 命令仅由终端工具显式启动。
- 环境变量采用白名单，不继承模型 Key、Daemon Token 等秘密。
- 支持 AbortSignal。
- 保存进程句柄，取消时终止进程。
- Windows 使用 `taskkill /T` 作为进程树清理降级方案；Unix 使用进程组信号。
- 输出使用环形缓冲，保留头尾与截断信息。

第一期不承诺：文件系统内核隔离、网络内核隔离、CPU/内存硬额度。

## 6. TerminalManager

终端是执行会话内的多实例资源，而不是一次性函数。

### 6.1 第一阶段工具

| 工具 | 功能 |
|---|---|
| `terminal_create` | 创建后台终端，立即返回 Terminal ID |
| `terminal_list` | 列出当前执行会话的终端 |
| `terminal_get` | 获取状态、命令、cwd、PID、退出码 |
| `terminal_read` | 使用 cursor/limit 读取增量输出 |
| `terminal_wait` | 等待退出、文本匹配或超时 |
| `terminal_write` | 向 stdin 写入文本（pipe 模式） |
| `terminal_interrupt` | 中断当前进程 |
| `terminal_kill` | 终止进程树 |
| `terminal_close` | 清理终端及缓冲 |

第一期使用 `child_process.spawn` + pipe，支持多个长时进程但不支持完整 TTY/TUI。第二期用 `node-pty` 替换底层，工具契约不变。

### 6.2 输出缓冲

- 每终端保存有界字符缓冲。
- `terminal_read` 返回 `cursor`、`nextCursor`、`hasMore`、`status`。
- 不把完整长日志塞入 ReAct 上下文。
- 终端退出时保留 exitCode、signal 和尾部输出。

## 7. VirtualWorkspace

### 7.1 文件读取

`read_file` 支持：

- `offset` / `limit`
- `line_start` / `line_end`
- `tail_lines`
- 文本/二进制识别
- 返回 encoding、EOL、总字节数、hash、截断状态

第一期只保证 UTF-8/BOM；编码探测组件后续接入。

### 7.2 搜索

- `glob_files`：第一期使用 Node 递归枚举 + 简化 Glob；后续接入 `fast-glob`。
- `code_search`：优先使用随应用打包或 PATH 中的 `rg`，通过 `spawn(binary, args, { shell:false })`；无 rg 时使用 Node 流式逐行 fallback。
- 统一支持全局 limit、include/exclude、固定字符串/正则、大小写和上下文行。

### 7.3 安全编辑

`edit_file`：

- 必须提供连续 `old_text` 与 `new_text`。
- `old_text` 必须唯一；否则拒绝并返回匹配数。
- 可选 `expected_hash`，用于防止并发覆盖。
- 写入使用同目录临时文件后 rename。
- 返回新 hash、修改行数和 unified diff 摘要。

第一期不做自动 fuzzy apply。

## 8. Channel 与策略映射

建议新增 `task` Channel，但它只是策略入口：

| 持久 Channel / 请求作用域 | 默认 Profile |
|---|---|
| desktop | workspace-write |
| task | task-isolated |
| ambient 请求作用域 | read-only；只在所属 Channel 权限上做减法 |
| social | read-only，无终端 |
| group | read-only，无终端 |

BackgroundTask 必须从 `desktop` 改为 `task`。`task` 执行会话使用：

```text
@data/agents/{agentId}/tasks/{taskId}/workspace
```

第一期若任务需要操作真实项目，应显式添加挂载根；不能因 cwd 存在就自动授权。

## 9. 权限与审批

后端第一期完成 PolicyEngine 接口和审批结果类型，但不实现前端交互。

```ts
type ApprovalDecision =
  | 'allow_once'
  | 'allow_session'
  | 'allow_always'
  | 'deny_once'
  | 'deny_always'
```

无前端阶段：

- Profile 内允许的低风险操作自动执行。
- 越界操作返回 `APPROVAL_REQUIRED`，不得静默放行。
- `full-access` 仅允许显式配置。

## 10. ReAct 与长任务

普通对话和 BackgroundTask 继续复用同一 ReActLoop。

短命令：

```text
terminal_execute → 等待退出 → 返回结果
```

长命令：

```text
terminal_create → 立即返回 terminalId
terminal_wait/read → 后续 ReAct 观察
terminal_kill/close → 生命周期管理
```

禁止让无限运行的服务器占住单次 Tool Call。

## 11. 实施顺序

### 第一期（本轮开发）

1. 统一结构化工具结果兼容层。
2. ExecutionSessionManager。
3. SandboxRunner 接口与 LocalPolicyRunner。
4. TerminalManager（pipe 多终端）。
5. 注册多终端工具。
6. VirtualWorkspace：范围读取、Glob、rg 安全调用/fallback、精确编辑、原子写。
7. AbortSignal 从 ReAct 贯穿 ToolExecutor 和执行运行时。
8. BackgroundTask 生命周期接入执行会话。
9. 单元测试和后端类型检查。

### 第二期

1. `node-pty` PTY backend。
2. ApprovalService + 前端交互。
3. Windows Restricted Token/Job Object。
4. Linux bubblewrap / macOS Seatbelt。
5. task 独立 Channel 与项目只读挂载。

### 第三期

1. 容器 Runner。
2. 网络代理和域名策略。
3. CPU/内存/磁盘额度。
4. LSP 与语义工具。
5. Checkpoint、artifact 和 diff apply workflow。

## 13. 实施状态

### 已完成：第一期基础运行时

- 结构化 ToolResult 兼容层。
- ExecutionSessionManager 与 Task 专属 workspace。
- SandboxRunner 接口及 LocalPolicyRunner。
- pipe 多终端及 9 个终端管理工具。
- 范围读取、Glob、hash guard 精确编辑和原子写。
- AbortSignal 贯穿 ReAct、ToolExecutor 与受管进程。
- BackgroundTask 结束时回收终端和执行会话。

### 已完成：第二期后端安全接线

- PolicyEngine：内容长度、命令白名单、禁止正则与高风险命令识别。
- ApprovalService：pending/approved/denied/expired/consumed 状态机。
- 支持 allow_once、allow_session、allow_always、deny_once、deny_always。
- ToolExecutor 在 Hook 修改后的最终参数上执行策略与审批。
- `/api/approvals` 查询和决策 API。
- Gateway `tool_approval_requested` 推送。
- `capabilities.yaml` 的 `param_policy` 与 `requires_approval` 可读写。
- `terminal_execute` 已迁移到 TerminalManager 受管短命令路径。
- `code_search` 已改为 `spawn(rg, args, shell=false)`，无 rg 时使用 Node 流式 fallback。
- Windows PowerShell UTF-8 输出与进程树回收。

- ApprovalService SQLite 持久化：审批请求、决策、一次消费、过期状态均可跨重启恢复。
- Append-only 审计日志记录 requested/resolved/consumed/expired/session_cleared。
- `/api/approvals/audit` 提供按 approvalId/sessionId 查询审计链。
- `allow_always` / `deny_always` 在 Daemon 重启后恢复，最后一次永久决策生效。
- node-pty 已作为可选原生终端后端接入：Windows ConPTY，Unix PTY；不可用时自动降级 pipe。
- 新增 `terminal_resize`，终端状态返回 backend/cols/rows。
- `@infos/auditor-wasm` 已接入 PolicyEngine，作为命令风险信号；当前实现仍是 TS 正则 fallback，不是安全边界。
- `@infos/nit-runtime` 已确认是 minGRU 检索排序/训练加速器，不属于沙箱或命令安全模块。

- 发行依赖收集器对 `node-pty` 保留 `.node`、`conpty.dll`、`OpenConsole.exe` 与 winpty 运行文件，其他依赖仍默认过滤非必要 DLL/EXE。
- `@vscode/ripgrep` 作为可选生产依赖，构建时只提取当前 `platform-arch` 的 rg 到 `resources/bin`。
- `code_search` 解析顺序：发行版内置 rg → 开发环境 `@vscode/ripgrep` → 系统 PATH → Node fallback。
- portable Daemon 注入 `INFOS_RESOURCES_ROOT`，避免单文件 bundle 无法定位 Electron resources。
- 依赖收集阶段和 Electron `afterPack` 阶段均强校验 node-pty 与 rg，缺失时中止发行构建，禁止静默降级。

### 尚未完成

- 审批前端交互；当前审批请求通过 API/Gateway 暴露，未审批时调用返回 `APPROVAL_REQUIRED`。
- node-pty 前端 xterm UI 与按键/resize 实时桥接。
- Windows Restricted Token/Job Object、Linux bubblewrap、macOS Seatbelt。
- 独立 `task` Channel；当前 taskId 已形成执行会话和目录隔离，但 Thread channel 仍沿用现有值。
- 随应用打包 rg；当前优先 PATH 中的 rg，并保证 Node fallback 可用。

## 14. 后续优先级

1. 讨论并决定是否新增独立 `task` Channel 与最小权限矩阵。
2. Windows Restricted Token/Job Object、Linux bubblewrap、macOS Seatbelt。
3. node-pty 前端 xterm UI 和实时终端事件桥接。
4. LSP 与语义代码工具。

## 16. 生产力前端实施状态

### 全局审批体验

- `useApprovalStore` 作为跨 Tab 单例，维护全局 pending 审批与决策状态。
- 共享 `ApprovalCard` 支持允许一次、本会话允许、拒绝与最长 2000 字的可选附言。
- 对话 Tab 将审批显示为消息流中的系统交互卡；工作区显示浮层卡；任务详情按 taskId 显示卡片。
- 主导航对话项显示全局 pending 数角标。
- `resolutionMessage` 已贯通 SQLite migration 0010、Repository、ApprovalService、HTTP API 与审计日志。
- `deny_once` / `deny_always` 附言会作为 `APPROVAL_DENIED.userMessage` 回传 Agent，提示其调整方案。

### Agent 工作区

- 工作台新增“工作区”独立 Tab，同时复用完整 `ChatContainer`、消息气泡和输入能力。
- 文件树强绑定当前 Agent 的 `@data/principals/{agentId}/workspace`，切换 Agent 时清空文件、终端和编辑上下文。
- 文件树单层懒加载，支持 workspace 内全文搜索。
- 文本编辑器支持多文件 Tab、脏状态、Ctrl+S、SHA-256 乐观锁和外部修改冲突提示。
- Workspace HTTP 写入统一经过 VirtualWorkspace 的 writableRoots、protectedPaths、二进制检查和原子写边界。
- 工作终端支持多 Tab、增量输出、stdin、中断、强杀与关闭，底层复用 TerminalManager/node-pty。
- 工作区聊天发送时注入当前打开文件和当前终端 ID，Agent 可据此使用生产力工具。

### 已修复的安全与一致性边界

- VirtualWorkspace 和 Terminal Runner 均校验 `realpath`，拒绝 workspace 内 symlink / Windows Junction 指向外部路径。
- ExecutionSession 复用键包含 Agent、Channel 和 Thread/Task，复用时再次校验 owner 与 workspaceRoot。
- 审批进入等待态：用户允许后原工具调用原地续行，拒绝/过期直接形成 Tool Observation；附言不会破坏 JSON 工具输出。
- 审批参数摘要采用递归脱敏，覆盖嵌套对象、数组、Authorization、Cookie 和循环引用。
- 截断文件仅允许只读预览，禁止将前 128K 内容覆盖完整文件。
- 终端输出采用绝对 cursor + bufferStartOffset，历史裁剪后增量流不会永久停滞。
- Workspace 搜索优先使用内置 ripgrep，缺失时再使用 Node fallback。

## 17. 验收标准

第一期完成后必须满足：

- 同一 Thread/Task 可拥有多个长时终端。
- 创建终端不会阻塞 ReAct。
- 可以增量读取、等待和终止终端。
- 取消信号可终止执行中的受管进程。
- 文件读取支持范围和 tail。
- 搜索不再通过 shell 字符串拼接。
- 编辑具有唯一匹配和 hash guard。
- 文件写入采用原子替换。
- 工具失败以 `isError=true` 返回。
- Backend typecheck 与相关单测通过。
