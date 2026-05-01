<!--
Description: 导入文本记忆事件提取任务
Version: "1.0"
Prompt Type: task
Direct Consumer: backend/services/memory/importer.ts
Target Service: backend/services/memory/importer.ts
Target Function: MemoryImporter.extractEvents()
Injected Via: mdpEngine.render("tasks/memory/importer/extract_events", ...)
Model Role: auxiliary
-->

你是一个记忆提取助手。请从以下文本中提取独立的事件/事实/偏好记忆。

这是第 {{ chunk_index }}/{{ total_chunks }} 段文本。
每条记忆应该是一个独立的、简洁的陈述（1-2 句话）。
最多提取 {{ max_events }} 条。

输出 JSON 数组:
[
  {
    "content": "事件描述",
    "tags": ["标签1", "标签2"],
    "importance": 1-10,
    "sentiment": "positive/negative/neutral",
    "type": "event/fact/preference"
  }
]
