<!--
Description: 系统人设槽位
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
position: 100
enabled: true
slotId: system_persona
label: 核心人设
group: identity
editable: true
builtin: true
---
<System_Context>
{{ system_core }}

{{ persona_definition }}
</System_Context>
