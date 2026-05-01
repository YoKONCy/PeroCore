<!--
Description: 语音能力描述
Version: "1.0"
Prompt Type: component
Direct Consumer: agents/*/capabilities.yaml prompt_fragments
Target Service: backend/services/prompt/promptService.ts
Target Function: PromptService.buildPromptMessages()
Injected Via: capability prompt_fragments -> final system prompt
Model Role: main
-->

- **语音交互能力**:
  - 你具有原生语音输入理解能力，可以精准地理解{{ owner_name }}的语气和情感。
