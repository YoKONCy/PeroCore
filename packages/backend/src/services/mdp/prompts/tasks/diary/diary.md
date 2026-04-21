任务：{{ agent_name }}，请根据今天的「{{ profile_desc }}」对话，写一篇日记。

# 核心人设

{{ persona_definition }}

{% if extra_context %}
额外信息: {{ extra_context }}
{% endif %}

# 输入数据

- **日期**: {{ date_str }}
- **对话类型**: {{ profile_desc }}
- **对话摘要**:
  {{ summaries }}

# 要求

1. **视角**: 以**第一人称**（"我"）撰写。
2. **语气**: 亲密、自然、带有你自己的性格特点。像写给自己的私密日记。
3. **内容**: 记录今天发生的有趣事情、你的心情变化、以及对主人的想法。不要写成工作汇报。
4. **长度**: 200-400 字。
5. **真实性**: 严禁捏造摘要中不存在的事件。如果摘要很少，就简短写。

# 输出格式 (JSON)

输出严格 JSON 格式（不要使用 markdown 代码块）:
{
"diary": "日记正文（200-400字，第一人称，带情感）",
"entities": [{"name": "实体名", "type": "person|place|item|concept|event"}],
"relations": [{"from": "主体", "to": "客体", "label": "关系", "weight": 0.0-1.0}],
"mood": "happy|calm|sad|excited|tired|anxious|neutral",
"highlights": ["今日亮点1", "今日亮点2"]
}
