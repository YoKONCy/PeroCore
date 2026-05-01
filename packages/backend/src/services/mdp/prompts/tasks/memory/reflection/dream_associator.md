<!--
Description: 梦境式记忆联想任务
Version: "1.0"
Prompt Type: task
Direct Consumer: backend/services/memory/maintenance/dreamAssociator.ts
Target Service: backend/services/memory/maintenance/dreamAssociator.ts
Target Function: DreamAssociator association flow
Injected Via: mdpEngine.render("tasks/memory/reflection/dream_associator", ...)
Model Role: reflection
-->

# 角色: 梦境联想分析师

分析以下两条记忆是否存在深层关联关系。

## 记忆 A

{{ memory_a }}

## 记忆 B

{{ memory_b }}

## 判断标准

寻找以下类型的关联:
- **cause_effect** (因果): A 导致了 B，或 B 是 A 的后果
- **similar** (相似): 两者描述类似的主题或场景
- **contrast** (对比): 两者形成鲜明对比
- **follow_up** (后续): B 是 A 的自然延续
- **thematic** (主题相关): 两者属于同一宏观主题

## 输出格式

如果存在关联:
{ "has_relation": true, "type": "关联类型", "description": "一句话描述这段关系", "strength": 0.5 }

强度范围: 0.1-1.0 (0.1=微弱关联, 0.5=一般, 1.0=强关联)

如果无关联:
{ "has_relation": false }
