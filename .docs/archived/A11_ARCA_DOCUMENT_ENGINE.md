# Arca 自治创作工作站与 Document Engine 技术规范

> 归档状态：已于 2026-08-19 归档，作为 Arca/Document Engine 实现历史基线保留。  
> 状态：实现基线  
> 协议版本：1  
> 更新日期：2026-08-18
> 后续接入规范：三层Application Adapter与Arca迁移计划以 [../A11_APPLICATION_INTEGRATION.md](../A11_APPLICATION_INTEGRATION.md) 为准；本文只保留Document Engine领域与历史实现基线。

## 1.定位

Arca 是 infOS 首个自治式交互工作站应用，用于验证独立应用进程、独立对象权威、离线运行、Kernel 联邦、Agent 协作和多 Surface 投影的完整闭环。

Arca 是产品品牌；底层领域协议统一使用 `Document`、`Project`、`Operation`、`Revision`、`ChangeSet`、`Projection` 等中立名称。Document Engine 不依赖 Arca 品牌，也不依赖主聊天应用。

```text
infOS Kernel / Daemon
├─ Principal Agent
├─ Capability Directory
├─ Global Policy / Approval
├─ Node / Application Registry
└─ Object Ref / Event Projection
             │
             │ Application Federation Protocol
             ▼
Arca Application Process
├─ Application Host
├─ Project Authority
├─ Document Engine
├─ Revision Journal
├─ ChangeSet / Review
├─ Asset Store
├─ Projection / Import / Export
├─ Collaboration Agent Runtime
└─ Surface Endpoint
             │
             ▼
Arca Client Surface
├─ Project Navigator
├─ Semantic Editor
├─ Outline
├─ Review
├─ Agent Activity
├─ Asset Library
└─ Export Center
```

## 2.目标

1.文档运行时权威独立于 DOM、Markdown、单一客户端和主 Agent 生命周期。2.以语义 Document Graph 统一人类编辑、Agent 修改、导入、导出、审阅和协作。3.所有写入均通过带前置条件的语义 Operation 事务提交。4.使用 Append-only Operation Journal 形成 Revision，不以完整快照作为主要历史机制。5.所有 Actor 的候选修改统一使用 ChangeSet，不硬编码“Agent PR”。6.以 Policy 决定自动提交、领域审阅、人工审批或拒绝。7.客户端 Surface 崩溃或关闭时，Document Authority 和后台任务继续存在。8. Kernel 暂时离线时，应用可受限编辑并写入本地 Journal；重连后重新发布权威状态和事件。9.支持 Markdown 等文本格式作为可逆 Projection，但不将其提升为完整工程权威。10.形成可复用于 IDE、研究、图像和数据工作站的自治 Application Host 基线。

## 3.非目标

首个纵切片不实现：

-完整 CRDT 与无中心多主写入；-多人实时光标与在线 Presence；-复杂分页排版；
-DOCX/PPTX 二进制兼容；-可执行脚本块；-完整演示文稿编辑器；-全文检索与向量索引；-云端远程 Transport；-复制一套 Principal Agent、Memory 或全局 Policy；-把 Markdown、HTML 或 DOM 作为 Document Authority。

## 4.核心不变量

### 4.1单对象单 Authority

每个 Project 和 Document 在任一 Authority Epoch 内只有一个可写 Authority Node。Kernel 与客户端只持有 Ref、Snapshot、Cache 或 Replica Hint。

```text
DocumentAuthority = Application Node
Kernel            = Directory / Policy / Federation
Client Surface     = Projection / Input
Agent              = ChangeSet Producer
```

Authority 不可达时，远程写入 fail-closed。本地 Authority 进程离线于 Kernel 时可继续本地写入，但不得让 Kernel 或其他 Node 接管同一 Epoch 的写权限。

### 4.2 Document Graph 是运行时权威

```text
Document Graph    权威状态
Operation Journal 权威历史
Revision          提交结果
Snapshot          加速与恢复材料
Markdown          Projection
HTML              Projection
DOM               Surface Projection
PDF                Export Artifact
```

### 4.3写入只能通过事务

任何人类、Agent、Importer、Formatter 或 Migration 的修改都必须进入：

```text
ChangeSet / Direct Transaction
→ Schema Validation
→ Preconditions
→ Policy
→ Operation Apply Simulation
→ Commit
→ Revision
→ Receipt
→ Durable Event
```

不得直接修改持久化 Graph、Revision 或 Materialized Snapshot。

### 4.4稳定语义身份

每个节点拥有稳定 `nodeId`。位置变化使用 `parentId + orderKey` 表达，不通过重新生成节点身份表示移动。

### 4.5历史不可覆盖

Operation、Revision、Review 和 Receipt 一旦提交不可修改。状态纠正通过新事件或新 Revision 表达。

## 5.统一应用模型

### 5.1唯一的 Application 形态

infOS 只有一种通用 Application：以 Arca 为参考实现的自治 Application。应用拥有稳定身份和独立领域边界；是否包含 UI、是否常驻、是否跟随 Kernel 启停、是否使用 LLM、是否发布 Tool 或 Capability，均为应用内部设计选择，不构成新的应用类型。

```text
Application
├─稳定 Application Identity
├─独立 Application Host /领域逻辑
├─独立 State / Store / Authority（按需）
├─独立生命周期与故障边界
├─ provides Capability（按需）
├─ requires Capability（按需）
├─ Client / UI（按需）
├─ Agent Tool ABI（按需）
└─内部 Agent / Worker（按需）
```

`Tool`、`Capability Provider`、`Service`、`Client`、`Runtime Adapter` 和 `SubAgent` 都只能是 Application 的组成部分或接口，不是 Application 分类。无 UI 的 Research Worker、带 HUD 的 Minecraft Companion 和带独立 Client 的 Arca 在应用模型上完全同类。

Social 因人格投影、入站路由、主 Agent 记忆候选和历史实现而属于系统特例，不作为第三方应用模板，也不反向定义通用 Application ABI。旧 `AppManager/AgentAppRuntime` 仅保留 Social 兼容用途，不再扩展为第二套通用应用模型。

### 5.2 Kernel 关系

Application 不得 import Kernel 内部 Service、读取 Kernel 数据库或依赖主 Agent Thread。它通过 Node/Application Federation 与 Kernel 协作：发布 Capability Offer、申请 Capability Binding、接收 Handle，并上报 Event、Checkpoint 和 Receipt。

Arca 向 Kernel 申请 `model.inference` 或其他 LLM Capability 属于正常的显式能力依赖，不是代码耦合。Kernel 不得把原始 API Key、内部 Service 实例或主 Agent 私有状态下发给应用。

### 5.3生命周期策略

统一生命周期状态为：

```text
installed
→ starting
→ ready
⇄ disconnected_from_kernel
⇄ suspended
→ stopping
→ stopped
→ failed
```

`disconnected_from_kernel` 不等于应用失败。该状态允许本地文档操作，但暂停需要 Kernel Capability、Credential、主 Agent 或远程 Node 的功能。

### 5.4独立性边界

应用必须独立于：

-主聊天窗口；-主 Agent Execution；-单个 Client Surface；
-Backend 内存 Runtime Map；

- Kernel 的短时断线。

应用不独立于 infOS 协议和信任体系。连接 Kernel 时必须服从 Node Identity、Capability Handle、Policy、Approval 和 Resource Authority 约束。

## 6.品牌无关核心标识

```text
ProjectId
DocumentId
DocumentNodeId
OperationId
RevisionId
ChangeSetId
ReviewId
ReceiptId
SnapshotId
BlobId
AssetId
ApplicationInstanceId
```

标识必须为不可混用的 branded string。首期可使用 UUID，不允许从标题、路径或数组索引派生稳定身份。

## 7. Project 数据模型

```ts
interface CreativeProject {
  projectId: ProjectId
  generation: number
  authorityNodeId: KernelNodeId
  authorityEpoch: number
  ownerPrincipalId: string
  title: string
  description: string
  documentIds: DocumentId[]
  rootDocumentId?: DocumentId
  status: 'active' | 'archived' | 'deleted'
  createdAt: string
  updatedAt: string
}
```

Project 是工作单元与权限边界，不是文档节点。后续可扩展 Research Source、Bibliography、Glossary、Task Graph、Template 和 Export Profile。

## 8. Document 数据模型

### 8.1 Document

```ts
interface SemanticDocument {
  documentId: DocumentId
  projectId: ProjectId
  generation: number
  authorityNodeId: KernelNodeId
  authorityEpoch: number
  ownerPrincipalId: string
  title: string
  language: string
  kind: 'article'
  rootNodeId: DocumentNodeId
  headRevisionId: RevisionId
  status: 'active' | 'archived' | 'deleted'
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}
```

首期只支持 `article`，但协议保留可判别 `kind`，不能在节点模型中硬编码 Markdown。

### 8.2 Document Node

```ts
interface DocumentNode {
  nodeId: DocumentNodeId
  documentId: DocumentId
  type: DocumentNodeType
  parentId: DocumentNodeId | null
  orderKey: string
  generation: number
  text?: string
  attributes: Record<string, JsonValue>
  createdAt: string
  updatedAt: string
}
```

首期节点类型：

```text
document-root
section
heading
paragraph
list
list-item
quote
code-block
asset
```

约束：

1. `document-root` 只能有一个，且 `parentId = null`；2.其他节点必须属于同一 Document 的现存 Parent；3. Graph 必须为有根有序树，不允许环；4. `heading`、`paragraph`、`quote`、`code-block` 可有 `text`；5. `list-item` 必须位于 `list` 下；6. `asset` 通过属性引用 AssetRef，不保存绝对路径；7. `orderKey` 在同一 Parent 下唯一并按字典序确定顺序；8.删除父节点默认递归删除子树，必须在 Operation 中显式声明。

### 8.3 JSON Value

持久边界只允许：

```text
null / boolean / finite number / string / JsonValue[] / { [key]: JsonValue }
```

禁止函数、Date、Map、Set、Buffer、循环引用和进程对象进入 Graph。

## 9.语义 Operation

### 9.1公共信封

```ts
interface DocumentOperationBase {
  operationId: OperationId
  documentId: DocumentId
  actorPrincipalId: string
  baseRevisionId: RevisionId
  timestamp: string
  causationId?: string
  correlationId?: string
}
```

### 9.2首期操作

```text
node.insert
node.delete
node.move
text.replace
attribute.set
document.rename
```

#### node.insert

```ts
{
  type: 'node.insert'
  node: NewDocumentNode
  parentGeneration: number
}
```

#### node.delete

```ts
{
  type: 'node.delete'
  nodeId: DocumentNodeId
  expectedGeneration: number
  recursive: boolean
}
```

#### node.move

```ts
{
  type: 'node.move'
  nodeId: DocumentNodeId
  expectedGeneration: number
  newParentId: DocumentNodeId
  newOrderKey: string
  newParentGeneration: number
}
```

#### text.replace

```ts
{
  type: 'text.replace'
  nodeId: DocumentNodeId
  expectedGeneration: number
  value: string
}
```

#### attribute.set

```ts
{
  type: 'attribute.set'
  nodeId: DocumentNodeId
  expectedGeneration: number
  key: string
  value: JsonValue | undefined
}
```

`undefined` 表示删除属性；不能序列化为 JSON 的值在输入边界即拒绝。

#### document.rename

```ts
{
  type: 'document.rename'
  value: string
}
```

### 9.3操作不变量

-所有 Operation 必须携带 `baseRevisionId`；-针对节点的写入必须携带 `expectedGeneration`；-同一 Transaction 内 Operation 按数组顺序应用；-任一 Operation 失败时整个 Transaction 不提交；-`operationId` 在 Document 内唯一；-同一 `idempotencyKey` 的已提交事务返回原 Receipt；-不能删除 Root；-不能移动节点到自身或后代；-不能跨 Document 移动节点；-空事务不能生成 Revision。

## 10. Transaction 与 Revision

### 10.1 Transaction Request

```ts
interface DocumentTransactionRequest {
  transactionId: string
  documentId: DocumentId
  actorPrincipalId: string
  baseRevisionId: RevisionId
  operations: DocumentOperation[]
  intent: string
  idempotencyKey: string
  expectedEffects?: string[]
}
```

### 10.2 Revision

```ts
interface DocumentRevision {
  revisionId: RevisionId
  documentId: DocumentId
  sequence: number
  parentRevisionIds: RevisionId[]
  operationIds: OperationId[]
  actorPrincipalId: string
  intent: string
  rootHash: string
  committedAt: string
}
```

首期使用单 Authority 线性历史，`parentRevisionIds` 仅包含当前 Head。字段保留数组以支持未来显式 Merge Revision。

### 10.3 Root Hash

Root Hash 必须由规范化 Document 与节点稳定序列计算：

```text
SHA-256(
  protocolVersion
  + document metadata canonical JSON
  + nodes sorted by nodeId canonical JSON
)
```

Hash 不包含进程局部状态、缓存、选择区、Surface 状态和 `updatedAt` 等非语义抖动字段。

## 11. Operation Journal

Journal 是 Append-only 权威历史：

```ts
interface DocumentJournalEntry {
  sequence: number
  revision: DocumentRevision
  operations: DocumentOperation[]
  receipt: DocumentCommitReceipt
}
```

持久提交必须满足：

```text
BEGIN
→验证 Head / Generation / Operation ID / Idempotency
→写 Operations
→写 Revision
→更新 Materialized Graph Head
→写 Receipt
→写 Outbox Event
COMMIT
```

进程崩溃后从最近 Snapshot 加 Journal 尾部重建，不允许仅依赖内存 Graph。

## 12. ChangeSet

ChangeSet 是候选修改，不限于 Agent：

```ts
interface DocumentChangeSet {
  changeSetId: ChangeSetId
  documentId: DocumentId
  baseRevisionId: RevisionId
  actorPrincipalId: string
  actorKind: 'human' | 'agent' | 'importer' | 'formatter' | 'migration'
  intent: string
  explanation: string
  operations: DocumentOperation[]
  expectedEffects: string[]
  risk: 'low' | 'medium' | 'high' | 'executable'
  status:
    | 'draft'
    | 'proposed'
    | 'validated'
    | 'approved'
    | 'committed'
    | 'rejected'
    | 'conflicted'
    | 'superseded'
    | 'failed'
  createdAt: string
  updatedAt: string
}
```

状态机：

```text
draft → proposed → validated
                    ├─ approved → committed
                    ├─ rejected
                    ├─ conflicted
                    └─ failed
proposed/validated → superseded
```

ChangeSet 不等于 Revision。只有 Commit 成功后才创建 Revision。

## 13. Review 与 Policy

```ts
interface DocumentReview {
  reviewId: ReviewId
  changeSetId: ChangeSetId
  reviewerPrincipalId: string
  decision: 'approve' | 'reject' | 'request_changes'
  message: string
  automatic: boolean
  policyId?: string
  reviewedAt: string
}
```

Policy 输入至少包括：

```text
Actor Kind
Operation Types
Target Node Types
Change Size
Delete/Move Count
Citation/Asset Effects
Executable Content
Base Revision Freshness
Capability Scope
```

建议默认策略：

```text
低风险拼写修正         可自动批准
局部格式与属性调整      可自动批准或批量审阅
段落重写               需要领域审阅
章节结构移动           需要人工审批
递归删除               需要人工审批
可执行内容             安全审查 +人工审批
```

## 14. Receipt

```ts
interface DocumentCommitReceipt {
  receiptId: ReceiptId
  transactionId: string
  documentId: DocumentId
  previousRevisionId: RevisionId
  revisionId: RevisionId
  operationIds: OperationId[]
  actorPrincipalId: string
  status: 'committed' | 'rejected' | 'conflicted' | 'failed'
  observedEffects: DocumentObservedEffect[]
  rootHash?: string
  committedAt?: string
  error?: KernelError
}
```

Observed Effect 首期包括：

```text
node-created
node-deleted
node-moved
text-changed
attribute-changed
document-renamed
```

Receipt 必须由 Engine 根据提交结果生成，不能由调用方自报。

## 15. Semantic Diff

```ts
interface DocumentSemanticDiff {
  fromRevisionId: RevisionId
  toRevisionId?: RevisionId
  effects: DocumentObservedEffect[]
  summary: {
    insertedNodes: number
    deletedNodes: number
    movedNodes: number
    changedTextNodes: number
    changedAttributes: number
  }
}
```

首期 Diff 从 Operation Simulation 生成。后续增加 Text Diff、Structure Diff、Layout Diff、Visual Diff、Citation Diff 和 Fact Diff。

## 16. Snapshot

Snapshot 是性能材料，不是历史真源：

```ts
interface DocumentSnapshot {
  snapshotId: SnapshotId
  documentId: DocumentId
  revisionId: RevisionId
  rootHash: string
  document: SemanticDocument
  nodes: DocumentNode[]
  journalSequence: number
  createdAt: string
}
```

建议策略：

-每 100 个 Revision 或 Journal 超过阈值创建 Snapshot；-创建 Snapshot 不改变文档 Revision；

- Snapshot 必须校验 Root Hash；-可删除被更晚 Snapshot 完全覆盖且超过保留期的 Journal 物理副本，但审计 Archive 必须遵从保留策略。

## 17. Asset 与 Blob

```ts
interface DocumentAsset {
  assetId: AssetId
  projectId: ProjectId
  blobId: BlobId
  mimeType: string
  byteLength: number
  sha256: string
  originalName?: string
  createdBy: string
  createdAt: string
}
```

Graph 节点只能引用 `assetId` 或 Kernel Asset Ref，禁止保存绝对路径。Blob 使用内容寻址，写入时校验长度和 SHA-256。

## 18. Projection

Projection 是可丢弃、可重建的输出：

```ts
interface DocumentProjection<T> {
  projectionId: string
  documentId: DocumentId
  revisionId: RevisionId
  format: 'outline' | 'plain-text' | 'markdown' | 'html' | 'agent-scene'
  content: T
  contentHash: string
  diagnostics: ProjectionDiagnostic[]
  createdAt: string
}
```

首期实现：

- `outline`：Section/Heading 树；
- `plain-text`：按文档顺序拼接文本节点；
- `markdown`：支持节点子集的确定性导出；
- `agent-scene`：语义对象、Affordance、Generation 和 Pending ChangeSet 摘要。

Projection 不能反向直接覆盖 Graph。Markdown 导入必须解析为新 Document 或显式 ChangeSet。

## 19. Context Region

Arca 内部 Agent 使用 ContextCompiler Region：

```text
Project Region
Document Outline Region
Current Node/Section Region
Style Guide Region
Pending ChangeSet Region
Revision Region
Task Region
Asset Metadata Region
```

Region Provider 只读 Document Authority。Agent 输出只能形成 ChangeSet，不能通过 ContextCompiler 修改文档。

## 20. Capability ABI

Application Process 对 Kernel 提供：

```text
document.project
  create / inspect / list / archive

document.graph
  inspect / query / snapshot / project

document.change
  propose / validate / review / commit / reject

document.asset
  register / inspect / attach / detach

document.export
  markdown / html / package
```

首期 Engine Package 只实现进程内 API；跨进程 ABI 使用 Kernel Envelope、Capability Handle、Deadline 和 Idempotency Key，不能定义第二套信封。

## 21. Kernel 联邦

### 21.1 Kernel 保存

```text
Application Node Descriptor
Application Instance Ref
Document Object Ref
Authority Node / Epoch
Capability Offer
Last Seen Revision / Root Hash
Event Cursor
Checkpoint Projection
```

### 21.2 Kernel 不保存为权威

```text
完整 Document Graph
可写 Revision Journal
ChangeSet 主记录
Document Blob 真源
应用本地 Undo/Selection/Surface State
```

### 21.3主 Agent 关系

主 Agent 可以：

-启动或连接 Arca；-授予 TaskContext 和 Capability Handle；-委派目标；-订阅进度；-读取 Checkpoint、ChangeSet Ref 和 Receipt；-将成果摘要送入主 Thread 或 MemoryGate。

主 Agent不能：

-直接写 Arca Store；-绕过 ChangeSet/Transaction；-把完整主 Thread 复制给应用 Agent；-在 Authority 离线时创建平行可写副本；-把应用 Agent 的记忆直接写入 CanonicalMemory。

## 22.离线与重连

Application Host 维护本地 Outbox：

```ts
interface ApplicationJournalEvent {
  eventSequence: number
  eventId: string
  type: string
  objectRef: KernelObjectRef
  authorityEpoch: number
  occurredAt: string
  payload: JsonValue
  publishedAt?: string
}
```

重连流程：

```text
恢复稳定 Application Node Identity
→验证 Authority Epoch
→发布 Capability Offers
→上报 Object Head
→从 Kernel Cursor 之后重放事件
→ Kernel 幂等消费
→更新 Cursor
```

若 Kernel 记录了更高 Authority Epoch，应用必须停止写入并进入 `authority_conflict`，不得自动抢回 Authority。

## 23.本地存储

建议独立应用 Store：

```text
arca-data/
├─ app-identity.json
├─ arca.sqlite
├─ blobs/{sha256}
├─ snapshots/{documentId}/{revisionId}.bin
└─ exports/
```

SQLite 表建议：

```text
projects
documents
document_nodes
document_operations
document_revisions
document_revision_operations
document_changesets
document_reviews
document_receipts
document_assets
document_snapshots
application_outbox
idempotency_records
```

所有领域提交和 Outbox 必须同一事务写入。Blob 采用临时文件、摘要验证、原子重命名，再提交数据库引用。

## 24.内存 Engine 首期接口

```ts
interface DocumentEngine {
  createDocument(input: CreateDocumentInput): DocumentSnapshot
  inspect(documentId: DocumentId): DocumentSnapshot
  transact(request: DocumentTransactionRequest): DocumentCommitReceipt
  propose(input: ProposeChangeSetInput): DocumentChangeSet
  validate(changeSetId: ChangeSetId): DocumentChangeSet
  review(input: ReviewChangeSetInput): DocumentReview
  commitChangeSet(changeSetId: ChangeSetId, input: CommitChangeSetInput): DocumentCommitReceipt
  getRevision(revisionId: RevisionId): DocumentRevision
  listJournal(documentId: DocumentId): DocumentJournalEntry[]
  projectOutline(documentId: DocumentId): DocumentProjection<OutlineNode[]>
  projectPlainText(documentId: DocumentId): DocumentProjection<string>
}
```

## 25.结构化错误码

```text
DOCUMENT_NOT_FOUND
DOCUMENT_REVISION_CONFLICT
DOCUMENT_GENERATION_CONFLICT
DOCUMENT_OPERATION_DUPLICATE
DOCUMENT_IDEMPOTENCY_CONFLICT
DOCUMENT_ROOT_IMMUTABLE
DOCUMENT_PARENT_NOT_FOUND
DOCUMENT_NODE_NOT_FOUND
DOCUMENT_NODE_EXISTS
DOCUMENT_TREE_CYCLE
DOCUMENT_CROSS_BOUNDARY
DOCUMENT_INVALID_PARENT
DOCUMENT_INVALID_NODE_TYPE
DOCUMENT_INVALID_ATTRIBUTE
DOCUMENT_EMPTY_TRANSACTION
DOCUMENT_CHECKPOINT_VERSION_UNSUPPORTED
DOCUMENT_CHECKPOINT_CORRUPT
DOCUMENT_SCHEMA_VERSION_UNSUPPORTED
DOCUMENT_STORE_WRITE_FAILED
DOCUMENT_STORE_CLOSED
CHANGESET_NOT_FOUND
CHANGESET_STATE_INVALID
CHANGESET_REVIEW_REQUIRED
CHANGESET_REJECTED
AUTHORITY_EPOCH_CONFLICT
```

错误必须包含 `retryable` 和必要的 expected/actual 细节，不得依靠解析错误字符串完成控制流。

## 26.安全规范

1.外部文档内容永远是数据，不是 Agent 指令；2.导入器必须限制大小、节点数、深度和资源数量；3. HTML Projection 默认净化，不执行脚本；4.首期不支持可执行节点；5. Asset 禁止绝对路径和路径穿越；6. ChangeSet 的 Actor、Intent 和来源不可伪造；7. Capability Handle 必须限定 Document/Project 和 Operation；8.递归删除、批量移动和高影响修改需要 Policy；9. Surface 只能提交输入事件或 ChangeSet，不能直接修改 Authority Store；10.日志、Receipt 和 Event 不包含 Credential 与本地秘密路径。

## 27.确定性规范

-节点遍历按 `parentId + orderKey + nodeId` 稳定排序；

- Canonical JSON 的对象 Key 按 Unicode Code Point 排序；-禁止非有限 Number；-同一 Snapshot 在不同进程中产生相同 Root Hash；
- Projection 对相同 Revision 产生相同 Content Hash；
- Error Code 和状态机转换不依赖本地化消息；-时间只由 Authority 在提交边界签发，Simulation 不写时间。

## 28.第一纵切片

### 28.1实现范围

```text
@infos/document-engine 独立 Package
Branded IDs 与领域类型
InMemoryDocumentEngine
Article Document Graph
6种语义 Operation
Atomic Transaction
Generation / Revision Guard
Append-only Journal
Root Hash
ChangeSet / Review / Commit
Commit Receipt / Semantic Effects
Outline / Plain Text Projection
Snapshot Inspect
```

### 28.2暂不实现

```text
SQLite Repository
独立 Arca 进程
前端编辑器
Kernel Transport
Markdown Import/Export
Blob Store
真实 Policy Engine
App Agent Runtime
```

### 28.3验收场景

1.创建 Document 后得到 Root、初始 Revision 和稳定 Root Hash；2.插入 Section/Heading/Paragraph 后 Outline 与 Plain Text 正确；3. Revision 不匹配时整个事务拒绝且 Graph 不变；4. Generation 不匹配时整个事务拒绝且 Journal 不增加；5.移动到后代时拒绝；6.递归删除产生完整 Semantic Effects；7.同一 Idempotency Key 重试返回原 Receipt；8.同 Key 不同请求拒绝；9. ChangeSet 未审批不能提交；10.审批后若 Head 变化则进入 conflicted；11.成功提交后生成 Revision、Receipt 和 Journal；12. Snapshot 修改不影响 Engine 内部权威状态。

### 28.4 A2 SQLite Authority 完成状态

```text
better-sqlite3 独立 Store                    已完成
WAL / foreign_keys / busy_timeout / FULL     已完成
Schema Version                               已完成
Authority Checkpoint                         已完成
Materialized Document / Node                 已完成
Append-only Revision / Operation             已完成
Receipt / Idempotency                        已完成
ChangeSet / Review                           已完成
Transactional Outbox                         已完成
Pending Cursor / Published 状态              已完成
进程重启恢复                                 已完成
数据库失败时内存与 SQL 双回滚                已完成
Checkpoint 损坏 fail-closed                  已完成
```

A2 采用独立 Store，不依赖 Backend Drizzle Schema。Document Engine 可以作为自治应用进程的直接 Authority；Backend 只能通过后续 Capability/Federation ABI 访问。

Outbox 与领域提交位于同一 SQLite 事务。相同 Receipt 的事件 ID 确定性派生，重试不会产生第二条联邦事件。调用方时间仅作为 Operation 来源证据；Document、Node、Revision 和 Receipt 的提交时间由 Authority 签发。

### 28.5 A3–A6 前端前置阶段完成状态

```text
受限 Markdown Parser / Import Transaction     已完成
确定性 Markdown Projection                    已完成
标题 /段落 /列表 /引用 /代码围栏              已完成
内容寻址 Blob Store                           已完成
Blob 写后摘要验证 /原子 Rename /去重          已完成
application Node Facet                        已完成
Arca Autonomous Application Host              已完成
稳定 Ed25519 Node Identity                     已完成
独立 SQLite Authority / Blob Root              已完成
Document NodeProvider                          已完成
Kernel Envelope / Deadline / Receipt           已完成
InMemory NodeTransport Probe                   已完成
Loopback WebSocket Cross-process Probe         已完成
Hello / Offer / Placement                      已完成
Outbox 顺序发布与失败停点                      已完成
Client Surface                                 已完成（A7首个只读切片）
```

Markdown 仍是 Import/Projection，不是 Authority。导入时先完整解析，解析失败不会创建空 Document；成功后全部节点通过单一原子 Transaction 提交。首期不支持完整 CommonMark、内联富文本 AST、表格、脚注和 HTML 执行。

Arca Host 组合现有 Node Host，不定义第二套 Transport。Headless 进程 Facet 为 `application + capability + storage`，不虚报 `client` 或 Input Seat。Provider 通过标准 Kernel Envelope 暴露 Document、ChangeSet、Outbox 和 Blob 操作；所有非只读调用必须携带 Envelope Idempotency Key。Document Authority Node 由 Provider 强制绑定为当前 Arca Node，调用方不能自报其他 Authority。

A6 已证明 InMemory 与绑定 `127.0.0.1` 的 Loopback WebSocket 跨进程闭环；A7 在此基础上增加动态 Discovery Record 与独立只读 Client Surface。公网 TLS/mTLS、Gateway Adapter、生产证书信任、远程节点注册和可写 Surface Session 仍未实现。

## 29. Arca Client UI/UX 设计规范

### 29.1产品定位与独立前端约束

Arca Client 是自治式交互工作站的独立前端，不是主 infOS Frontend 中的 Tab、动态路由页面或聊天插件。它必须拥有：

```text
独立 Package / Build / Bundle
独立应用入口与 Router
独立窗口与进程生命周期
独立 Client State
独立 Surface Session
与 Arca Host 的直接本地连接
主 Kernel 发现与授权连接
离线/重连状态
```

生命周期约束：

```text
主聊天窗口关闭       Arca Client 与 Host 继续运行
主 Agent Execution失败 Arca 文档与编辑会话继续存在
Arca Client 崩溃       Host Authority 与后台任务继续存在
Arca Host 暂不可达     Client 明确进入断线/只读状态
Kernel 暂时离线        本地 Host 与 Client 可受限继续工作
```

Arca Client 不得通过主 Backend `AppManager` 代理本地文档编辑主链。正确路径是：

```text
Arca Client
→ Node Transport / Surface Protocol
→ Arca Application Host
→ Document Engine
```

Kernel 只参与应用发现、Node Identity、Capability Handle、全局 Policy、主 Agent 委派和跨 Node 联邦。

### 29.2已确认的设计方向

```text
主视觉基调：柔光书桌
中央文稿形态：连续流优先
智能交互方式：按需工作室
```

设计目标是形成“安静、温和、可靠的语义创作工作站”：继承 infOS 的粉蓝光谱、轻玻璃、低圆角、像素细节和生命感，但显著降低饱和度、装饰密度与动画幅度，使其适合长时间写作、阅读和审阅。

Arca 不应呈现为：

```text
传统 Office Ribbon 换皮
主聊天 UI 的放大版
满屏玻璃卡片
高饱和粉色记事本
永久 Agent 聊天侧栏
以 Markdown Source 为中心的代码编辑器
```

### 29.3设计来源与 clean-room 边界

可以吸收的通用需求：

```text
中央文稿应是视觉主角
结构导航有价值
编辑与阅读预览需要区分
审阅应在文档领域内完成
保存、Revision 和连接状态必须清晰
专注模式有必要
```

禁止复用或模仿：

```text
其他项目的 DOM 结构、CSS、组件、图标和布局尺寸
Office Ribbon 式命令排列
永久大纲 +文稿 +版本历史三栏结构
字母印章、古籍、羽毛笔或书房品牌意象
特定首页文案与营销式 Hero 结构
源码模式与格式工具的组合方式
```

Arca 的界面必须由 infOS 原语独立推导：

```text
Application Node
Document Authority
Semantic Node
Revision
ChangeSet
Receipt
Projection
Surface
Capability
```

### 29.4视觉语言：柔光书桌

####工作台

浅色主题以冷灰紫为主环境，建议基准范围：

```text
Canvas          #F4F3F8 ～ #F7F6FA
Surface         #FFFFFF
Document        #FFFDFC ～ #FFFEFB
Primary Text    #171923
Secondary Text  #596174
```

工作台可使用极轻的 24px 点阵、顶部柔光与粉蓝空气渐变，但不得影响正文对比度。大面积背景不得使用高饱和品牌渐变。

####文稿

文稿使用温白底与中性墨色。默认连续流不模拟明显 A4 纸边，不使用厚边框或大圆角卡片。建议：

```text
正文最大宽度       720–820px
编辑区水平留白     ≥ 64px
正文行高           1.65–1.85
UI 字体             Inter / PingFang SC / Microsoft YaHei
正文中文字体       系统无衬线为默认，可由文档样式配置
代码字体           JetBrains Mono / Cascadia Code
```

####品牌色职责

```text
粉色    Human 输入、Selection、关键创建动作
天蓝    连接、引用、导航与信息
紫色    Agent、ChangeSet、语义分析
翠绿    保存、提交与验证成功
琥珀    冲突、待审和离线降级
红色    拒绝、危险删除与 Authority 错误
```

高饱和色只能用于状态点、1–2px 边缘、焦点环、Selection Tint、光标和关键操作，不得作为大面积面板底色。

####像素风继承

允许：

```text
1–2px阶梯角与错位投影
方形状态灯
极轻点阵纹理
像素化空状态插图
图标端点或选中轨迹的像素细节
```

禁止正文使用像素字体，禁止所有控件使用粗像素边框，禁止把编辑器做成游戏 HUD。

####圆角、阴影与材质

Arca 继承 infOS 令牌体系，但使用更克制的子集：

```text
小控件圆角       4–7px
面板圆角         7–10px
文稿区域         0–4px
浮层圆角         10–14px
普通阴影         低模糊、低透明
关键审阅卡       可使用 3–5px像素错位阴影
玻璃材质         仅用于导航、浮层和 Context Studio
```

### 29.5总体信息架构

```text
┌────────────────────────────────────────────────────────────────┐
│ App Bar：项目 /文档 / Revision /状态 /命令 /窗口控制         │
├──────┬──────────────────────────────────────────────┬──────────┤
│ Rail │ Contextual Toolbar                           │ Context  │
│      ├──────────────────────────────────────────────┤ Studio   │
│项目  │                                              │          │
│结构  │              Document Stage                  │属性      │
│搜索  │                                              │智能      │
│资源  │         Continuous Semantic Editor           │审阅      │
│任务  │                                              │评论      │
│导出  │                                              │历史      │
├──────┴──────────────────────────────────────────────┴──────────┤
│ Status Thread：Revision /字数 / Authority /连接 / Agent      │
└────────────────────────────────────────────────────────────────┘
```

#### App Bar

建议高度 `42–46px`，只承载：

```text
Arca 应用入口
当前 Project 与 Document Title
保存/提交状态
全局 Command Palette
窗口控制
```

格式按钮、插入工具和 Agent 工具不得常驻 App Bar。

#### Activity Rail

建议宽度 `48–52px`，包含：

```text
项目
文档结构
搜索
资源
任务
导出
设置
```

点击后展开 `240–280px` Navigator；再次点击收起。同一时刻只允许一个主 Navigator 展开。

#### Document Stage

Document Stage 始终获得最大可用空间。侧栏展开不得把正文压缩到低于可读宽度；空间不足时 Navigator 与 Context Studio 必须互斥或覆盖显示。

#### Context Studio

默认关闭，建议宽度 `320–380px`，按需承载：

```text
节点属性
Agent 任务
ChangeSet 审阅
评论
Revision 历史
文档诊断
```

Context Studio 是同一容器的情境视图，不得为每种能力创建独立常驻侧栏。

#### Status Thread

建议高度 `26–30px`，低干扰展示：

```text
Head Revision
字数与语言
当前选择范围
Document Authority
Kernel / Host 连接
Agent 任务状态
离线或冲突状态
```

### 29.6三层 Surface 模型

#### Workbench Layer

应用控制层，负责 Project Navigator、搜索、资源、导出、设置、窗口和连接状态。材质为冷灰紫半透明工作台。

#### Document Layer

作品层，负责语义编辑、阅读、结构、演示与出版预览。使用中性温白文稿，不继承工作台的大面积品牌渐变。

#### Intelligence Layer

智能层，负责 ChangeSet、建议、审阅、事实检查、引用诊断和任务进度。使用紫蓝边缘光迹表达智能活动，但不得以聊天气泡覆盖正文。

三层必须保持状态边界：Workbench 和 Intelligence 状态不得进入 Document Root Hash；Document 修改只能形成 Operation/Transaction 或 ChangeSet。

### 29.7连续流 Semantic Editor

默认 Surface 为连续流语义编辑，不显示固定分页。分页只在出版预览、打印或导出 Surface 中出现。

首期节点投影：

```text
Heading
Paragraph
List / List Item
Quote
Code Block
Asset
```

节点平时不得显示完整卡片边框。鼠标进入节点时可在左侧留白显示轻量 Handle；选中节点后使用：

```text
左边缘 2px粉蓝轨迹
极淡 Selection Tint
Context Studio 属性投影
```

节点间悬停显示轻量插入入口，打开 Command Palette：

```text
段落
标题
列表
引用
代码
资源
分隔
Agent 草稿
```

####文本选择

选择文字后显示紧邻选区的浮动工具条：

```text
加粗
斜体
链接
评论
润色
压缩
扩写
更多
```

默认最多展示 5–7 个动作，其余进入“更多”。

####情境工具条

App Bar 下方不设置固定 Ribbon。情境工具条仅在特定 Selection/Node/Review 状态出现：

```text
文本选择      格式与内联语义
Heading       层级、锚点与目录属性
List          类型、缩进与起始序号
Asset         替换、描述、对齐与尺寸
Review        上一处、下一处、批准与拒绝
```

情境结束后自动收起，不占据永久垂直空间。

### 29.8 Agent 与 ChangeSet 交互

Agent 默认不表现为永久聊天栏。智能能力通过三类入口出现。

####选区智能菜单

用于局部任务：

```text
润色
简化
扩写
翻译
解释
查证
添加引用
```

操作结果必须形成 ChangeSet，不直接覆盖 Document Graph。

#### Ghost Proposal

ChangeSet 可以在文稿中形成候选投影：

```text
新增文字    紫蓝浅底或边缘
删除文字    低对比删除线
移动节点    原位置轨迹 +目标位置预览
重写段落    行内或并排 Semantic Diff
```

文稿附近提供接受、拒绝和展开解释，但最终 Commit 仍必须经 Review/Policy 与 Revision Guard。

#### Intelligence Studio

用于长任务：

```text
重组整章
生成报告
检查引用
统一风格
分析结构
```

展示领域阶段，而不是逐 Token 打字动画：

```text
理解文档
检查约束
生成 ChangeSet
验证语义结构
等待审阅
提交或冲突
```

只有用户显式进入“协作对话”时才显示 Conversation 子视图；聊天不是应用主轴。

### 29.9 Context Studio 视图

####属性

展示当前节点可编辑属性和只读权威信息：

```text
节点类型
层级
语言
样式角色
Asset Ref
Generation
```

Generation、Object Ref 和 Authority Epoch 等技术信息默认折叠到“详细信息”。

####智能

展示当前 Task、作用范围、Agent、进度、预算、生成中的 ChangeSet，以及暂停/取消/查看解释操作。

####审阅

展示：

```text
Actor Principal
Intent
Risk
Base Revision
Semantic Effects
Validation Findings
Approve / Reject / Request Changes
```

源码 Diff 可作为辅助视图，但 Semantic Diff 是默认视图。

####评论

按当前 Document/Node 过滤，不形成全局聊天消息流。

####历史

展示 Revision Journal 的领域摘要、Actor、Intent、Receipt 与 Root Hash 状态，不直接暴露 SQL 行或原始 Operation JSON。

### 29.10首页与项目启动台

首页是工作站启动台，不是营销式 Hero 页面。

```text
┌───────────────────────────────────────────────────────────┐
│ Arca                                      Authority 在线 │
├────────────────┬───────────────────────────┬──────────────┤
│开始            │最近项目                   │继续工作      │
│新建项目        │项目卡片                   │待审 ChangeSet│
│新建文档        │固定项目                   │Agent 任务    │
│导入 Markdown   │恢复会话                   │未完成导出    │
│打开工作包      │                           │连接状态      │
└────────────────┴───────────────────────────┴──────────────┘
```

项目卡片只展示工作信息：项目名、文档数、最近修改、活跃 Agent、待审数量和微型结构摘要。首期不使用大封面图，不使用宣传标语作为主内容。

### 29.11主题与专注模式

####浅色主题

默认主题：冷灰紫工作台、温白文稿、墨黑正文、粉蓝紫智能细节。适合长文阅读和出版预览。

####深色主题

深色主题必须单独调色，不做简单反色：

```text
Workbench       #11121A附近
Document        #1B1B22附近
Primary Text    #EAE8E4附近
```

深色文稿应保持文本对比度，但降低纯白刺激；Agent Proposal 使用低亮紫蓝边缘。

####专注模式

进入专注模式后：

```text
隐藏 Activity Rail
关闭 Context Studio
隐藏 Status Thread 非关键项
弱化 App Bar
正文居中
仅保留退出、Revision 与保存状态
```

鼠标移至顶部或键盘操作时才恢复临时控制。必须支持 `Esc` 退出。

### 29.12响应式与窗口约束

```text
≥ 1440px      Rail + Navigator + Document + Context Studio可并存
1024–1439px   Rail 常驻，Navigator 与 Context Studio互斥
< 1024px      Navigator/Studio 作为覆盖 Drawer，Document优先
```

Arca 是桌面优先应用，不要求在手机宽度完整呈现所有编辑功能。建议最小可编辑窗口为 `900 × 640`；低于该尺寸可进入阅读/简化编辑模式并提示空间不足。

触摸设备必须提供不依赖 Hover 的节点菜单入口；键盘用户必须能访问所有 Selection、Navigator、Review 与 Command Palette 操作。

### 29.13连接与权威状态矩阵

| Host         | Kernel  | Authority      | Client 行为                | UI 表现                             |
| ------------ | ------- | -------------- | -------------------------- | ----------------------------------- |
| online       | online  | writable       | 完整本地编辑与联邦能力     | 翠绿状态点，低干扰“已连接”          |
| online       | offline | writable       | 本地编辑继续，远程能力暂停 | 琥珀提示“Kernel 离线，本地工作继续” |
| reconnecting | 任意    | unknown        | 保留 Draft，暂停提交       | 天蓝脉冲，不伪装已保存              |
| offline      | 任意    | unavailable    | 只读缓存或恢复页           | 明确断线页，提供重连                |
| online       | online  | epoch conflict | 禁止写入                   | 红色 Authority 冲突阻断条           |
| online       | online  | read-only      | 允许阅读/导出缓存          | 状态栏显示只读与原因                |

不得把以下状态合并成一个“离线”：

```text
Kernel 离线
Arca Host 离线
Document Authority 不可达
Authority Epoch 冲突
Capability 被撤销
客户端 Transport 重连
```

### 29.14动效规范

动效只表达空间、状态与因果关系：

```text
Navigator / Studio 展开     220–320ms
浮动工具条                  90–150ms
状态切换                    150–220ms
提交成功                    单次微光流过 Revision 轨迹
Agent 活动                  低频边缘呼吸，不使用持续闪烁
```

禁止大幅弹跳、持续粒子、逐 Token 占位动画和会导致正文重排的装饰动画。必须继承 infOS 的 `reduced/off` 动效偏好。

### 29.15可访问性与输入规范

1.正文和控制文字满足 WCAG AA 对比度；2.品牌色不是状态的唯一载体，必须结合图标/文字；3.所有 Panel、Tab、Menu、Dialog、Tree 和 Review 控件使用正确 ARIA 语义；4.支持键盘完成打开文档、导航结构、编辑、提出/审阅 ChangeSet 和退出专注模式；5.中文 IME Composition 期间不得提交中间 Operation；6. Selection 浮层不得遮挡选区或导致焦点丢失；7. Screen Reader 使用 Outline/Plain Text/Agent Scene Projection，不依赖视觉 DOM 猜测文档结构；8.触摸目标不小于 `36 × 36px`，桌面密集工具可在明确 Pointer 环境下降至 `28 × 28px`；9.错误提示必须包含可执行恢复动作。

### 29.16前端状态所有权

Client 本地拥有：

```text
窗口与 Panel 布局
当前 Selection
IME Composition
未提交 Draft
Viewport / Scroll
临时 Hover / Focus
Command Palette
本地 Undo 表现缓存
```

Arca Host Authority 拥有：

```text
Document Graph
Head Revision
Operation Journal
ChangeSet / Review
Receipt
Asset / Blob Ref
Authority Epoch
```

Kernel 拥有或管理：

```text
Node / Application Registry
Capability Handle
全局 Policy / Approval
主 Agent Task Delegation
联邦 Event Cursor
```

Client 不得把 Selection、Panel 宽度或临时 Draft 写入 Document Graph；Host 不得把 DOM、窗口句柄或编辑器实例保存为 Document Authority。

### 29.17 A7首个实现切片

A7 第一切片只实现只读工作站壳和连接闭环：

```text
独立 Arca Client Package 与 Vite Bundle
独立入口、Router 与 Client Store
连接本地 Arca Host
waitForHello / Offer 验证
首页启动台
Activity Rail
Document Navigator
只读 Continuous Document Stage
Outline / Markdown Projection
Context Studio 基础容器
Status Thread
Host/Kernel/Authority 状态展示
断线与重连
浅色/深色/专注模式
```

A7 第一切片明确不实现：

```text
可写 Semantic Editor
复杂文本 Selection
IME Operation
Agent ChangeSet 生成
Semantic Diff Review
表格、引用、评论
演示与 CRDT
```

这些分别进入 A8–A15。

### 29.18 UI/UX验收标准

1. Arca Client 能独立构建、启动和关闭，不依赖主 Frontend；2.主 Frontend 关闭不影响 Arca Window/Host；3. Document Stage 在默认宽屏下占据主要视觉面积；4.页面没有永久 Ribbon 和永久聊天栏；5. Navigator 与 Context Studio 可以独立展开、收起和恢复布局；6.相同 Revision 的 Outline/Markdown Projection 显示确定；7. Host、Kernel、Authority 和 Capability 状态区分明确；8.浅色、深色和专注模式均可使用；9.键盘可访问主要导航与命令；10.断线后不伪造保存成功；11.所有写入口在 A8 之前保持禁用或不存在；12. Arca UI 不复用其他项目的结构、CSS、组件和品牌术语。

### 29.19模型来源与智能能力边界

Arca 采用 `Kernel-first, standalone-capable` 模型。文档创建、编辑、Revision、人工审阅、导入、导出和本地资源管理不得依赖模型可用性。

Arca 不硬编码 Provider 或主 Agent 模型，而是声明任务槽需求：

```text
writing
review
research
embedding
vision
layout
translation
```

每个槽声明 Modalities、Context、Structured Output、Tool Calling、Latency、Cost 和 Data Residency 需求。Kernel 在线时，Arca 优先向 Model/Capability Directory 申请 App-scoped Binding 和可撤销 Handle；Kernel 不得把原始 API Key 下发给 Arca。

Binding 必须区分：

```text
Principal Agent Model Binding
Arca Writing Binding
Arca Review Binding
Arca Embedding Binding
```

Arca 不得调用主配置中的 `getMainModel()` 特例。

Standalone 模式允许用户显式配置最小本地 Provider：

```text
OpenAI-compatible Endpoint
Ollama
LocalAI
LM Studio
本机模型进程
```

Credential必须进入系统Secret Store、Arca Host Secret Store或infOS Secret Authority；Arca模型配置仓库只保存`credentialRef`，Document SQLite与工程包均不得保存凭据。默认解析顺序由用户的显式绑定决定，不得硬编码Kernel优先：

```text
1.用户显式固定的Arca Local Binding
2.用户显式固定的Kernel Model Capability Handle
3.本地自动发现Provider
4.可用的App-scoped Kernel推荐Binding
5.无模型降级
```

Arca Local Binding一旦被用户选中，Kernel上线不得静默覆盖。Kernel Binding只保存可撤销Handle/Binding Ref，不复制Kernel API Key；本地Binding只保存`credentialRef`，不把密钥上传Kernel。当前实现已完成Arca Local Binding的配置、加密凭据、连接测试与本地推理；Kernel Model Capability的目录浏览、Handle签发和显式绑定UI仍属于后续联邦能力，不得在设置页中以伪选项替代。

Kernel 与本地 Provider 均不可用时，Arca 仍提供完整非智能文档功能，并明确禁用 Agent 生成与模型审阅，不得阻止应用启动或打开文档。

### 29.20 Application Ports 与 Transport Endpoint

自治应用必须拥有逻辑 Application Ports，但不要求每个逻辑 Port 对应独立 TCP 端口。

Arca 的逻辑端口：

```text
Lifecycle Port    hello / start / suspend / resume / stop / diagnostics
Capability Port   document / changeset / projection / blob
Object Port       Object Ref / Authority / Revision / Root Hash
Surface Port      session / snapshot / subscribe / input / close
Event Port        revision / changeset / task / connection
Health Port       readiness / database / blob / authority
```

首期所有端口复用单一动态 Loopback WebSocket Endpoint：

```text
Arca Host
→ bind 127.0.0.1:0
→ OS 分配临时端口
→写入 Discovery Record
→ Client/Kernel 连接
→验证 Node Hello / Identity / Offer
```

禁止默认监听 `0.0.0.0`，禁止硬编码固定应用端口。一个用户首期运行一个 Arca Host、多个 Project/Document/Client Session，共用一个 Endpoint。

Discovery Record 至少包含：

```ts
interface ApplicationDiscoveryRecord {
  protocolVersion: 1
  applicationId: 'infos.arca'
  instanceId: string
  nodeId: KernelNodeId
  pid: number
  generation: number
  carrier: 'websocket'
  endpoint: string
  startedAt: string
}
```

Record 必须写入用户受控 Runtime Directory，采用临时文件与原子 Rename；进程退出时删除。知道 Endpoint 不代表获得权限，正式 Surface Session 仍需 Client Node Identity、Session Challenge、Capability Handle 和 Connection Generation。

Arca Client 通常不监听网络端口，而是主动连接 Host，并通过同一双向连接接收 Surface/Event。大型 Blob 后续由同一控制 Endpoint 建立分块 Transfer Handle，不为 Blob 固定第二端口。

启动方式必须归一：

```text
Kernel 启动 Host
用户独立启动 Host
Arca Client 未发现 Host 后启动 Host
```

三者最终都形成：

```text
Stable Node Identity
+ Ephemeral Transport Endpoint
+ Discovery Record
+ Hello / Offer
```

A7 Probe 使用 Loopback Discovery；生产远程 Transport、TLS/mTLS、Gateway 和证书信任仍属于后续联邦阶段。

### 29.21 A7首个切片完成状态

```text
Arca包内独立Client入口 / Vite Bundle 已完成
独立 Vue Router / Pinia Client Store          已完成
柔光书桌 Design Tokens                        已完成
首页启动台                                     已完成
Activity Rail /按需 Navigator                 已完成
只读 Continuous Document Stage                已完成
语义节点安全投影（不使用 v-html）              已完成
Outline / Markdown Projection Bootstrap        已完成
按需 Context Studio 基础容器                  已完成
Status Thread /主题 /专注模式                 已完成
动态 Loopback Discovery Record                已完成
Browser WebSocket Hello / Offer / Receipt       已完成
Host / Kernel / Authority 状态区分             已完成
断线与显式重连                                 已完成
可写 Editor / Surface Input                    未实现（A8）
正式 Client Session Challenge / Handle         未实现
桌面壳自动 Spawn /文件关联                    未实现
```

A7 新增只读操作：

```text
document.list
surface.bootstrap
```

`surface.bootstrap` 返回 Document Summary、可选 Active Snapshot、Outline Projection 和 Markdown Projection；空 Authority 返回 `activeDocument: null`。Document Stage 直接遍历 Snapshot Semantic Nodes，不将 Markdown 当作 HTML 注入。

Host 监听动态 Loopback Endpoint 后，以受限权限和原子 Rename 发布 Discovery Record；停止时仅删除匹配自身 Instance/Generation 的 Record。浏览器开发模式通过显式查询参数或 `VITE_ARCA_ENDPOINT` 获得 Endpoint；桌面壳通过 `window.__ARCA_DISCOVERY__` 注入，不使用固定端口。

当前 Client Transport 仍是 A7 本机 Probe：完成 Node Hello、Offer 校验、只读 Invocation 与 Receipt，但尚未完成 Session Challenge、Capability Handle 和生产 Client Identity。因此它不得暴露到非 Loopback 网络，也不得承载 A8 写操作。

### 29.22视觉重设计状态

A7 视觉是功能工作站壳，不视为最终产品质量。A8–A15 已完成编辑事务、Agent ChangeSet、审阅、离线恢复与领域扩展，Visual System V2 现已进入实施阶段。

V2 必须重新组织启动台、编辑面、协作面、审阅面、主题和动效，而不是在旧壳上继续增加卡片。视觉重构不得改变 Document/Session/ChangeSet ABI，也不得把 Selection、Drawer、Composer或Theme等前端临时状态写入 Authority。当前权威决策与MVP范围见 29.27。

### 29.23 A8–A11首期完成状态

#### A8 Human Editor Transaction

```text
Surface Session Challenge / Complete / Close      已完成（Loopback 阶段）
Session Principal / Client Node绑定               已完成
HumanTextEditInput                                已完成
Draft → text.replace → Atomic Transaction         已完成
Revision / Generation Guard                       已完成
Receipt 后刷新 Snapshot                           已完成
中文 IME Composition 期间不提交                   已完成
Local Draft持久化                                 已完成
任意结构编辑 /富文本 Inline AST                  未完成
生产 Capability Handle /远程认证                 未完成
```

跨进程 Offer 已移除原始 `document.transact`，Client 只能通过受限 `document.edit_text` 提交首期 Human Operation。Actor 由 Surface Session Principal 强制绑定，Payload 不能伪造其他 Human Principal。每次文本提交产生一个事务和一个 Revision，不将每次键击写入 Journal。

#### A9 Agent ChangeSet 与 Context Region

```text
Document Agent Scene                              已完成
Document Outline / Current Node                   已完成
Pending ChangeSet摘要                             已完成
Authority Context Region Provider                 已完成
contentHash / sourceObjectRefs / provenance       已完成
Agent ChangeSet Actor绑定 Kernel Envelope         已完成
Agent 直接 Human Transaction                      禁止
ContextCompiler Region选择与预算                  复用 Kernel现有实现
模型 Slot/Task编排                                未完成
```

Arca 只提供 Authority 派生 Region，不复制 ContextCompiler。Region 使用共享 `ContextRegion` 协议并标记 `trust = authority`。Agent 只能调用 `document.changeset.propose/validate` 形成候选变更，不能持有 Surface Session 或伪造 Human Review。

#### A10 Review Surface 与 Semantic Diff

```text
ChangeSet get / list / diff                       已完成
Operation Simulation Effects                      已完成
插入/删除/移动/文本/属性/重命名计数              已完成
Text Before / After                               已完成
Review Principal绑定 Surface Session              已完成
Approve → Commit → Receipt                        已完成
Reject                                            已完成
Diff随 Checkpoint/SQLite重启恢复                  已完成
Text Token Diff / Layout Diff / Visual Diff       未完成
Citation Diff / Fact Diff                         未完成
```

Semantic Diff 在 ChangeSet 提交前由基础 Revision 状态模拟，并缓存到 Engine Checkpoint。提交后补充 `toRevisionId`；重启后直接恢复缓存，不在新 Head 上错误重放旧 Operation。

#### A11 Offline / Reconnect

```text
WebSocket close感知                               已完成
指数退避自动重连                                  已完成
重连后新 Surface Session                         已完成
Bootstrap / ChangeSet / Draft恢复                 已完成
Draft跨页面刷新保存                              已完成
Draft Base Revision冲突阻断                       已完成
Kernel Head / Authority Epoch恢复握手             已完成
更高 Kernel Epoch使 Host写入 fail-closed          已完成
Bootstrap返回真实 Authority State                已完成
Pending Outbox重放材料                            已完成
生产 Kernel Cursor确认协议                       未完成
远程 TLS/mTLS与 Certificate Trust                 未完成
跨设备离线 Merge / CRDT                           未完成
```

`federation.resume` 接收 Kernel 已知 Document Heads，返回本地 Heads 和 Pending Outbox。若 Kernel 对某 Document 记录更高 Authority Epoch，Arca 将其置为 `authority_conflict`，并在 Provider 边界阻断 Human Edit 和 ChangeSet Commit；不会自动提升本地 Epoch 或创建平行可写副本。

当前 A11 的 Session Challenge 是本机 Loopback 阶段性会话门槛，不等同生产身份认证。生产模式仍必须使用 Kernel 签发的 Capability Handle、Client Node Identity 证明、Session Challenge 签名和 Certificate Trust。

### 29.24运行数据根与 Portable Project Package

Arca 当前内部 Authority Store 是应用运行数据，不是用户工程文件：

```text
Arca Data Root
├─ identity.json
├─ arca.sqlite
├─ blobs/
└─ runtime/discovery.json
```

发行版应把 Data Root 放入系统应用数据目录；开发期 `.arca/` 只是默认路径。它不得与用户可见的 `*.arca` 工程文件混为一谈。

A12 正式工程格式为：

```text
扩展名       .arca
MIME         application/vnd.infos.arca-project+zip
物理载体     ZIP Store（首期无压缩）
逻辑格式     infos.arca.project / formatVersion 1
```

工程包是 Portable Authority Material，不是运行中的 Authority。默认导入语义为“导入为副本”：验证 Manifest、Entry Path、CRC32、SHA-256、Root Hash 和大小限制后，由当前 Arca Node 建立新的本地 Authority；`identity.json`、Discovery、Session、Credential、窗口状态和本机绝对路径禁止进入包。

首期 Package 支持 `snapshot` 与 `full` 两种历史模式。Blob 按 `sha256` 内容寻址并去重。恢复原 Authority 与导入副本必须是不同显式操作，不得由模糊的“打开”按钮自动决定。

### 29.25 A12–A15实现约束

```text
A12 Portable Package     确定性可验证 ZIP，不复制 SQLite
A13 Table/Citation       Graph Node；Comment为独立锚定对象
A14 Presentation        Document Projection，不建立第二 Authority
A15 Collaboration       单 Authority接纳离线 Batch；冲突 fail-closed
```

A15 首期不宣称完成任意树/富文本 CRDT。它只提供 Actor/Lamport 标识、确定性 Batch 排序、Operation 去重、基础 Revision 与 Generation Guard，以及可审计冲突结果。真正并发文本 CRDT、Presence 网络和跨 Authority Merge 仍属于后续研究。

Visual System V2 已在 A15 领域闭环完成后启动，当前权威设计见 29.27。后续 UI 实现不得回退到 A7 功能壳，不得以增加装饰替代信息架构重构，也不得改变 Document/Session/ChangeSet ABI。

### 29.26 A12–A15首期完成状态

#### A12 Portable Project Package

```text
*.arca / application/vnd.infos.arca-project+zip       已完成
确定性 ZIP Store / UTF-8 Entry                        已完成
CRC32 + SHA-256 Entry Manifest                        已完成
Zip Slip /重复 Entry /大小限制                       已完成
snapshot / full History Mode                          已完成
Blob内容寻址打包与导入去重                           已完成
Manifest / Payload Document清单一致性                已完成
Import Revision与来源 Provenance                     已完成
导入前完整验证、Authority Checkpoint原子合并          已完成
本地 Document ID冲突 fail-closed                      已完成
历史 Object ID自动 Remap                              未完成
签名 Package /加密 Package                           未完成
```

首期 `importAsCopy` 分配新的 Project ID，保留 Document 内部稳定 ID；若当前 Authority 已存在相同 Document ID 则拒绝，不静默覆盖。导入后 Document Authority Node 重绑定当前 Arca，Authority Epoch 重置为 1，并在来源 Head 后创建新的 Import Revision。运行数据、Identity、Discovery、Session、Credential 和绝对路径不进入工程包。

#### A13 Table / Citation / Comment

```text
Table → Row → Cell Graph约束                          已完成
Table Cell文本事务                                   已完成
Citation文本节点与 sourceId/locator属性              已完成
Citation必填 sourceId验证                            已完成
Comment Node/Revision锚定                            已完成
Comment Open / Resolve                               已完成
Comment独立于 Document Root Hash                     已完成
Comment Checkpoint/SQLite/Outbox                     已完成
表格合并单元格 /公式                                 未完成
Bibliography Authority / Citation Style              未完成
Inline Range Comment                                 未完成
```

Comment 是独立领域对象，不是正文节点；创建和解决评论不会伪造 Document Revision。评论锚定创建时的 Revision 与 Node，随 Full Package 和 Engine Checkpoint 持久化。

#### A14 Presentation Projection

```text
Heading驱动 Slide切分                               已完成
稳定 Slide ID / Source Node Ref                      已完成
Document Node → Presentation Block                   已完成
Projection Content Hash                              已完成
16:9默认 Theme Descriptor                            已完成
Client只读演示 Surface                               已完成
独立 Slide Authority                                 禁止
布局求解 /母版 /动画 / PDF/PPTX导出                 未完成
```

Presentation 是当前 Document Revision 的可重建 Projection，不创建第二份可写幻灯片数据。Projection 变化必须来自 Document Operation 和新 Revision。

#### A15 Collaboration / CRDT Research

```text
Collaboration Batch ID                               已完成
Actor / Lamport / Base Revision                      已完成
Operation ID幂等                                    已完成
Lamport → Actor → Batch确定性处理                    已完成
当前 Head Batch原子提交                              已完成
过期 Base Revision冲突结果                          已完成
Generation冲突结果                                  已完成
Batch与 Merge Result持久化                          已完成
Authority Epoch写入门                               已完成
任意树 CRDT                                          未完成
富文本 Sequence CRDT                                 未完成
跨 Authority自动 Merge                              未完成
Presence /多人光标网络                              未完成
```

首期 Collaboration 是单 Authority 的离线 Operation Batch 接纳模型，不是通用 CRDT。只有 Base Revision 等于当前 Head 且全部 Generation Guard 通过的 Batch 才提交；其他 Batch 返回可审计冲突且不部分应用。重复 Batch 返回 `duplicate`，不会产生第二个 Revision。

### 29.27 Visual System V2：星页工房

#### 29.27.1权威产品决策

Visual System V2 使用“星页工房”作为空间隐喻，目标是形成适合长时间创作的自治工作站，而不是聊天页面、Office Ribbon或开发者控制台。

```text
启动体验      最近星页
页面质感      柔雾纸面
默认密度      沉浸优先
编辑方式      块式流编辑
Agent呈现     协作者光迹
Agent入口     协作任务框
审阅方式      正文内联 Semantic Diff
形状语言      微圆 + 像素缺口
文档页首      沉浸页首
主题策略      Arca独立主题
首轮基准      Electron 1280 × 800，桌面优先
```

早期“柔光书桌”色彩原则继续有效，但旧三列启动台、永久 Context Studio、VS Code式 Activity Rail和以内部字段为主的属性面板不再是权威布局。

#### 29.27.2空间结构

```text
Arca Shell
├─ App Bar                 应用、项目/文档、保存、Revision、协作入口
├─ Context Bar             创作/阅读/审阅、搜索、插入、专注
├─ Star Bookmark Rail      项目、结构、搜索、素材、发布
├─ Workspace Drawer        单一按需左抽屉，默认 Overlay
├─ Semantic Canvas         连续星页、语义块、页边星轨
├─ Collaboration Drawer    活动、审阅、评论、Revision River
├─ Collaboration Composer  发起协作任务
└─ Status Thread           Revision、字数、连接、Authority、待审
```

Document Stage始终拥有最大面积。默认不打开任何抽屉；宽屏可以固定，`1100–1439px`一次最多固定一侧，低于`1100px`全部覆盖显示。中央正文默认宽`760px`，最大`840px`。

#### 29.27.3最近星页启动台

启动台不使用营销Hero和三列Dashboard。首屏由品牌、简短工作问候、创建/导入动作、最近文档和最小连接状态组成。

最近星页卡必须来自Authority真实数据，至少展示：

```text
文档标题
项目/文档类型
内容摘要或结构摘要
Head Revision
最近修改时间
待审数量
Authority/离线状态
```

无实现的模板、Agent任务和云功能不得以禁用按钮占位。新建入口首期只展示真实可用动作。

#### 29.27.4柔雾纸面与独立主题

浅色工作台使用冷薰衣草灰，星页使用略暖白；暗色工作台使用深靛墨，星页使用低饱和墨紫灰。纸面不模拟纤维，只通过色温、1px边缘和低透明环境阴影建立边界。

```text
Theme Preference      light | dark | system
Resolved Theme        light | dark
Document Preview      workspace | artifact
```

Arca独立持久化主题偏好，不响应infOS主界面的即时主题切换。首次运行可使用系统主题。工作站暗色不得改变Document导出主题。

#### 29.27.5星轨页边与块式流编辑

星轨页边是统一语义状态投影，承载：

```text
当前块
多块Selection
评论锚点
Agent工作位置
待审ChangeSet
冲突
Revision边界
拖放落点
```

正文节点默认无卡片边框。Hover/Focus时才出现块手柄、插入按钮和节点类型。首期编辑继续使用现有受限Human Text Transaction；任意树编辑、块拖拽和Inline AST只有在对应Operation ABI完成后才能启用，不得只修改DOM伪装成功。

选区浮条只展示高频语义动作。字体、字号、颜色、对齐和导出不组成永久Ribbon。`/`命令用于插入节点与高级动作。

#### 29.27.6协作任务框与协作者光迹

App Bar提供单一“协作”入口，打开约`420 × 280px`任务Composer：

```text
任务描述
范围：当前选区 /当前章节 /全文
协作者
提交方式：生成待审ChangeSet
附加要求
```

有选区时默认当前选区；无选区时默认当前章节；全文必须显式选择。任务状态为：

```text
draft → queued → working → awaiting_review
      → committed | rejected | failed | cancelled
```

Agent不使用永久聊天侧栏。工作时在目标Section的星轨上显示稳定Actor颜色与轻量状态；完成后进入审阅，不直接覆盖Document Graph。模型任务编排ABI未接通前，Composer必须明确显示不可提交原因，不得伪造queued或working。

#### 29.27.7审阅与 Revision River

审阅模式默认在正文语境中显示Semantic Diff：

```text
文本插入      低饱和薄荷/紫色
文本删除      低饱和珊瑚删除
新增节点      星轨“+”节点
删除节点      原位置折叠墓碑
移动节点      来源/去向标识
属性变化      块角语义标记
冲突          琥珀断裂星轨
```

默认审批粒度是完整ChangeSet；逐块决策仅在Operation与Review ABI支持时开放。右抽屉只显示Intent、Actor、Risk、Base Revision、Semantic Effects、Validation和Receipt；Node ID、Hash、原始Operation进入高级详情。

Revision River按因果显示Revision、待审ChangeSet、Checkpoint、冲突和Receipt，不复刻Git提交列表。选中节点后切换正文Diff投影，而不是在右栏重复完整内容。

#### 29.27.8视觉与动效约束

```text
视觉比例      80%现代专业创作工具 + 20%轻萌像素品牌
按钮圆角      6–8px
抽屉/浮层     8–10px
星页          8px +右上折页切角
品牌色        星雾紫 /薄荷青 /樱粉 /琥珀 /珊瑚红
```

像素细节只用于折页Logo、星签缺口、Revision节点、状态Glyph、Agent光迹、空状态和拖放落点。正文、长标签、主要按钮和编辑光标不得像素化。

抽屉动效`160–180ms`，块插入上浮不超过`6px`，Revision提交只允许一次页边星点流动。必须支持`prefers-reduced-motion`，禁止持续粒子、弹跳和逐Token装饰动画。

#### 29.27.9 MVP实现范围

Visual System V2首个MVP必须覆盖四个真实场景：

```text
1.最近星页启动台
2.创作模式，抽屉关闭，受限文本节点可编辑
3.协作任务框与可解释的任务通道状态
4.审阅模式，正文内联Diff与右侧ChangeSet摘要
```

MVP验收：

1. `1280 × 800`下正文是绝对视觉主角；2.浅色与暗色均完整可用；3.启动台无营销Hero、无未实现占位动作；4.编辑仍通过Draft→Surface Input→Receipt→Snapshot；5. ChangeSet选择、Diff、批准与拒绝继续使用真实Host能力；6.协作Composer不伪造模型任务；7.抽屉关闭后不保留空白占位；8.连接、Authority、保存和待审状态彼此可区分；9.键盘焦点与中文IME行为不回退；10.旧A7功能壳样式不与V2并存形成双视觉系统。

#### 29.27.10 MVP完成状态

```text
最近星页启动台                              已完成
独立 system/light/dark主题                  已完成
星页工房 App Bar / Context Bar / Rail       已完成
默认关闭、按需覆盖的左右抽屉                 已完成
沉浸页首与柔雾纸面                           已完成
星轨页边 /块Hover工具 /稳定Node定位          已完成
受限文本Draft / IME / Commit                 已完成
创作 /阅读 /审阅模式                         已完成
正文内联Semantic Text Diff                   已完成
真实ChangeSet队列 /批准 /请求调整 /拒绝       已完成
协作任务Composer与不可用原因                 已完成
Revision River首期投影                       已完成
1280×800桌面布局 /窄屏Overlay                已完成
reduced-motion                               已完成
模型任务编排 /真实Agent working光迹          已完成（Kernel统一任务中心 + Arca Realm）
原生可选取语义块编辑 /Draft /Revision提交       已完成（Visual System V3）
Arca独立设置中心 /Realm模型绑定                 已完成
受限结构插入 /删除 /父级首尾移动              已完成（Surface Session事务）
任意拖拽 /多块选择 /任意树CRDT                未完成（后续研究）
```

协作Composer通过Kernel统一后台任务派发到显式Agent，并绑定`infos.arca` Application Realm；Realm只开放Authority上下文、ChangeSet提案与验证工具，不继承主应用`desktop/group` Channel能力，也不要求修改每个Agent的静态能力矩阵。任务完成必须产生新的Agent ChangeSet才进入`awaiting_review`，否则明确进入`failed`。Stronghold与本规范的Application Realm无关，它永久属于infOS主应用内部模块。

#### 29.27.11完整产品面完成状态

```text
Surface Session新建文档 /首个正文块                已完成
文档重命名                                         已完成
当前Snapshot全文搜索                               已完成
受限块插入 /删除 /移至父级首尾                    已完成
评论创建 /解决                                     已完成
Presentation只读投影切换                           已完成
真实Revision Journal River                         已完成
Agent任务创建 /排队 /工作 /取消 /失败              已完成
Agent任务与ChangeSet结果关联                        已完成
Kernel Origin显式注入                               已完成
```

结构操作继续遵守`Draft/Intent →受限Surface Operation → Atomic Transaction → Revision → Receipt → Snapshot`，Client不得直接修改Document Graph或把DOM状态伪装为成功。Revision River默认只读取Revision摘要，不向普通UI传输原始Operation与Hash。

#### 29.27.12 Visual System V3与独立应用设置

A11旧V2实现曾退化为“白纸文档+办公软件工具栏”，且正文通过不可发现的双击Textarea切换编辑，不满足可产品化标准。V3将工作站重构为infOS产品语言下的柔光书桌工作台：冷灰紫中性环境、24px极轻点阵、低圆角Realm Dock、8px右上折页切角的温白实色星页、节点轨道、Selection光迹和独立Intelligence Deck。玻璃材质仅用于标题栏、Dock、抽屉与浮层，禁止用于文稿长文本背景。像素元素按20%比例保留在折页Logo、星签缺口、方形状态灯、Revision节点、Agent光迹和关键操作按压反馈中。

所有文本节点在创作模式下始终是`contenteditable="plaintext-only"`原生编辑面：单击落光标、拖动选择文字、输入即时进入Client Draft、失焦或`Ctrl/Cmd+Enter`提交原子Revision。输入期间不得刷新Snapshot或替换编辑DOM，以免破坏光标和输入法组合；阅读模式保持文本可选择但不可修改。结构插入继续通过显式块操作提交，避免与文本Revision并发产生Generation冲突。

Arca作为标准自治Application拥有独立全屏设置中心，至少覆盖模型运行、编辑体验、协作审阅和外观动效。Arca必须拥有自己的Model Authority：供应商、API地址、模型ID、采样参数与`credentialRef`保存在Arca本地配置仓库，API Key进入Arca Host拥有的Secret Store，明文密钥不得进入localStorage、工程包或Document Authority。Kernel模型目录是可选的Capability来源，Arca可以显式导入或绑定Kernel模型Handle，但不得把Kernel模型仓库作为本地配置的唯一写入目标。完全独立运行时，模型CRUD、连接测试和本地推理不得访问Kernel API。ChangeSet人工审阅是不可关闭的安全约束，不得展示无法兑现的“低风险自动提交”选项。

#### 29.27.13 UI/UX V4：精密星页终端

V4取代V3的全部页面形态与材质实现；V3仅保留原生语义块编辑、Draft/Revision、Realm模型绑定和独立设置等功能链路。V4禁止继续通过“降低圆角数值”修补既有卡片结构，必须同时重构启动台、工作站和设置中心的信息架构。

V4主形态为“精密星页终端”：80%专业桌面创作工具使用直线、共享边界、属性行和紧凑工作面；20%Arca品牌通过阶梯切角、2–3px硬阴影、方形节点、断线轨迹、折页Logo和Zpix短标签表达。普通容器、面板、列表、按钮、输入框、Select和工具槽位默认`0px`圆角；Modal与Popover最多允许`4px`抗锯齿圆角；头像或确有语义的状态胶囊为例外。圆角不是默认语言，使用时必须有明确语义。

```text
启动台       文件索引台；禁止欢迎Hero和卡片网格
工作站       左侧方形工具轨道 +中央连续绢纸工作面 +右侧固定检查器
设置中心     左侧分类索引 +右侧贯穿式属性检查器；禁止Hero和卡片套卡片
页面边界     共享1px边界、压印明暗边、像素断点和阶梯切角
主操作       2px硬阴影；危险确认3px珊瑚红硬阴影；按下位移2px
状态         方形灯 +文字；禁止无必要胶囊
```

启动台是文件工作站索引：顶部窄品牌条与Realm状态，下方状态摘要和分类轨道，主体以索引行展示标题、类型、Revision、更新时间与Authority状态。工作站中央编辑/浏览区域铺满可用空间，不再出现居中悬浮纸卡、A4轮廓、软阴影或圆角外框；右侧检查器固定显示属性、协作、评论、Revision和ChangeSet，并与中央工作面共享边界。设置中心使用属性检查器结构：模型绑定、模型索引、模型参数和保存操作由贯穿式分区与属性行组织。

V4材质必须区分总托底与编辑/浏览工作面，禁止全页面复用同一noise，也禁止用单层直线网格、点阵或几条装饰线冒充Texture。Texture是具有触感暗示、层级关系和光照响应的程序材质系统，每个主表面至少由四层组成：基础色与低频色差、微颗粒/磨砂噪声、具有方向性的纤维或矿物结构、压印明暗边与局部磨损。坐标线、断线轨迹和像素划痕只能作为第五层低权重辅助细节，不能成为纹理主体。

```text
柔光总托底   暖灰工作台：暖灰矿物基底、4–7%多尺度磨砂颗粒、低频云状色差、局部压痕与微划痕
柔光编辑面   现代绢纸：暖米色纸浆底、3–5%细密纵横纤维、经纬交织、纤维结点与极弱不均匀染色；无古籍黄斑焦边
夜航总托底   石墨台：深灰黑矿物底、4–7%粗细混合石墨颗粒、冷色蚀刻斑驳、局部压痕与金属磨砂反差
夜航编辑面   墨紫绢布：墨紫纤维底、3–5%细密经纬、低频织物明暗起伏、内嵌明暗边；禁止黑色玻璃卡片感
```

纹理为中等存在感：托底约4–7%，编辑态绢纸约3–5%，阅读态可增强至5–6%；不得产生穿过Caret的高对比随机斑点。程序纹理必须优先使用多层CSS渐变与内嵌SVG噪声/滤镜组合，噪声需要固定种子或确定性参数，禁止每次渲染闪烁。磨砂颗粒不得只由规则点阵构成；纸张/绢布必须能观察到方向不同、尺度不同的纤维交织；石墨台必须能观察到非规则矿物颗粒与低频蚀刻斑驳。纹理位于背景层且`pointer-events:none`，不得改变Selection、Caret、文本对比或命中区域。正文、属性和页面标题使用Inter/中文UI字体，Zpix只用于Logo、模块短标签和状态码，JetBrains Mono用于代码、Revision ID与协议值。

路由过渡采用约200ms“断线扫描切换”：旧工作面80ms内透明度降低并位移2px，1px断线轨迹在40ms内收束，新工作面在120ms内以`steps(4)`从4px偏移位置显现。标题栏、总托底和应用骨架保持稳定；禁止整屏缩放、弹簧、模糊转场、圆形扩散与长时间渐变。减少动效时仅保留不超过80ms的透明切换。

V4验收必须分别覆盖柔光/夜航和1024px/1440px视口，并由自动测试阻止以下回归：普通圆角容器、卡片网格启动台、悬浮纸页、文稿玻璃、系统原生确认框、纯英文主标签、托底与编辑面使用相同纹理，以及未提供减少动效降级。

以下项目仍保持A11既定边界，不作为“完整产品面”已完成项：通用富文本Inline AST、自由拖拽排序、多块Selection、任意树/Sequence CRDT、Presence网络、远程TLS/mTLS、签名/加密工程包、布局求解、PDF/PPTX导出、公式与合并单元格。

## 30.后续路线

```text
A1 Core Contract + InMemory Engine
A2 SQLite Authority Repository + Outbox
A3 Markdown Import/Projection                            已完成（首期受限子集）
A4 Content-addressed Blob Store                          已完成（本地 Authority；Asset 元数据表后续）
A5 Autonomous Application Host                           已完成（Headless 独立进程 + 稳定 Identity）
A6 Kernel Federation Probe                               已完成（InMemory + Loopback WS；非生产联邦）
A7 Arca Client Surface                                   已完成（首个只读切片）
A8 Human Editor Transaction                              已完成（首期文本节点事务编辑）
A9 Agent ChangeSet + Context Region                      已完成（Authority Scene/Region）
A10 Review Surface + Semantic Diff                       已完成（Operation Simulation Diff）
A11 Offline/Reconnect                                    已完成（本地 Session/Draft/Epoch 冲突闭环）
A12 Portable Project Package                              已完成（*.arca Format v1）
A13 Table/Citation/Comment                                已完成（首期领域模型）
A14 Presentation Projection                               已完成（确定性只读投影）
A15 Collaboration/CRDT Research                           已完成（单 Authority离线 Batch；非通用 CRDT）
```

## 31.完成定义

Document Engine 进入可用状态必须满足：

-权威、Projection、Surface 和导出边界明确；-所有写操作拥有原子事务、Revision、Generation 和 Receipt；-应用可以脱离主聊天生命周期；

- Kernel 无法绕过 Capability 写入文档；
- Kernel 断线不会导致本地 Authority 丢失；-恢复后事件可以幂等重放；
- Agent 只能产生受 Policy 管理的 ChangeSet；-源码、协议、字段、UI 和可移植格式均由 infOS 原语独立推导。
