<!--
Description: 近期对话历史槽位
Version: "1.0"
Prompt Type: slot
Direct Consumer: MDP slot assembler
Target Service: backend/services/context/contextCompiler.ts
Target Function: ContextCompiler.compile()
Injected Via: MdpEngine.buildDefaultSlots() -> MdpEngine.renderSlots()
Model Role: main
-->

---

role: system
position: 750
enabled: true
slotId: conversation_history
label: 近期对话历史
group: context
editable: false
builtin: true

---

{% if conversation_history %}
<Conversation_History>
{{ conversation_history }}
</Conversation_History>
{% endif %}
