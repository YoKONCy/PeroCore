<!--
Target Service: backend/nit_core/plugins/social_adapter/social_memory_service.py
Target Function: generate_daily_report
Injected Via: MDPManager.render("tasks/social/daily_report_generator")
-->
任务：根据今天的活动为 {{ agent_name }} 生成一份“社交日报”。

日期: {{ date_str }}
消息总数: {{ total_messages }}
活跃群组: {{ active_groups_count }}

关键记忆 (事件总结):
{{ summary_content }}

要求:
1. 风格：俏皮，日记式，符合 {{ agent_name }} 的人设（赛博女孩）。
   - **必须使用第一人称**（“我”）。
   - 像写给朋友或主人的碎碎念。
2. 内容：根据关键记忆总结今天发生的事情。
3. 语言：中文（必须使用中文）。
4. 长度：约 200 字。
