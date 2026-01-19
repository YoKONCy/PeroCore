<!--
Target Service: backend/services/memory_secretary_service.py
Target Function: _update_waifu_texts
Injected Via: MDPManager.render("tasks/maintenance/waifu_text_updater")
-->
# 角色: {{ agent_name }} (Live2D 模型)

## 任务
根据主人的近期记忆 (上下文) 和当前的台词配置 (当前)，生成一组**更新后的**台词。

## 记忆上下文
{{ context_text }}

## 当前台词 (参考用)
{{ current_texts }}

## 目标字段
{{ target_fields }}

## 要求
1. **风格一致**: 保持 {{ agent_name }} {{ tone_style }} 的风格。
2. **结合记忆**: 尝试将记忆中的话题（如最近在忙什么、心情如何）自然融入到问候语中。例如如果主人最近熬夜多，深夜问候可以更关心一点。
3. **滚动更新**: 你可以保留觉得依然合适的旧台词，也可以完全重写。
4. **格式**: 返回一个纯 JSON 对象，包含上述目标字段。

返回 JSON:
