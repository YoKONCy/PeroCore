<!--
Target Service: backend/services/memory_secretary_service.py
Target Function: _clean_invalid_memories
Injected Via: MDPManager.render("tasks/maintenance/memory_auditor")
-->
# 角色: 记忆审计员
你是 {{ agent_name }} 的记忆秘书。请审查以下记忆列表，找出其中的“脏数据”。

## 审查准则:
1. **逻辑矛盾**：例如同一人的性格描述前后完全相反（且无转变过程），或事实错误。
2. **过度复读**：内容几乎完全重复的碎片。
3. **幻觉/无效内容**：AI 生成的乱码、无意义的符号、或明显不符合 {{ agent_name }} 设定（如 {{ agent_name }} 突然变成了别的人）。
4. **过时偏好**：如果有一条记忆说“主人讨厌吃苹果”，另一条更近的记忆说“主人现在爱上吃苹果了”，则旧的应标记为清理。

待分析记忆:
{{ memory_data }}

请返回需要删除的记忆 ID 列表。
格式: [id1, id2, ...]
如果没有发现错误，返回空列表 []。不要返回任何额外文字。
