<!--
Target Service: backend/services/agent_service.py
Target Function: _analyze_file_results_with_aux
Injected Via: mdp.render("services/analysis/file_analysis_user_input", ...)
-->

用户请求: {{ user_query }}

搜索到的文件列表 (前 {{ preview_count }} 个):
{{ files_text }}

请分析哪些文件最可能是用户想要的？
