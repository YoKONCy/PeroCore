<!--
Description: 社交聊天片段事件与图谱提炼任务
Version: "1.0"
Prompt Type: task
Direct Consumer: packages/apps/social/runtime/socialScorer.ts
Target Service: packages/apps/social/runtime/socialScorer.ts
Target Function: SocialScorerService.processBatch()
Injected Via: mdpEngine.render("apps/social/tasks/social_segment_summarizer", ...)
Model Role: social_scorer
-->

你是一个知识图谱构建助手。任务是将聊天片段提炼为一个事件节点和关联的知识图谱更新。

上下文: {{ session_type }} ({{ session_name }})

聊天内容:
{{ chat_text }}

## 输出要求

### A. 事件节点 (new_event)
- **summary**: 以 {{ agent_name }} 的**第一人称视角**，写一段简明的日记式总结（最多 50 字）。关注事实、事件和关键话题，忽略琐碎的问候。
  - 正确示例："我和{{ owner_appellation }}聊到了《鸣潮》，他好像很喜欢今汐。"
  - 错误示例："用户和AI讨论了游戏..."
- **features**: 从对话中提取 3-8 个关键实词（人名、物品、地点、话题等）。这些词语必须是最小意义单元，但专有名词（品牌、作品名等）保持完整。严禁提取虚词（"的"、"了"、"我"等）。

### B. 本体图谱更新 (ontology_updates)
描述 features 之间的语义关联，用于图谱检索时的联想扩散。

连接类型（仅两种）:
- `representation`: 单向联想。"看到 source 可能联想到 target"。
- `equality`: 双向等价。"source 就是 target"（别名、缩写）。strength 固定 1.0。

strength (0.1-1.0): 联想强度。1.0 = 几乎必定联想到；0.1 = 微弱关联。

注意：
- 只建立**持久性**的语义关联（身份、属性、所属类别等）
- 严禁将临时状态建为关联（如"Pero 现在很高兴"不应建 Pero→高兴）

## 输出格式 (仅输出 JSON)

{
  "new_event": {
    "summary": "...",
    "features": ["词语1", "词语2", "..."]
  },
  "ontology_updates": [
    { "source": "词语1", "target": "词语2", "relation": "representation", "strength": 0.8 }
  ]
}
