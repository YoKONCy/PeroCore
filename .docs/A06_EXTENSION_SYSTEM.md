# Package 与用户空间贡献系统

> **适用范围**：`packages/backend/src/packages/`、`packages/shared/src/types/package.types.ts`
> **状态**：生产安全边界规范；当前仅开放 official贡献
> **最后更新**：2026-08-22

---

## 1. 定位

`Package` 是 infOS 的安装、签名、版本、升级与分发单元，不是运行时对象，也不是权限主体。旧 Extension Loader、ExtensionManager、ServiceRunner 与 HookRegistry 已完全删除。

```text
Package Manifest
→ Package Installer
→ Package Registry
→ Package Runtime
→ Contribution Activator
→ Lifecycle Scope
→ Runtime Object / Capability Offer / Tool ABI / Resource
```

Package 的安装不等于激活，激活不等于授权。任何 Contribution 都不得因被发现、安装或加载而隐式扩权。

用户 Package 的物理安装根统一为：

```text
@data/packages
```

历史 `@data/extensions` 只允许在安装边界执行一次性目录迁移，不得重新引入旧运行时。

---

## 2. Manifest V2

公共静态 ABI 定义在 `@infos/shared/types/package.types`。

```typescript
interface PackageManifest {
  manifestVersion: 2
  packageId: string
  name: string
  version: string
  trust: 'official' | 'signed' | 'user' | 'generated'
  contributions: PackageContribution[]
  requires?: PackageCapabilityRequirement[]
  permissions?: PackagePermission[]
  platforms?: PlatformId[]
}
```

一个 Package 可以声明多种 Contribution：

```text
Application
Service Process
Capability Provider
Runtime Adapter
Tool ABI
Skill Resource
Policy
Event Subscriber
Presenter
Asset
Schema / Migration
```

Manifest 只描述静态意图，不保存运行实例、连接、Handle、进程或健康状态。

### 2.1 当前生产开放范围

签名验证、用户 Grant、进程隔离和调用期权限尚未对第三方 Package完整开放，因此当前执行以下 fail-closed规则：

1. 仅 `trust: official` 的 Package可以安装和激活；
2. `tool`、`event-subscriber`、`capability-provider` 等同进程代码只允许 official Package加载；
3. `runtime-adapter`、`application`、`policy`、`presenter`、`asset` 在没有正式 Activator前必须激活失败，不能标记为 active；
4. Service Process必须通过独立进程运行；未建立 Capability Binding的 Requirement不能视为已授权；
5. 非 official Package必须等待签名链、Permission Grant与隔离执行面落地后才能开放。

Contribution清单表示目标 ABI，不表示所有 Kind当前均已开放。

---

## 3. 安装边界

`PackageInstaller` 负责：

-发现 `manifest.json`；-校验 Manifest V2；-拒绝越出 Package Root 的 Entry；-将历史清单输入一次性投影为 Manifest V2；-将 `@data/extensions` 原子迁移到 `@data/packages`；-把已验证清单写入 `PackageRegistry`。

历史清单输入是安装边界私有结构，不属于 Shared 公共 ABI，也不得进入 Package Runtime。

```text
历史 manifest.json
→ LegacyPackageManifestInput
→ legacyPackageManifestToPackage()
→ PackageManifest V2
→ Registry
```

兼容投影只保留数据升级价值，不保留旧 Loader、旧 Hook、旧 Service Locator 或旧执行语义。

---

## 4. Runtime 与原子激活

`PackageRuntime` 按 Package 创建 `LifecycleScope`，并按 Contribution 顺序激活。

```text
installed
→ activating
→ active
→ deactivating
→ installed
```

约束：

1.激活前必须解析所有 `required=true` 的 Capability Requirement；2.每个 Activator 必须返回释放函数或注册到 LifecycleScope；3.任一 Contribution 失败时，已激活项必须逆序回滚；4.停用必须回收 Tool、Skill 目录、Event Subscriber、Provider Offer、Process 与其他资源；5. Package 不能持有全局 AppContext 或其他 Package 实例。

---

## 5. Contribution 语义

### 5.1 Tool ABI

Tool 是面向模型的调用 ABI，不是 Package 间协议。Tool Handler 可以调用 Bound Port，但不能直接获得 Provider 实例。

```text
LLM Tool Call
→ ToolExecutor
→ CapabilityGate / Policy / Approval
→ Bound Port
→ Kernel Envelope
→ Provider
```

### 5.2 Skill Resource

Skill 是按需加载的任务知识与 Context Resource。`requiredTools` 只投影为 Capability Requirement，不能解锁权限。

```text
SKILL.md
→ SkillLoader
→ Context Resource
→ Requirement
→现有 Handle/Policy 的权限交集
```

### 5.3 Service Process

Service 是运行载体，通过 `PackageProcessSupervisor` 管理。跨进程调用使用 `PackageProcessTransport`，默认实现为逐行 JSON-RPC stdio。

Service 必须通过 Capability Offer 发布能力，不能被 Consumer 通过 `serviceId + method` 或进程对象直接调用。

### 5.4 Event Subscriber 与 Interceptor

观察型逻辑使用 Durable/Ephemeral Event Subscriber；需要串行转换或中止的受控入口使用 `PackageInterceptor`。禁止恢复万能 Hook 管道。

### 5.5 Capability Provider / Runtime Adapter

Provider 声明可实现操作，Adapter 把外部 Runtime 投影成 Kernel Object、Snapshot、Stable Handle 与 Verification。Provider 不能成为 Consumer 的权限来源。

### 5.6 Presenter

Presenter 把业务事实或 Runtime Snapshot 投影为 Surface Node，不直接持有前端组件实例，也不把二进制正文塞入 SSE。

---

## 6.跨 Package 协作

唯一标准路径：

```text
Capability Definition
→ Provider Offer / Consumer Requirement
→ Capability Directory
→ Policy Binding
→ Capability Handle
→ Bound Port
→ Kernel Envelope
→ Provider
```

有效权限是以下集合的交集：

```text
Consumer Handle
∩ Provider Offer
∩ Provider 运行权限
∩当前 Policy
∩资源 Scope
∩ Deadline / Generation
```

禁止：

-直接 import 其他 Package 的实现；-共享 AppContext、Repository 或数据库连接；-通过 Tool 名称作为 Package 间协议；-使用全局 Service Locator；-把 Capability Handle 放入 Prompt 或普通日志；

- Provider 代替 Consumer 获取更高权限。

---

## 7.权限与信任

Package Trust 只描述来源可信度，不直接授予能力。权限声明仍需在安装、激活和调用阶段分别验证。

```text
Package Permission       安装时静态意图
Capability Requirement 运行时所需能力
Capability Handle       实际可使用权限
Policy / Approval       当前调用裁决
```

审批产生的临时授权必须可撤销、可到期、可收窄，并绑定 Principal、Execution、资源与操作。

---

## 8.下一阶段 OS 基建

Package Runtime 已完成后，下一阶段不再建设第二套插件框架，而是补齐用户空间资源原语：

```text
Asset / File Handle
Transfer Object
Runtime Event Subscription
Scoped Credential
```

这些原语分别服务Browser、Social附件、Cloud Sync、模型资源、MCP与Document Runtime。实现顺序服从固定依赖：先建立Kernel Object与Execution身份，再建立Envelope与Capability Handle/Bound Port，最后开放Runtime Adapter、Web/Document Runtime和更强隔离；不得绕过基础协议直接增加应用专用Host API。

### 8.1 Skill、Tool与Application边界

- Package是安装与分发单元，可以贡献Application、Service Process、Capability Provider、Runtime Adapter、Tool ABI、Skill Resource、Policy、Event Subscriber、Presenter与Asset。
- Skill是Context Resource与流程知识，只能声明Capability Requirement；加载Skill不得解锁父Execution没有的能力。
- Tool是Capability面向LLM的ABI；Application和Package之间直接使用Bound Port，不以Tool名作为内部RPC。
- Consumer不得导入Provider实现、持有对方实例、共享AppContext或使用任意`serviceId + method`绕过契约。
- Provider权限不能替Consumer扩权；有效权限始终是Consumer Handle、Provider Offer、Provider运行权限、Policy、资源Scope与Deadline/Generation的交集。

### 8.2 统一Application模型

infOS只有一种通用自治Application形态：稳定Application Identity、独立Host/领域逻辑、按需独立Store/Authority、独立生命周期与故障边界，以及可选Capability、Client、Tool ABI和内部Agent/Worker。`Tool`、`Service`、`Client`、`Runtime Adapter`和`SubAgent`只能是Application组成部分，不形成平行应用分类。

Application不得读取Kernel数据库或依赖主Agent Thread；它通过Node/Application Federation发布Offer、声明Requirement、获得收窄Handle，并上报Event、Checkpoint与Receipt。`disconnected_from_kernel`允许本地Authority继续受限工作，但所有依赖Kernel Credential、远程Node或主Agent资源的操作必须暂停。

### 8.3 第三方 Application 三层 Adapter

第三方开源应用不作为同进程 Contribution 直接加载。标准接入分为：

1. infOS 官方通用 Integration Foundation，负责身份、协议、Capability、安全、任务和审计；
2. 贡献者实现的 infOS 侧 Backend/Frontend Adapter，负责领域映射和 UI 集成；
3. 贡献者在目标应用内实现的 Plugin、Extension、MCP Server 或 Sidecar，负责调用应用内部 API。

第二、三层变化不得要求 Kernel 增加应用专用 Service。Adapter 内部使用 Application Protocol 和 Bound Port；只把允许 Agent 使用的 Operation 投影为 Tool。完整规范见 [A11_APPLICATION_INTEGRATION](./A11_APPLICATION_INTEGRATION.md)。

### 8.4 任务移交与生命周期

长任务必须使用 `submitTask` 语义：目标 Application 持久接收后立即返回 `taskId`，随后使用独立 Application Principal、Kernel Execution 和 Abort 域执行。调用工具的 AbortSignal 只约束提交过程，不得控制已接收任务。主 Agent Execution 的取消不能隐式停止 Application Task。

若贡献者只把长任务包装为同步 Tool Promise、继承主 Agent `parentExecutionId`、复用主 Agent AbortSignal，或把 Realm dispose 注册到 Agent Scope，则不符合 Application 接入规范。

---

## 9.验收规则

Package 相关变更至少验证：

- Manifest 重复 ID、无效 Entry 与越界路径
- required Capability 缺失时拒绝激活 -激活失败原子回滚 -停用后 Tool、Provider、Skill、Event 与 Process 全部释放
- Consumer 只能获得 Bound Port -历史清单只在安装边界出现 -生产源码不存在 ExtensionManager、ExtensionLoader 或 ServiceRunner -用户安装和云同步目录统一为 `packages/`
