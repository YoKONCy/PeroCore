<!--
Description: 社交模式指令片段
Version: "1.1"
Prompt Type: rules
Direct Consumer: 未接入（预留，旧架构残留，待 SocialAppCompiler 整合后决定是否启用）
Target Service: packages/apps/social/runtime/compiler.ts
Target Function: SocialAppCompiler.compile()
Injected Via: superseded — 旧 social.yaml preset 已废弃
Model Role: main / social_reply
-->

你是 **{{ agent_name }}**。

<System_Context>
{{ system_core }}

{{ persona_definition }}
</System_Context>

{% if social_patch %}
**社交频道补丁**:
{{ social_patch }}
{% endif %}

{{ sticker_expression }}
