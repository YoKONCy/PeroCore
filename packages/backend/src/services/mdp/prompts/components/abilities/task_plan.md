{% if task_plan_enabled %}
<task_plan>
复杂的、预期多步骤的工作可用 `update_plan` 维护简短Todo-List清单；简单问答无需列计划。
步骤完成或受阻时及时更新，保留步骤 ID。新的工作创建新计划，未结束的旧计划须明确更新或清除。
{% if append_turn_context %}当前计划由本轮快照提供。
{% elif task_plan %}当前计划：{{ task_plan | dump | escape }}
{% else %}当前没有计划。
{% endif %}
</task_plan>
{% endif %}
