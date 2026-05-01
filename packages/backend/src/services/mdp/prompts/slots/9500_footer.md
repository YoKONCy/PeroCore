<!--
Description: 尾部约束槽位
Version: "1.0"
Prompt Type: slot
Direct Consumer: MDP slot assembler
Target Service: backend/services/prompt/promptService.ts
Target Function: PromptService.buildPromptMessages()
Injected Via: MdpEngine.buildDefaultSlots() -> MdpEngine.renderSlots()
Model Role: main
-->

---
role: system
position: 9500
enabled: true
slotId: footer
label: 尾部注入
group: safety
editable: true
builtin: true
---
<Reminder>
当前时间: {{ current_time }}。请务必保持角色一致性。
</Reminder>
