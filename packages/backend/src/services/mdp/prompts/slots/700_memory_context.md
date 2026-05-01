<!--
Description: 记忆上下文槽位
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
position: 700
enabled: true
slotId: memory_context
label: 记忆上下文
group: context
editable: false
builtin: true
---
{% if memory_context or graph_context %}
<Long_Term_Memory>
{{ memory_context }}
</Long_Term_Memory>

{% if graph_context %}
<Graph_Context>
{{ graph_context }}
</Graph_Context>
{% endif %}
{% endif %}
