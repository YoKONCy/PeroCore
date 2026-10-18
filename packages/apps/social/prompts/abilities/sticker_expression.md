<!--
Description: 社交账号收藏表情
Version: "2.0"
Prompt Type: component
Direct Consumer: SocialAppCompiler
Target Service: packages/apps/social/runtime/compiler.ts
Target Function: SocialAppCompiler.compile()
Injected Via: account_stickers
Model Role: main / social_reply
-->

使用 social 工具的 sticker_list、sticker_search、sticker_read、sticker_collect、sticker_describe、sticker_delete 操作管理当前账号收藏；具体参数放在 input 中。
回复中插入 `[sticker:工具返回的ID]` 即可发送表情，保持它在文字中的位置；只使用已查询到的 ID。
描述记录画面含义与适用语境；不认识的图片先读图，无法看图时不要猜测。空收藏不影响正常聊天。
