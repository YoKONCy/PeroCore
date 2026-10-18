<!--
Description: 能力说明与执行协议组合槽位
Version: "1.0"
Prompt Type: slot
Direct Consumer: MDP slot assembler
Target Service: packages/backend/src/services/context/contextCompiler.ts
Target Function: ContextCompiler.compile()
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

{% if ability_fragments or flow_state or task_plan_enabled %}
<abilities>
{% if ability_fragments %}
{{ ability_fragments }}
{% endif %}
{{ component('components/abilities/private_flow_protocol') }}
{{ component('components/abilities/task_plan') }}
</abilities>
{% endif %}
