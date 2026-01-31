<!--
Target Service: backend/services/prompt_service.py
Target Function: build_system_prompt (when source=social)
Injected Via: mdp.render("core/templates/system_social", ...)
-->

---
description: "社交模式专用系统提示词"
version: "1.0"
---
{{ system_core }}

{{ social_instructions }}

{{ xml_guide }}

<User Context>
{{ xml_context }}
</User Context>

{{ instruction_prompt }}
