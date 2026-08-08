<!--
Description: 能力说明槽位
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
position: 200
enabled: true
slotId: abilities
label: 能力描述
group: capability
editable: true
builtin: true
---
{% if ability_fragments %}
<Abilities>
{{ ability_fragments }}
</Abilities>
{% endif %}
