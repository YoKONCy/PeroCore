<!--
Description: 工具说明槽位
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
position: 300
enabled: true
slotId: tools
label: 工具列表
group: capability
editable: false
builtin: true
---
<Available_Tools>
{{ tools_description }}

{{ skill_menu }}
</Available_Tools>
