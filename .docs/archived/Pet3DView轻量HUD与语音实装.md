# Pet3DView 轻量 HUD 与语音

日期：2026-10-09。状态：代码接线完成，运行验收待用户授权。

## 展示规则

| 信息 | 展示位置与生命周期 |
| --- | --- |
| 空闲 | 角色与 32px 菜单入口；不展示空任务卡，不定时喊话 |
| 主动探索 | 悬停展开“对话 / 语音 / 互动 / 更多”；一次只开一个面板，离开 650ms 后收起，正在输入时保留 |
| 触碰反应 | 角色头部附近短暂显示，约 4 秒；录音、识别、播报、执行、待确认、输入时让位 |
| 完整正文、长回复、历史 | infOS 主应用的同一 Thread；“回复好了”短暂出现 8 秒，之后仅保留未读标记 |
| 运行 | 小入口状态；展开后才显示当前阶段 |
| 审批、问题、任务异常与建议 | 独立摘要卡；可暂时收起，相同事项在本次窗口生命周期内不再自动展开；点击进入主应用会话或任务中心 |
| 录音 / 识别 | 独立语音状态条；录音显示音量与取消入口，识别结束即消失 |
| 播报 | 独立短句字幕，单段最多 32 个字符；随音频播放进度估算段落位置，非逐字对齐；停止播放即隐藏 |
| 换装、动作、心情与想法 | “互动”中主动查看；模型缩略图、穿搭按钮、动作预览均调用真实 Avatar 接口 |

HUD 使用现有语义颜色令牌、PixelIcon、小面积粉紫强调与轻量按压反馈；跟随角色投影轮廓，限制在当前桌宠视窗内。

## 对话与音频合同

1. ContextCompiler 对 desktop 普通对话注入口语协议。自然结束时使用前缀 `<spoken_reply>…</spoken_reply>`，finish_task 通过 `spoken_reply` 参数提交。通常一至两句、120 字以内；接收上限 240 字，超长或不完整块不播报。
2. ReAct 流式过滤器单独收集口语块，完整可见正文继续进入 Conversation Projection / Surface。口语存入 assistant metadata 的 `spokenReply`，Projection 暴露可选字段。旧消息缺少该字段时不回退朗读正文。
3. 持久化后推送 `conversation_reply_ready`，携带 agentId、threadId、messageId、spokenReply。它是短暂提示，重连通过 Projection 恢复；恢复不自动朗读旧消息，也不把历史回复当成新未读。
4. 桌宠 Gateway 只消费状态、口语与定位信息，不维护第二份正文或历史。通过主应用首页导航携带对应角色、会话与消息；对话页按需加载更早历史并定位。
5. TTS 清洗在服务入口统一执行：去掉代码、链接目标、emoji、标点与特殊符号，标点变为空格；小数、百分比、负数、范围及常见单位先转换为可读表达。
6. Audio Asset 播放携带独立 caption；字幕跟随该段音频，不借用当前另一条消息。停止朗读覆盖合成后的派发检查、音频下载、解码与播放，并完成取消回执。

## 输入与设置

- 设置位于主应用“语音功能 → 桌宠语音与快捷键”。主进程在 userData/pet-controls.json 持久化，各窗口通过 IPC 同步。
- 默认麦克风关闭，PTT 绑定 Mouse4；支持 Mouse5、字母、功能键与键盘组合。四个全局快捷键可改或留空禁用：
  - Ctrl+Alt+V：开启 / 关闭语音；
  - Ctrl+Alt+S：停止朗读；
  - Ctrl+Shift+D：打开对应主应用对话；
  - Ctrl+Shift+P：显示 / 隐藏桌宠。
- Windows 主进程使用 Koffi 调用 GetAsyncKeyState，仅在麦克风就绪的 PTT 模式读取绑定键状态，间隔 16ms；录音期间额外读取 Esc 取消键。它不吞掉游戏原本的按键事件。
- 开启语音时检查 ASR 并预先获取麦克风。按下立即录音且打断播报，松开提交一次；不足 180ms、纯静音、取消、关闭或切换时丢弃。单次最长 60 秒。
- ASR 使用 Recorder 的实际 MIME，取消信号贯穿识别请求；角色切换后丢弃旧识别结果。关闭、卸载、锁屏与挂起释放或取消录音，恢复时重新准备设备。
- 自动感应沿用本地音量 VAD，播报期间暂停触发。全局 PTT 仅支持 Windows；其他环境保留面板按住按钮与自动感应。
- Gateway principal 跟随当前角色，录音发送可在失焦状态申请对应音频 Input Seat，避免固定 pero 导致其他角色收不到回复和音频。

## 代码入口

- Electron：petControls.ts、shortcuts.ts、ipcBridge.ts、desktopTabs.ts。
- 桌宠：Pet3DView.vue、PetOverlayUI.vue、PetAppearancePanel.vue、usePetVoice.ts、usePetAudio.ts、usePetGateway.ts、usePetAttention.ts。
- 主应用：PetControlSettings.vue、ChatTab.vue、ChatContainer.vue、useConversationNavigation.ts。
- 后端：spokenReplyFilter.ts、reactLoop.ts、conversationTurnService.ts、voice/spokenReply.ts、startup.ts、audioDeliveryService.ts。

旧 PetBubbleSurface、usePetBubble、usePetInteraction 已移除；主应用中的通用对话 Surface 与任务中心继续承担详细阅读和操作。

## 验证记录

- 已完成源码与 Git 差异审阅。
- 已写口语分片、正文保留、清洗、持久化提示、PTT 权限竞态与取消、ASR 格式和绑定映射的回归用例，未执行。
- 仅解析并安装 Koffi 的预编译依赖，安装脚本全部禁用；未调用原生输入组件。
- 遵守 AGENTS.md 与用户要求：未运行构建、编译、类型检查、lint、测试或应用。实际窗口布局、侧键、麦克风权限与设备切换、音频派发、主应用定位仍需获准后运行验收。
