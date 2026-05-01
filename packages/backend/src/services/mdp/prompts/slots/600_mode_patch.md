<!--
Description: 模式补丁槽位
Version: "1.0"
Prompt Type: slot
Direct Consumer: MDP slot assembler
Target Service: backend/services/prompt/promptService.ts
Target Function: PromptService.buildPromptMessages()
Injected Via: MdpEngine.buildDefaultSlots() -> MdpEngine.renderSlots()
Model Role: main
-->

---
role: system
position: 600
enabled: true
slotId: mode_patch
label: 模式补丁
group: mode
editable: true
builtin: true
---
{{ mode_persona }}
