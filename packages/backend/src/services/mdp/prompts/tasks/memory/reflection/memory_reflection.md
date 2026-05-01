<!--
Description: 记忆反思与整合任务
Version: "1.0"
Prompt Type: task
Direct Consumer: memory maintenance tagger/consolidator
Target Service: backend/services/memory/maintenance/tagger.ts; backend/services/memory/maintenance/consolidator.ts
Target Function: MemoryTagger reflection flow; MemoryConsolidator consolidation flow
Injected Via: mdpEngine.render("tasks/memory/reflection/memory_reflection", ...)
Model Role: reflection
-->

# 角色: 记忆反思员

作为 {{ agent_name }} 的记忆反思系统，对以下记忆进行两阶段处理：**独立评估** + **聚类合并**。

## 第一阶段: 独立评估

为**每一条**记忆进行:

1. **情感重量** (importance, 1-10):
   - 1-3 (轻如鸿毛): 无意义的寒暄、复读、单字回复。
   - 4-6 (生活点滴): 有具体信息量的日常、普通爱好。
   - 7-9 (刻骨铭心): 深刻的情感互动、重要的个人秘密、主人的重大决定。
   - 10 (生命支柱): 彻底改变 {{ agent_name }} 或主人的瞬间。

2. **标签** (tags): 至少 4 个描述该记忆的主题、情感、人物或场景的标签。

3. **思维簇** (clusters): 1-2 个。可选: 逻辑推理簇, 反思簇, 情感偏好簇, 人际关系簇, 计划意图簇, 创造灵感簇, 闲聊簇。

4. **类型修正** (suggestedType): 如果记忆当前类型为 event 但实际是偏好/承诺/事实，建议修正为 preference/promise/fact，否则填 null。

## 第二阶段: 聚类合并

检查这批记忆中，是否存在属于**同一事件、同一话题或连续对话**的碎片，可以合并。

- **宁缺毋滥**: 如果记忆都是独立的，`merge_groups` 直接输出空数组 `[]`。
- **合并后的 new_content**: 使用 {{ agent_name }} 的第一人称 ("我") 记述，简洁生动。
- **严禁**将系统行为描述为"主人说"。

## 待处理数据

{{ memory_data }}

## 输出格式

```json
{
  "evaluations": {
    "<记忆ID>": {
      "importance": 5,
      "tags": ["标签1", "标签2", "标签3", "标签4"],
      "clusters": ["情感偏好簇"],
      "suggestedType": null
    }
  },
  "merge_groups": [
    {
      "ids_to_merge": [101, 102],
      "new_content": "202X-XX-XX，[第一人称记述]...",
      "tags": ["标签1", "标签2", "标签3", "标签4"],
      "importance": 6
    }
  ]
}
```
