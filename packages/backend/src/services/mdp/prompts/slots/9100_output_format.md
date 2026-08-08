<!--
Description: 输出格式约束槽位（近邻用户输入，确保 LLM 生成时遵循）
Version: "1.0"
Prompt Type: slot
Direct Consumer: MDP slot assembler
Target Service: backend/services/context/contextCompiler.ts
Target Function: ContextCompiler.compile()
Injected Via: MdpEngine.buildDefaultSlots() -> MdpEngine.renderSlots()
Model Role: main

AIOS 设计说明：
- 原 output_constraint.md 作为 prompt_fragment 注入 200_abilities，导致能力槽位职责不清
- 现独立为 9100_output_format 槽位，放在 900_user_persona 之后、9500_footer 之前
- 遵循"提示词近邻原则"：输出约束靠近用户输入位置，LLM 生成时能更好地遵循
- 内容由 ContextCompiler 通过 output_format 变量注入（读取 components/output/output_constraint.md）
-->

---
role: system
position: 9100
enabled: true
slotId: output_format
label: 输出格式
group: constraint
editable: true
builtin: true
---
{% if output_format %}
{{ output_format }}
{% endif %}
