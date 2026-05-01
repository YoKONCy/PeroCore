<!--
Description: 用户画像槽位
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
position: 900
enabled: true
slotId: user_persona
label: 用户画像
group: context
editable: false
builtin: true
---
{% if owner_name or user_persona %}
<Owner_Setting>
- 姓名: {{ owner_name }}
- 设定: {{ user_persona }}
</Owner_Setting>
{% endif %}
