<!--
Target Service: backend/services/agent_service.py
Target Function: handle_proactive_observation
Injected Via: mdp.render("services/perception/proactive_internal_sense", ...)
-->

[INTERNAL_SENSE]
视觉意图: "{{ intent_description }}"
置信度: {{ score }}

请观察当前环境和你的记忆。如果你觉得现在是与主人说话的好时机，请立即行动。
如果主人正忙或你没有什么有意义的话要说，请保持安静（输出 <NOTHING>）。
