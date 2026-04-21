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
