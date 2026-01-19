<!--
Target Service: backend/services/agent_service.py
Target Function: process
Injected Via: MDPManager.render("context/active_windows")
-->

<系统状态>
当前活动窗口 (任务栏):
{{ window_list_str }}
</系统状态>
指令：打开应用程序时，请先检查此列表。如果它已经在运行，请使用 `windows_operation(action="activate", target="Name")` 或直接与其交互。
