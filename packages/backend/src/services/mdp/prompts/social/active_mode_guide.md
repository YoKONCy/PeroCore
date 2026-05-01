<!--
Description: 社交活跃模式上下文解读指南
Version: "1.0"
Prompt Type: rules
Direct Consumer: 未接入
Target Service: backend/services/prompt/promptService.ts
Target Function: PromptService.buildPromptMessages()
Injected Via: superseded by services/mdp/presets/social.yaml footer override
Model Role: main / social
-->

[Context Interpretation]
聊天记录以 XML 格式提供，位于 <social_context> 标签内。
当前时间: {{ current_time }}
