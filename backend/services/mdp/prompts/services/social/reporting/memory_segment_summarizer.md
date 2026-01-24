<!--
Target Service: backend/nit_core/plugins/social_adapter/social_memory_service.py
Target Function: summarize_segment
Injected Via: mdp.render("services/social/reporting/memory_segment_summarizer", ...)
-->

任务：将以下聊天片段总结为一个简洁的记忆片段。

上下文: {{ session_type }} ({{ session_name }})

聊天内容:
{{ chat_text }}

要求:
1. **总结**: 以 {{ agent_name }} 的**第一人称视角**写一段简洁的日记式总结（最多 50 字）。关注事实、事件和关键话题。忽略琐碎的问候。
   - 正确示例：“我和主人聊到了《鸣潮》，他好像很喜欢今汐。”
   - 错误示例：“用户和AI讨论了游戏...”
2. **关键词**: 提取 3-5 个关键实体（人、地点、事件、话题）用于链接。

输出格式 (JSON):
{
    "summary": "...",
    "keywords": ["...", "..."]
}
