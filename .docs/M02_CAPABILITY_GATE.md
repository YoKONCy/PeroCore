# 能力门控（Capability Gate）

> **架构基线**：[A09_AIOS_ARCHITECTURE](./A09_AIOS_ARCHITECTURE.md#6-workspace-与-tool-capability)
> **最后更新**：2026-08-19

---

## 1. 核心定位

`CapabilityGate`是主应用Agent能力矩阵的兼容根策略，不是完整授权系统。它解析`(agentId, ThreadChannel)`得到模型可见工具、Skill和Prompt Fragment；最终执行权限还必须与Execution身份、Capability Handle、Resource Scope、Policy、Approval、Deadline及Target Generation取交集。

```text
Agent Channel Root Policy
∩ Execution Capability Handle
∩ request capabilityScope（default / ambient，只减不增）
∩ Resource / Param Policy
∩ Approval / Deadline / Generation
→模型可见定义
→ ToolExecutor执行判定
→ Receipt与Audit Event
```

## 2. 强制规则

1. 持久`ThreadChannel`仅包含`desktop | group`；未知Channel必须fail-closed，禁止回退到desktop。
2. `group`专属于Stronghold；Application Realm不能借用主应用Channel能力矩阵。
3. 模型可见工具定义和执行期Handler必须使用同一Gate快照及Capability判定。
4. Runtime Context显式携带Principal、Process、Execution、Agent、Thread/Realm和Capability Handle；禁止使用全局活跃角色。
5. 请求级Scope只能取交集；`ambient`不得动态加载Skill或扩大资源范围。
6. 文件和Terminal能力必须绑定Resource Scope与Workspace Mount，路径执行containment检查。
7. 删除、命令执行、网络、副作用写入等高风险动作必须进入统一Policy/Approval/Receipt链路。
8. Skill只声明Capability Requirement；加载Skill不能签发能力或越过父Execution授权。

## 3. 主应用Channel根策略

| Channel   | 文件/Terminal                              | 记忆与上下文             | 平台能力            |
| --------- | ------------------------------------------ | ------------------------ | ------------------- |
| `desktop` | Principal Workspace与显式Mount，按配置授权 | 主Agent Context Compiler | 按Agent配置与Handle |
| `group`   | 默认只读且无Terminal                       | Stronghold房间上下文     | 仅Stronghold白名单  |

Social、Arca、Coding等Application通过Realm Capability、Shared Port和Bound Port获取能力，不在本表增加Channel。后台任务继续使用`desktop` Channel，通过`background_task` Purpose、Execution Class和任务Workspace收窄权限。

### 3.1 Ambient请求级策略

`ambient`面向桌宠、主动事件、通知快捷入口和语音唤醒。其最终能力是所属Channel、系统Ambient策略与Execution Handle的交集；默认清空Skill菜单，只保留安全Prompt Fragment。该Scope不属于Thread、不持久化，也不能改变Channel。

## 4. 配置与审计

Agent、Package和用户资产可声明能力需求，但用户层覆盖不得绕过系统最小安全规则。拒绝、审批、Provider转发、执行结果与撤销必须关联`principalId/processId/executionId/callId`和目标Object Generation。Capability Handle不得进入Prompt、Surface正文或普通日志。

---

_本文档由 Carola 整理，适用于 infOS 能力门控规范。_
