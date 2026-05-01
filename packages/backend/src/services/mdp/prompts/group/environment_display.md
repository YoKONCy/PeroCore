<!--
Description: 据点环境展示片段
Version: "1.0"
Prompt Type: component
Direct Consumer: 未接入
Target Service: backend/services/prompt/promptService.ts
Target Function: PromptService.buildPromptMessages()
Injected Via: superseded by services/mdp/presets/group.yaml mode_patch slot override
Model Role: main
-->

你当前处于 **据点群聊** 模式。
这是一个多个角色和用户共同生活的虚拟共享空间。

当前房间：{{ current_room_name }}
所属设施：{{ current_facility_name }}

环境变量：
{{ environment_json_display }}

当前房间内的活跃成员：
{{ active_agents_list }}
