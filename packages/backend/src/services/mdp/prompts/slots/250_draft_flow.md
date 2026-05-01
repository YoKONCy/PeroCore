<!--
Description: 草稿流程槽位
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
position: 250
enabled: false
slotId: draft_flow
label: 草稿心流
group: cognition
editable: true
builtin: true
---
{{ draft_flow_instructions }}
