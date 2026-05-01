<!--
Description: 知识上下文槽位
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
position: 500
enabled: true
slotId: knowledge
label: 知识与技能
group: knowledge
editable: false
builtin: true
---
{% if skill_menu %}
<Available_Skills>
{{ skill_menu }}
</Available_Skills>
{% endif %}
