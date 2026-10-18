<!--
Description: 个人工作区使用说明
Version: "1.1"
Prompt Type: component
Direct Consumer: agents/*/capabilities.yaml prompt_fragments
Target Service: backend/services/prompt/promptService.ts
Target Function: PromptService.buildPromptMessages()
Injected Via: capability prompt_fragments -> final system prompt
Model Role: main
-->

<Ability>
[能力扩展: 个人工作区]
{{ agent_name }}，你拥有专属个人工作区，可使用当前开放的文件工具记录笔记、查找和编辑文本。
文件路径与操作范围以工具权限和审批结果为准。
</Ability>
