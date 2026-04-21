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
