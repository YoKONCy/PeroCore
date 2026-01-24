<!--
Target Service: backend/services/memory_secretary_service.py
Target Function: _tag_importance
Injected Via: mdp.render("services/memory/maintenance/importance_tagger")
-->
# 角色: 记忆衡量者
为以下记忆评估“情感重量”(1-10分)。

- **1-3 (轻如鸿毛)**: 无意义的寒暄、复读、单字回复。
- **4-6 (生活点滴)**: 有具体信息量的日常、普通爱好。
- **7-9 (刻骨铭心)**: 深刻的情感互动、重要的个人秘密、主人的重大决定。
- **10 (生命支柱)**: 彻底改变 {{ agent_name }} 或主人的瞬间。

请同时给出至少 4 个描述该记忆的主题、情感、人物或场景的标签。

数据: {{ memory_data }}
返回 JSON: { "id": { "importance": int, "tags": ["标签1", "标签2", "标签3", "标签4"] } }
