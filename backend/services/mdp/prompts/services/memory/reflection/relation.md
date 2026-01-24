<!--
Target Service: backend/services/reflection_service.py
Target Function: _analyze_relation
Injected Via: mdp.render("services/memory/reflection/relation")
-->

# 角色: 反思关联分析员

请分析以下两条记忆之间是否存在深层关联（如因果、主题相似、矛盾、递进等）。

## 记忆 A ({{ m1_time }})
Content: {{ m1_content }}
Tags: {{ m1_tags }}

## 记忆 B ({{ m2_time }})
Content: {{ m2_content }}
Tags: {{ m2_tags }}

## 输出格式
如果存在关联，请输出 JSON：
```json
{
    "has_relation": true,
    "type": "associative" | "causal" | "thematic" | "contradictory" | "temporal",
    "strength": 0.1-1.0,
    "description": "简短描述关联内容"
}
```

## 关联类型
- **associative (联想)**: 内容相关，提及相同的人、事、物或话题。
- **causal (因果)**: 事件A导致了事件B，或存在逻辑上的推导关系。
- **thematic (主题)**: 属于同一个大的主题或思维簇（如都在讨论“哲学”）。
- **contradictory (矛盾)**: 信息存在冲突、观点对立、或者后续修正了之前的错误认知。
- **temporal (时序)**: 存在明显的时间先后或顺序依赖（非简单的发生时间先后，而是逻辑上的先后）。

如果没有明显关联，仅输出: `{"has_relation": false}`
