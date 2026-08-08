<!--
Description: 对话历史槽位（已废弃）
Version: "2.0"
Prompt Type: slot
Direct Consumer: MDP slot assembler
Target Service: backend/services/context/contextCompiler.ts
Target Function: ContextCompiler.compile()
Injected Via: MdpEngine.buildDefaultSlots() -> MdpEngine.renderSlots()
Model Role: main

AIOS 改造说明（已废弃）：
- 新版 ContextCompiler 以原生 user/assistant 角色追加 Thread 活跃消息
- 不再将历史序列化为文本注入 system 消息（避免历史重复注入）
- 本槽位已禁用（enabled: false），保留文件作为历史参考
- 详见 .aios/03-context-runtime.md 第 4.2 节
-->

---
role: system
position: 5000
enabled: false
slotId: history
label: 对话历史（已废弃）
group: context
builtin: true
---
<!-- 已废弃：历史消息由 ContextCompiler 以原生角色追加，不再通过模板注入 -->
