# 多节点交付与同步闭环行动计划

> **状态**：P0-P8 本地实现与模拟验收已完成；P9 核心链路已实现并通过本地类型检查与专项测试，真实公网 WSS/TLS、Steamworks 与超大数据集仍待发布环境黑盒验收
> **创建日期**：2026-08-28
> **最近验收**：2026-08-28
> **适用范围**：Docker 交付、Client Node、Capability Node、Gateway 同步、Input Seat、审批/求助、通知/Toast、TTS、跨 Server 手动全量同步
> **上位规范**：[A04_DEPLOYMENT](../A04_DEPLOYMENT.md)、[A08_DEVOPS](../A08_DEVOPS.md)、[A09_AIOS_ARCHITECTURE](../A09_AIOS_ARCHITECTURE.md)、[A10_INFOS_OS_EVOLUTION_PLAN](./A10_INFOS_OS_EVOLUTION_PLAN.md)

---

## 1. 目标与阶段边界

近期目标不是实现多 Server 实时 Federation 或任意多主同步，而是先交付以下生产闭环：

```text
1 个 Control Authority Server
├─ N 个 Electron / Web / 其他 Client Node
├─ N 个 Input Seat
└─ N 个 Capability / Compute Node
```

完成后必须支持：

- Docker Server 长时间运行并持有 Agent、Thread、Task、Memory、Workspace 和 Policy 权威；
- Electron、浏览器及其他客户端按稳定 Node Identity 连接远程 Server；
- 多客户端同步消息、Surface、后台任务状态、审批、Agent 求助和重要通知；
- 同一审批或求助只由后端权威状态机决策一次，不设置业务超时；
- Electron 可在远程模式下向 Server 发布桌面、浏览器、文件选择、音频输出等能力；
- TTS 生成与播放分离，音频只投递到选定 Audio Output Node；
- Client 或 Capability Node 断线、重连后恢复身份、订阅、Projection 与等待态；
- 所有在线写入仍由当前连接 Server 本地提交；跨 Server 只通过用户主动触发的完整快照覆写同步。

客户端产品边界：

- Electron 标准版、Steam 版和便携版客户端默认且强制绑定同设备内置 Daemon，只访问 `localhost`，不提供切换远程 Server 的入口；
- 浏览器、CLI、移动端或未来明确标记为“远程纯客户端”的形态，才允许在“分布式”Tab 输入地址与鉴权密码、连接并保存“我的服务器”；
- Electron/Steam 可以在“分布式”Tab 管理远程服务器和发起手动同步，但其业务入口仍是本机 Daemon；
- 每台 Server 独立运行，切换远程纯客户端的入口不会触发自动同步。

P9 不再实施实时多 Authority Federation、跨 Server Replica 或自动 Command Route。跨 Server 能力收敛为用户主动执行的“从此服务器上同步最新数据”。

---

## 2. 不可违反的约束

1. 不共享写入 SQLite、TriviumDB，也不复制运行中的数据库文件、WAL 或 SHM；
2. 手动同步以用户选中的来源 Server 为唯一真值，完整覆写当前 Server 的全部用户数据，不做双向合并、按资源选择或“最新时间戳胜出”；
3. Gateway Connection ID、浏览器 Tab ID 和 Electron Window ID 都不是 Node Identity；
4. 用户在某客户端操作不意味着该客户端拥有 Server 权限；
5. Input Seat Lease 到期只撤销当前操作席位，不得使审批或 Agent 求助过期；
6. `terminal_execute.timeout`、`terminal_wait.timeout_ms` 只表示 Agent 主动等待终端多久后查看状态，不得扩散为工具或审批全局超时；
7. Durable Event 必须可恢复；Ephemeral Frame 可以丢弃、合并和降频；
8. 跨 Node 只传 Object Ref、Asset Ref、Handle、Transfer Ref 或有界数据流，不传可供远端直接访问的本地绝对路径；
9. TTS 不得向所有 Gateway 连接广播并让所有客户端同时播放；
10. 不允许多 Server 实时共同写入、自动互相追平或任意 Server 代替另一 Server 接受写入；
11. 手动同步前必须自动生成当前 Server 的完整回滚快照，导入必须在隔离区校验并原子切换；
12. Server Node Identity、私钥、证书、Trust Session、Client/Capability Node ID、临时 Lease/Seat、锁文件、缓存和日志属于机器身份，不得被来源快照覆盖。

---

## 3. 当前基线与主要缺口

### 3.1 已有基础

- Electron Capability Provider、Node Hello、Offer、心跳和自动重连；
- Backend Capability Bridge 与独立能力端口；
- Node SDK / Node Host、Loopback WebSocket、Pairing 与证书探针；
- Gateway WS、SSE、Conversation/Task Surface Projection；
- SQLite Durable Outbox、重试、Dead Letter 与进程内 Kernel Event；
- 审批与 Agent 求助持久状态机；
- Dockerfile、Compose、Nginx 和 Tag Release Docker Job 骨架。

### 3.2 生产缺口

- Dockerfile 仍有历史包名、环境变量和数据文件名漂移；
- 普通 CI 不执行 Docker Build 与容器黑盒启动测试；
- Client Gateway 连接没有稳定 Node Session、订阅游标和定向 Audience；
- Gateway 广播尚未严格区分 Durable Event 与 Ephemeral Frame；
- 重连主要依赖重新 GET Projection，没有统一 Sequence/Cursor 恢复协议；
- 审批与求助没有正式 Input Seat 归属；
- Toast 缺少去重 ID、Audience 和投递策略；
- TTS `audio_chunk` 仍是无差别广播；
- 缺少“分布式”Tab、我的服务器列表与远程纯客户端入口选择；
- 缺少 Server 生成配对邀请、Capability Node 主动出站直连 Server 的完整配置入口；
- 缺少跨 Server 完整快照导出、传输、预检、回滚和原子覆写；
- Steam Cloud 现有文件级自动同步语义必须收敛为手动完整快照；
- 公网 Server/Capability Transport 的真实 TLS、证书链和 NAT 环境尚未黑盒验收。

---

## 4. 目标运行拓扑

```text
                           ┌──────────────────────────┐
                           │ Control Authority Server │
                           │ Docker / Native Daemon   │
                           │                          │
                           │ Domain DB + Outbox       │
                           │ Projection + Gateway     │
                           │ Node/Seat/Capability Dir │
                           └───────┬─────────┬────────┘
                                   │         │
                    Control/Surface│         │Provider Session
                                   │         │
                ┌──────────────────┘         └──────────────────┐
                ▼                                               ▼
      ┌───────────────────┐                           ┌───────────────────┐
      │ Electron Client A │                           │ Capability Node C │
      │ Input Seat        │                           │ ComfyUI / TTS Gen │
      │ Browser/File/Audio│                           │ GPU / STT / OCR   │
      └───────────────────┘                           └───────────────────┘
                ▲
                │ Control/Surface
      ┌─────────┴─────────┐
      │ Web/Mobile Client B│
      │ 可选 Input Seat    │
      └────────────────────┘
```

每个 Client Node 可同时拥有多个 Facet：

```text
client        接收业务状态与Surface
input-seat    提交用户决策和输入
capability    发布文件、桌面、浏览器、音频输出等能力
device        提供平台身份和设备状态
```

---

## 5. 协议收敛

### 5.1 Node 与 Session

需要统一：

```typescript
interface NodeDescriptor {
  nodeId: string
  facets: Array<'server' | 'client' | 'capability' | 'compute' | 'device'>
  platform: string
  protocolVersion: string
  displayName?: string
}

interface NodeSession {
  sessionId: string
  nodeId: string
  connectionId: string
  generation: number
  connectedAt: string
  lastSeenAt: string
}
```

- `nodeId` 持久稳定；
- `sessionId` 每次重连更新；
- `generation` 防止旧连接继续提交；
- Connection 仅作为 Carrier，不进入领域对象身份。

### 5.2 统一 Envelope

业务 Gateway、SSE 与 Capability Transport 共享以下核心信封；手动全量同步使用独立快照包通道，不经过该信封：

```typescript
interface KernelEnvelope<T> {
  protocolVersion: string
  messageId: string
  correlationId?: string
  causationId?: string
  sourceNodeId: string
  targetNodeId?: string
  principalId?: string
  executionId?: string
  objectRef?: {
    type: string
    id: string
    generation?: number
  }
  sequence?: number
  durability: 'durable' | 'ephemeral'
  audience?: DeliveryAudience
  payload: T
}
```

### 5.3 Audience 与投递策略

```typescript
type DeliveryAudience =
  | { type: 'active_input_seat'; principalId: string }
  | { type: 'all_principal_clients'; principalId: string }
  | { type: 'specific_node'; nodeId: string }
  | { type: 'thread_subscribers'; threadId: string }
  | { type: 'execution_subscribers'; executionId: string }
```

所有 `broadcast()` 调用必须逐步迁移到显式 Audience；真正的全局广播只保留系统维护类事件。

---

## 6. Durable 与 Ephemeral 同步模型

### 6.1 Durable Fact

必须落库并可通过 Snapshot/Event 恢复：

- Thread Message 与 Message Revision；
- Tool 接受、完成、失败和拒绝；
- Approval Requested/Resolved；
- Agent Input Requested/Resolved；
- Task/Execution 状态转换；
- Application 生命周期；
- File/Asset/Checkpoint 提交；
- 重要 Notification；
- Authority/Generation 变更。

### 6.2 Ephemeral Frame

允许丢弃和降频：

- Token Delta；
- Thinking Delta；
- 瞬时进度；
- 普通 Toast；
- 音频播放帧；
- Presence、Heartbeat 和动画指令。

Ephemeral Frame 丢失后，客户端必须能通过 Durable Fact 或 Projection 收敛到正确终态。

### 6.3 Cursor 与重连

每个 Durable Stream 至少包含：

```text
streamId
sequence
snapshotRevision
retentionFloor
```

重连流程：

```text
Client 提交 lastSequence
├─ lastSequence >= retentionFloor → 补发事件
└─ lastSequence < retentionFloor  → 拉取 Snapshot，再从 Snapshot.sequence 续订
```

事件投递采用 At-least-once；消费方按 `messageId + streamId + sequence` 幂等。

---

## 7. Input Seat、审批与 Agent 求助

### 7.1 Input Seat

Input Seat 表示当前由哪个 Client Node 代表用户执行交互，不表示审批本身的生命周期：

```typescript
interface InputSeatLease {
  seatId: string
  principalId: string
  nodeId: string
  sessionGeneration: number
  acquiredAt: string
  lastActiveAt: string
  leaseUntil: string
}
```

Seat Lease 可续租、主动转移和断线失效。无有效 Seat 时，等待态继续存在。

### 7.2 审批

```text
创建 Durable Approval Request
→ 投影到 active_input_seat
→ 其他客户端按策略只读观察
→ Seat 提交 decision + requestRevision
→ Authority 原子 CAS pending → resolved
→ Durable Resolved Event
→ 所有订阅端移除卡片
→ 原 Execution 恢复
```

审批没有 TTL、`expired` 状态或自动通过。仅用户决定、Execution 取消、Session 清理、服务关闭或重启恢复策略可以结束等待。

### 7.3 Agent 求助

`ask_user` 与审批使用相同 Seat 和恢复原则：

- 用户未回答时，当前 Tool Call 和 ReAct 永久挂起；
- Seat 转移不结束问题；
- 回答写入 Durable Request 后，才向原 ReAct 注入 Tool Result；
- 同一请求只允许一次终态转换。

---

## 8. 消息、Surface、Toast 与通知

### 8.1 消息和 Surface

- Message 是 Durable Authority Fact；
- Surface 是可重建 Projection；
- 流式 Frame 只更新临时尾部；
- Message Commit 后由 Durable Event 替换临时尾部；
- 多 Client 通过 Thread Subscription 接收相同 Projection Revision；
- 编辑、重试和删除必须提升 Message/Surface Revision。

### 8.2 Toast 分级

```text
本地反馈 Toast
  保存成功、复制成功、表单校验
  → 仅当前客户端内存展示

Ephemeral Remote Toast
  在线任务提示、临时提醒
  → 带 notificationId、audience、dedupeKey

Durable Notification
  审批到达、后台任务失败、重要主动通知
  → 先持久化，再投影为通知中心条目与Toast
```

字段要求：

```typescript
interface NotificationDelivery {
  notificationId: string
  level: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  audience: DeliveryAudience
  dedupeKey?: string
  deliveryPolicy: 'active-seat' | 'all-clients' | 'specific-node' | 'notification-center'
  createdAt: string
}
```

---

## 9. TTS 与音频输出

目标链路：

```text
Agent Reply Commit
→ TTS Generation Placement
→ Audio Asset
→ 选择 Audio Output Offer
→ 创建 Playback Invocation
→ 目标 Client 拉取/流式接收 Asset
→ Playback Progress / Completed / Cancelled Receipt
```

拆分能力：

```text
audio.tts.generate   文本生成音频Asset
audio.output.play    播放指定Audio Asset
audio.output.stop    停止指定Playback
audio.output.status  查询播放状态
```

迁移要求：

1. 为音频建立 Asset ID、MIME、时长、Checksum 和可读取 Handle；
2. Electron 发布 `audio.output` Offer；
3. Placement 优先 active Input Seat 所在 Node；
4. Web Client 仅在浏览器允许播放时发布 Offer；
5. 删除全 Gateway `audio_chunk` 广播；
6. 支持取消、抢占、队列和音量参数；
7. 音频二进制优先走 Asset/Transfer Plane，不长期塞入 JSON Base64。

### 9.1 P0 安全与凭据存储边界

| 凭据/身份 | 权威与存储边界 | 禁止事项 |
|---|---|---|
| Node Identity 私钥 | Node 本地生成；Server/Node Host 使用仅运行用户可读的持久文件，Electron 使用 OS 安全存储 | 不进入浏览器 LocalStorage、日志、Gateway Payload 或镜像层 |
| Pairing Code | Authority 内存中的一次性短期 Challenge，仅保存 Hash；消费后立即失效 | 不持久化明文、不复用、不作为长期 Token |
| Node Certificate | Authority 签发；Node 本地持久化；Authority Trust Store 保存证书、指纹、Trust Epoch 和撤销状态 | 不跳过过期、指纹、Epoch 和撤销校验 |
| Gateway Access Token | Server Secret/环境注入；浏览器仅持有短期 Session Token，Electron 由主进程安全存储并向 Renderer 提供受限会话 | 不写入仓库、URL、前端构建产物或业务事件 |
| Session Generation | Authority 持久递增；每次重连签发新 Generation | Connection ID 不得充当 Node ID；旧 Generation 不得提交命令或续租 Seat |

生产远程 Node 必须使用 TLS/WSS，并同时通过 Transport 证书链、Node Certificate、Trust Epoch 与 Session Generation 校验。浏览器节点不能持有可导出的长期 Node 私钥；其身份由短期会话绑定到已认证 Principal。

### 9.2 P0 数据库迁移基线

后续数据库变更按追加迁移实施，不允许运行时隐式建表或多 Authority 共享 SQLite 写入。首批逻辑表冻结为：

| 逻辑表 | 主键/唯一约束 | 必要字段 |
|---|---|---|
| `node_sessions` | `session_id`；`node_id + generation` 唯一 | connection_id、carrier、connected_at、last_seen_at、lease_until、health |
| `subscription_cursors` | `stream_id + consumer_id` | sequence、updated_at |
| `input_seat_leases` | `seat_id`；每 Principal 最多一个有效租约 | node_id、session_generation、acquired_at、last_active_at、lease_until |
| `durable_notifications` | `notification_id` | principal_id、audience、revision、status、created_at、resolved_at |

每次迁移必须记录 Migration Version，升级前备份数据库，并验证旧镜像是否兼容当前 Schema；回滚代码不等于回滚数据库。

---

## 10. Docker 与 CI/CD 行动

### D1 Dockerfile 校准

- 将历史 `@perocore/*` 全部改为 `@infos/*`；
- 将历史 `PEROCORE_*` 与旧数据文件名改为当前配置；
- 统一 Node.js 版本与 pnpm 版本；
- 验证 `better-sqlite3`、TriviumDB Native Addon 和生产依赖；
- 使用非 root 用户运行；
- 明确 `/app/data`、`/app/workspaces` 和只读资产目录；
- Backend Healthcheck 同时验证 HTTP、DB 初始化和迁移完成；
- Nginx 验证 API、SSE 与 WS Upgrade。

### D2 Compose 闭环

- 新增持久卷、网络、环境变量示例和健康依赖；
- 验证首次启动、重启、版本升级和数据保留；
- 验证纯 Web Client；
- 验证远程 Electron 连接 Docker Server；
- 验证关闭容器时审批/求助按生命周期规则清理。

### D3 CI 验证

普通 PR CI 增加：

```text
Docker Backend Build
Docker Frontend Build
Compose Up
Healthcheck
HTTP API Smoke
Gateway WS Smoke
SSE Smoke
Compose Down
```

Tag Release 增加：

- `linux/amd64` 与 `linux/arm64` Buildx；
- Backend/Frontend 成对版本 Tag；
- Commit SHA Tag；
- OCI Label、SBOM、Provenance；
- Registry 凭据缺失时明确标记 Docker 发布未执行；
- 推送后从 Registry 拉取并黑盒启动，而非只测试本地 Build Cache；
- GitHub Release 展示 Docker 镜像状态和 Digest。

### D4 升级与回滚

- 启动前数据库备份；
- Migration Version 与镜像版本记录；
- 禁止多个 Backend 实例同时挂载同一 SQLite 卷写入；
- 镜像回滚必须检查数据库格式兼容；
- 更换 Docker 宿主、域名或容器实例不等于数据迁移；跨 Server 数据迁移只能通过手动完整快照同步完成。

---

## 11. 分阶段施工清单

### Phase 0：文档与契约冻结

- [x] 冻结 NodeDescriptor、NodeSession、Envelope、Audience、Cursor、InputSeat 类型；
- [x] 建立 Durable/Ephemeral 事件目录；
- [x] 建立当前 Gateway Action 到新事件类型的映射表；
- [x] 明确安全、配对、Token 和证书存储边界；
- [x] 为后续数据库变更准备迁移策略。

验收：已通过 Shared/Backend/Frontend typecheck 与 12 项专项契约测试。`PushAction` 由带 Audience 的 Action Catalog 派生；现有裸 `broadcast()` 的运行时迁移仍按 Phase 3 执行。

### Phase 1：Docker 可交付基线

- [x] 完成 D1 Dockerfile 与 D2 Compose 基线校准；
- [x] 普通 CI 接入不依赖 Docker Engine 的静态模拟冒烟；
- [x] Tag Release 双镜像文件、名称与构建上下文静态校准；
- [x] 数据卷、工作区卷、健康依赖与重启策略已定义；
- [x] API、SSE、WS、Healthcheck 与非 root 运行规则通过模拟冒烟。

本轮验收：`pnpm docker:smoke` 通过，覆盖历史命名、Daemon Bundle、Native 依赖、端口、卷、健康检查、Nginx 路由和 Release 引用。按本地环境限制，未执行真实 Docker Build、Compose Up、Registry Push、多架构 Buildx、首次启动和数据保留黑盒测试；这些真实环境验收在可用 CI/Docker Host 上继续执行。

### Phase 2：Client Node 与远程连接

- [x] Gateway 握手接入稳定 Node Identity；
- [x] Session Generation 与重连替换；
- [x] Electron/Steam/便携版客户端入口固定为本机 Daemon，不设计远程 Daemon 切换 UI；
- [ ] 浏览器、CLI、移动端等远程纯客户端的“我的服务器”设置 UI；
- [x] 浏览器生成持久 Client Node ID；
- [x] Gateway Token fail-closed 与协议协商；TLS、Origin/CORS 生产策略延续 Phase 6；
- [ ] Client Presence 与独立诊断页。

本轮验收：模拟两个稳定 Client Node 重连，Node ID 保持不变，Connection/Session 更新且 Generation 从 1 递增到 2。真实 Electron×2、Browser×2 和 Docker Server 联调需远程环境验收。

### Phase 3：Subscription、Cursor 与 Projection 恢复

- [x] Thread、Execution、Notification Stream Subscription 基础协议；
- [x] Durable Stream Sequence；
- [x] Event Catch-up；
- [x] Retention Floor 与 Snapshot Fallback 信号；
- [x] 客户端 messageId 去重和 Cursor 单调推进；
- [x] Gateway Audience 定向发送 API；
- [ ] 将剩余业务裸 `broadcast()` 全部迁移（Surface/瞬时进度保留 Ephemeral 路径）。

本轮验收：内存 Durable Window 已验证补发、Retention Floor、Snapshot Required 与重复消息去重；Projection Snapshot 继续复用现有 HTTP Projection 接口。

### Phase 4：Input Seat 与远程审批/求助

- [x] Seat 获取、续租、释放、转移；
- [x] 审批和 AgentInput Audience；
- [x] active Seat 决策端与其他观察端区分；
- [x] Surface Generation 与审批状态机 CAS；
- [x] Seat 断线仅撤销 Seat，不结束 pending 请求；
- [x] 新 Seat 可接管并通过 Projection 恢复请求；
- [x] 旧 Session/Seat 决策 fail-closed。

本轮验收：审批和求助仍永久等待；Gateway 测试验证只向 active Seat 投递、断线撤销 Seat、稳定请求状态不随 Seat 结束。

### Phase 5：通知与 Toast 收敛

- [x] Durable Notification Repository 与 Authority 表；
- [x] 重要通知先持久化再投递 Durable Stream；
- [x] Toast Audience、notificationId Dedupe 和投递策略；
- [x] 多端 `unread/read + revision` 数据语义；
- [x] 远程通知按目标 Node/Seat 投递，非目标 Electron 不触发；
- [x] 本地反馈 Toast 不进入远程协议。

本轮验收：通知 Store 测试验证同一 notificationId 重连补发只展示一次；普通 Toast 仅投递 active Seat，重要通知投递 Principal 客户端并可恢复。

### Phase 6：Capability Node 生产化

- [x] 公网安全 Transport；
- [x] 持久 Node Trust 与 Certificate Repository；
- [x] Pairing、Rotation、Revocation；
- [x] Offer Lease、Health、Diagnostics；
- [x] Invocation Deadline、Cancellation、Idempotency 与 Receipt；
- [x] Electron 远程 Capability Provider；
- [x] Asset/Transfer Plane。

本轮本地验收：Node Host WSS、持久身份/Trust Store、一次性 Pairing、Certificate Epoch/Revocation、分块 Transfer，以及 Capability Bridge 的 Lease、Deadline、取消、幂等、断线在飞调用拒绝和 Diagnostics 均通过专项模拟。真实公网证书链、Docker Server 与多台物理 Electron 的黑盒联调仍属于发布环境验收。

### Phase 7：TTS 定向播放

- [x] `audio.tts.generate` Provider；
- [x] `audio.output` Provider；
- [x] Audio Asset 与 Transfer；
- [x] active Seat Placement；
- [x] 播放控制和 Receipt；
- [x] 删除无差别 `audio_chunk` 广播。

本轮本地验收：TTS 结果先注册为持久 Audio Asset，通过一次性、限次、MIME/大小受限的 Read Handle 拉取；Electron Gateway 与 Capability Provider 共享稳定 Node ID，只有 active Audio Output Seat 对应 Provider 收到播放，Seat 切换后的新播放迁移到新目标，旧播放先发送 stop 并等待 Renderer Completed/Cancelled Receipt。旧 `audio_chunk` 入口已 fail-closed。

### Phase 8：单 Authority 多端总验收

拓扑：

```text
Docker Authority Server
+ Electron Client A（Input Seat + Browser + Audio）
+ Web Client B（观察/候选Seat）
+ Capability Node C（Compute/TTS）
```

验证：

- [x] 消息流式与历史恢复；
- [x] Tool、Task、Approval、AgentInput 完整状态；
- [x] Toast 和重要通知定向；
- [x] TTS 生成、传输、播放和取消；
- [x] Client/Provider 断线重连；
- [x] 服务重启后的 Outbox、等待态和 Projection 恢复；
- [x] 网络重复、乱序、丢包与合法状态前缀；
- [x] 所有不可逆写入仍由 Authority 提交。

本轮本地总验收：建立单 Authority 综合模拟，覆盖 Electron/Web/Capability 多节点、Seat 转移、Approval/AgentInput 永久 pending、Cursor Catch-up/Snapshot、通知定向去重、Offer 上下线、TTS 目标输出、旧 Session/Generation fail-closed，以及 Authority 单写边界。Shared、Backend、Frontend、Electron 类型检查通过；11 个专项测试文件、54 项断言通过；`git diff --check` 通过。真实 Docker、多台物理 Electron/Browser、公网 WSS、进程重启与故障注入仍保留为发布环境黑盒验收，不在本地模拟结论中冒充完成。

### Phase 9：多 Server 手动全量同步

P9 产品目标不是实时 Federation，而是让普通用户用一个按钮，把所选来源 Server 的完整最新用户数据安全覆写到当前 Server。

#### 9.1 “分布式”Tab

```text
当前设备
├─ Electron/Steam/便携版：业务入口固定为同设备本机 Daemon，不显示切换按钮
└─ 浏览器/远程纯客户端：可选择并切换“我的服务器”

我的服务器
├─ 输入 Server 地址/IP 与一次性鉴权密码
├─ 连接、校验证书并保存设备凭据
├─ 设为当前入口（仅远程纯客户端）
├─ 从此服务器上同步最新数据
└─ 配置能力节点

能力节点
└─ Server 生成配对邀请；Capability Node 主动建立出站 WSS 直连该 Server
```

鉴权密码只用于首次配对，不长期保存明文；配对成功后保存 Server ID、Endpoint、证书指纹和受限设备凭据。

#### 9.2 唯一同步操作

面向普通用户只提供：

```text
“从此服务器上同步最新数据”
```

其固定语义为：

```text
所选 Server = 唯一来源
当前 Server = 接收方
来源完整用户数据 = 同步后的最终状态
```

不提供按 Agent、Thread、资源或目录选择；不做双向合并、增量自动追平、时间戳最新者胜出或后台自动同步。

默认同步全部用户数据，包括但不限于：

- 全部数据库业务数据、Agent、Thread、Message、Memory、Task、Approval、AgentInput、Notification；
- 全部用户配置及经同步会话密钥安全重封装的 API Key、MCP Credential、TTS/ASR 凭据；
- 全部 Applications、插件、Skills、自定义 Prompt、模型和头像资源；
- 全部 Workspace 文件、附件、Asset、用户生成内容及各子应用独立 Store；
- Social、Arca 等应用数据和所有用户可写目录。

只自动排除机器自身身份与运行时瞬态：

- 当前 Server Node ID、私钥、证书和 Trust Session；
- Client/Capability Node ID、Session Generation、Lease、Input Seat 和临时 Handle；
- PID、锁文件、Socket、WAL/SHM、缓存、临时下载、日志和机器绝对路径映射；
- 随安装包提供的只读官方资源；Steam Workshop 文件由 Steam 重新解析订阅，但用户侧订阅/配置状态属于同步数据。

#### 9.3 一致性与安全流程

```text
1. 来源 Server 冻结快照视图
2. 使用 SQLite Backup/Checkpoint 与各 Store Snapshot 生成完整同步包
3. 生成 Manifest、Schema/App Version、文件清单和 Checksum
4. 当前 Server 下载到隔离区并完成路径、大小、签名、版本和摘要预检
5. 当前 Server 自动生成 pre-sync 完整回滚快照
6. 暂停业务写入与相关 Runtime
7. 原子切换数据库和全部用户可写目录
8. 以当前 Server 主密钥重封装凭据
9. 执行迁移、重建索引并重启 Runtime
10. 成功后保留同步审计；失败则恢复原状态
```

不得直接复制运行中的 SQLite、WAL、SHM 或 TriviumDB 内部活跃文件。同步失败不得留下“一半来源、一半本地”的混合状态。

#### 9.4 Electron、Steam 与公网边界

- Electron 标准版、Steam 版和便携版始终与同设备内置 Daemon 死绑定；即使保存了远程 Server，也只通过本机 Daemon 发起管理和同步请求；
- 普通 Electron 用户不需要公网 IP、端口映射、NAT 打洞或远程入口；本机离线时全部本地功能继续可用；
- 公网 Docker/Native Server 可以作为远程纯客户端入口和手动同步来源；服务发现以用户显式输入 Endpoint 为准，不扫描公网；
- Capability Node 主动出站直连指定 Server，因此通常不要求能力节点具有公网入站地址；首版一个 Capability Node 只绑定一个 Home Server；
- Steam Cloud 复用相同的完整同步包、预检、回滚和原子覆写流程，只在用户点击“从 Steam Cloud 同步最新数据”时执行，不承担实时同步、分布式锁或 Authority Fence。

#### 9.5 验收

- [x] Electron/Steam/便携版不存在切换业务 Server 的入口，始终访问本机 Daemon；
- [x] 浏览器/远程纯客户端可添加、保存、连接和切换“我的服务器”；
- [x] Capability Node 可通过一次性邀请主动出站直连指定 Server，首次配对后签发并持久保存独立设备 Token；
- [x] 点击一次按钮即可完整同步 `dataDir` 内数据库、插件、Skills、Workspace、Asset、凭据和子应用数据；
- [x] 来源数据完整覆写当前用户数据，机器身份保持当前设备不变；
- [x] 同步前自动备份，校验或原子切换失败可恢复原状态，并支持用户暂存“撤销上次同步”；
- [x] Steam Cloud 与 Server-to-Server 使用同一完整快照导入/导出语义；
- [x] 不存在后台自动同步、对象级选择、实时跨 Server 路由或隐式多主写入。

本轮本地验收：Shared、Backend、Frontend、Electron 类型检查全部通过；完整快照/机器身份保留/重启边界原子应用/撤销专项 2 项测试通过；Capability 与 Shared 回归 10 个测试文件、52 项断言通过；Frontend Transport 7 项断言通过；`git diff --check` 通过。分布式 Tab 已使用现有像素组件、像素标题字体和主题变量完成浅色/深色适配。

发布环境保留项：真实公网 WSS/TLS 终止与证书指纹、Steamworks 双设备 Cloud、Windows 超大 Workspace/Asset 压力和进程级故障注入尚未在本机环境冒充验收；显式配置到 `dataDir` 外的 `PERO_PACKAGES_DIR` 属于外置部署数据边界，发布前需配置回 `dataDir` 或提供独立挂载备份策略。当前同步包具有文件数、单文件和总量预检，但序列化仍为加密 JSON/Base64 聚合格式，超大数据集需在发布压力验收后再决定是否升级为流式归档。

---

## 12. 测试矩阵

| 场景 | 必测内容 |
| --- | --- |
| Docker | 首启、迁移、健康检查、重启、升级、回滚、卷权限 |
| 多 Client | 同步、定向 Audience、重连、重复事件、Projection Revision |
| Input Seat | 获取、转移、断线、竞争决策、永久等待 |
| Capability | Offer Lease、Placement、取消、Deadline、幂等、Receipt |
| Notification | 本地Toast、远程Toast、持久通知、去重、已读 |
| TTS | 定向播放、取消、队列、Asset校验、目标离线 |
| Outbox | 崩溃恢复、重试、Dead Letter、顺序、幂等消费 |
| 手动全量同步 | 完整快照、全部用户目录、凭据重封装、校验、原子覆写、失败回滚、机器身份保留 |
| 安全 | TLS、配对码重放、证书撤销、旧Session、越权Audience、同步包路径穿越与篡改 |

故障注入至少覆盖：

```text
WS 半开连接
Gateway 与 Capability Session 分别断线
Server 在领域提交后、事件发送前崩溃
Client 收到事件后、ACK 前崩溃
Provider 执行中断线
重复 Invocation
旧 Session Generation 回包
Seat 持有者断线
音频播放目标离线
同步包下载中断
同步包摘要不匹配
当前 Server 在备份完成后、原子切换前崩溃
当前 Server 在原子切换后、Runtime 重启前崩溃
来源与当前 Server Schema/App Version 不兼容
凭据重封装失败
```

---

## 13. 可观测性与运维

必须提供：

- Node/Session/Facet/Offer/Lease 状态页；
- Input Seat 当前归属和转移记录；
- Gateway Subscription、Cursor Lag 和 Snapshot 次数；
- Outbox Pending/Retry/Dead Letter；
- Capability Invocation 时延、取消和错误码；
- Notification 投递与去重记录；
- Audio Asset、Playback 和目标 Node；
- 手动同步源/目标、快照版本、阶段、校验结果、回滚状态与传输进度；
- Docker 镜像版本、Commit SHA、Schema Version 和健康状态。

日志必须携带：

```text
messageId / correlationId / causationId
nodeId / sessionId / generation
principalId / executionId
objectRef / authorityNodeId / authorityEpoch
streamId / sequence
```

---

## 14. 删除旧机制的条件

只有替代链路通过验收后才能删除旧机制：

| 旧机制 | 删除条件 |
| --- | --- |
| Gateway 裸全局广播 | 所有业务 Action 已声明 Audience |
| 重连后只做全量 GET | Cursor Catch-up 与 Snapshot Fallback 稳定 |
| 审批/求助广播给所有客户端操作 | Input Seat 与只读观察端接线完成 |
| 内存任务 Toast | Notification 分级和去重完成 |
| `audio_chunk` 全连接广播 | Audio Asset + Output Provider 完成 |
| 本机专用 Capability 假设 | 远程 Node Transport 与 Trust 完成 |
| 进程内 Outbox 消费边界 | 保持单 Server 内部消费；P9 不实施实时跨 Server Event Federation |

迁移期间允许 Adapter 双读或双投影，但不允许多台 Server 同时写同一份用户数据。

---

## 15. 完成定义

本计划完成的最低标准：

1. Docker 镜像可重复构建、自动发布、可启动、可升级并保留数据；
2. Electron/Steam/便携版客户端稳定绑定同设备本机 Daemon；浏览器、CLI、移动端可作为远程纯客户端连接用户选择的 Server；
3. 消息、任务、Surface、审批、求助和重要通知可在多客户端间恢复一致；
4. 审批与求助没有时间超时，Seat 变化不会结束等待；
5. Toast 和 TTS 不再无差别广播；
6. Electron 桌面能力可作为远程 Capability Offer 被安全调用；
7. 单 Authority Server + N Client + N Capability Node 通过故障注入验收；
8. 多 Server 之间不共享数据库、不做实时多主；用户可通过唯一的手动全量同步按钮安全覆写全部用户数据，并保留当前机器身份与完整回滚能力。
