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
