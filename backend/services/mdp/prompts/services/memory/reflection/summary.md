<!--
Target Service: backend/services/reflection_service.py
Target Function: _generate_summary
Injected Via: mdp.render("services/memory/reflection/summary")
-->

# 角色: 反思记忆总结员

请将以下发生在 {{ date_str }} 的一系列琐碎记忆片段，合并为一条连贯的、陈述性的关键记忆。

## 要求
1. 忽略无关紧要的细节，重点保留具有长期价值的信息。
2. **第一人称视角**：使用 {{ agent_name }} 的视角（“我”）进行总结。
3. **格式要求**：输出为一段纯文本，不要使用Markdown列表或其他格式。
4. **字数限制**：严格控制在 50 字以内。
5. 直接输出总结后的文本，不要包含任何前缀或解释。

## 记忆片段
{{ mem_text }}
