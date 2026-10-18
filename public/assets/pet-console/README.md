# 桌宠像素图案

本组素材的轮廓已用于正式桌宠界面，由 `packages/frontend/src/components/pet/PetHudIcon.vue` 内联绘制并跟随主题配色。这里保留独立 SVG 供设计复用；全站 `PixelIcon` 与小光点造型保持原样。

- 24 格主体，26×26 画布为向下 1 格的侧面留出空间。
- 全部采用整数坐标、阶梯轮廓，建议按 26、39、52px 显示。
- SVG 包含亮面、正面、暗面；使用内联 SVG 时可通过 `--pixel-highlight`、`--pixel-face`、`--pixel-shadow` 配色，正面默认继承 `currentColor`。
- 作为外链图片使用时不能继承宿主颜色，需要另行设置文件内配色。
- 图案不自带按钮外框，外框和按压反馈由控件容器负责。

| 文件 | 用途 |
| --- | --- |
| chat.svg | 对话 |
| mic.svg | 语音 |
| wardrobe.svg | 换个样子 |
| heart.svg | 心情 |
| wave.svg | 动作与互动 |
| settings.svg | 设置 |
| thought.svg | 思考状态 |
| expand.svg | 窗口大小 |
| close.svg | 收起与关闭 |
| sparkle.svg | 互动入口 |

此前用于布局参考的设计稿草稿（含从应用截图提取的角色透明图）已随 `.agent/design/` 一并清理，本目录只保留正式 SVG 素材。
