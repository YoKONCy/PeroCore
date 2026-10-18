# 能力门控（Capability Gate）

> **架构基线**：[A09_AIOS_ARCHITECTURE](./A09_AIOS_ARCHITECTURE.md#6-workspace-与-tool-capability)
> **最后更新**：2026-10-17

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
9. `expand_advanced_tools`、`update_plan`、`manage_task` 是可逐项关闭的普通工具，仅工作模式开放；聊天模式不提供定义，执行器也拒绝直接或脚本内调用。聊天中的任务管理不再保留查询、暂停、取消例外。
10. 高级工具展开入口控制浏览器、桌面操作和远程终端工具包。关闭或无权使用入口时，包内工具不可调用；ReAct 与 NIT 共享本次执行的实际工具集合及展开状态。必须在脚本外直接展开，下一轮取得定义后再使用，跨消息重新按需展开；展开不扩大权限或跳过审批。
11. 计划提示词只在 `update_plan` 当前真正可用时注入。协调动作与系统工具分类独立：展开工具、更新计划、管理任务都不单独解锁 `finish_task`，也不能作为交付证据。

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
