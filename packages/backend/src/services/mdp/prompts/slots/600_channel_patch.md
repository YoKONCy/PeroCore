<!--
Description: Channel 补丁槽位（原 mode_patch，AIOS 改名）
Version: "2.0"
Prompt Type: slot
Direct Consumer: MDP slot assembler
Target Service: backend/services/context/contextCompiler.ts
Target Function: ContextCompiler.compile()
Injected Via: MdpEngine.buildDefaultSlots() -> MdpEngine.renderSlots()
Model Role: main

AIOS 改造说明：
- 原 600_mode_patch.md 改名为 600_channel_patch.md
- 变量 mode_persona 改名为 channel_patch
- 语义：Thread channel 特定补丁（如 companion 场景的简化人设）
-->

---
role: system
position: 600
enabled: true
slotId: channel_patch
label: Channel 补丁
group: channel
editable: true
builtin: true
---
{{ channel_patch }}
