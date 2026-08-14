# 能力门控（Capability Gate）

> **架构基线**：[A09_AIOS_ARCHITECTURE](./A09_AIOS_ARCHITECTURE.md#6-workspace-与-tool-capability)
> **最后更新**：2026-08-14

---

## 1. 核心定位

`CapabilityGate` 是工具、Skill 与提示词能力的单一权威判定点。基础解析维度为 **`(agentId, channel)`**；请求级 `capabilityScope` 可在其结果上继续收窄，并把工具名白名单扩展为资源范围、参数约束与审批要求。

```text
(agentId, channel)
  ∩ capabilityScope（default / ambient，只减不增）
  → allowedTools / enabledSkills / promptFragments
  → ResourceScope（允许根、拒绝路径、scope）
  → ParamPolicy（可选）
  → requiresApproval
```

## 2. 强制规则

1. 未配置或未知 channel 必须 **fail-closed**，返回空能力集，禁止回退到 desktop。
2. 模型可见的工具定义和执行期 Handler 必须使用同一 Gate 决策。
3. 运行时上下文必须显式传入 `agentId`、`threadId`、`channel` 与 `capabilityScope`；禁止默认使用 Pero 或任意全局活跃角色。
4. 请求级 Scope 只能取交集，不能扩权；`ambient` 禁止动态 `load_skill` 解锁能力。
5. 文件/终端工具必须受 ResourceScope 约束；默认仅允许 Agent Principal Workspace，路径解析执行 containment 检查。
6. 高风险动作（删除、执行命令、网络等）应进入 Approval 层；未实现审批时，配置必须保守。

## 3. Channel 最小策略

| Channel | 文件工具 | 终端 | 记忆/检索 | 平台能力 |
|---|---|---|---|---|
| desktop | Principal Workspace scope | Workspace cwd，按配置 | 允许 | 按 Agent 配置 |
| social | 默认最小集 | 禁止 | 社交运行时管理 | 必须显式白名单 |
| group | 默认最小集 | 禁止 | 房间/社交运行时管理 | 必须显式白名单 |

### 3.1 Ambient 请求级策略

`ambient` 面向桌宠、主动事件、通知快捷入口和语音唤醒等低干扰环境。其最终能力为 Desktop Channel 白名单与系统 Ambient 白名单的交集，同时清空 Skill 菜单，只保留安全 Prompt Fragment。该 Scope 不属于 Thread，不持久化，也不能改变 Channel。

## 4. 配置与审计

Agent/Workshop/用户资产可声明能力配置，但用户层覆盖不得绕过系统的最小安全规则。每次拒绝、审批、Provider 转发与执行结果都应关联 Thread 和 callId，以便审计。

---

*本文档由 Carola 整理，适用于 infOS 能力门控规范。*
