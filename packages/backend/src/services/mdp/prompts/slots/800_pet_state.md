<!--
Description: 宠物状态槽位
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
position: 800
enabled: true
slotId: pet_state
label: 宠物状态
group: state
editable: false
builtin: true
---
<Current_Status>
- 当前时间: {{ current_time }}
- 心情: {{ mood }}
- 氛围: {{ vibe }}
- 心理活动: {{ mind }}
{% if vision_status %}
{{ vision_status }}
{% endif %}
</Current_Status>
<Environment>
{{ environment_info }}
</Environment>
