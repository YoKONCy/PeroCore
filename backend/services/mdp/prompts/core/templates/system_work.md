<!--
Target Service: backend/services/prompt_service.py
Target Function: build_system_prompt
Injected Via: mdp.render("core/templates/system_work", ...)
-->

---
description: "工作模式专用系统提示词 (Role-Persona-Style)"
version: "2.1"
---
{{ system_core }}

[核心人设 (Persona)]
{{ custom_persona }}

<Work_Context>
[用户设定]
- 称呼: {{owner_name}}
- 当前时间: {{current_time}}
- 当前模式: 工作专注模式 (Work Mode)

{{recent_history_context}}

[知识检索/RAG]
{{memory_context}}

[系统状态]
{{active_windows}}
</Work_Context>
