# NapCat API Reference

整理自 NapCat 官方文档及 OneBot 11/NapCat 扩展协议说明。
注：NapCat 兼容 OneBot 11 标准，并支持部分 go-cqhttp 扩展及特有扩展。

## 1. 账号相关 (Account)

| 描述 | API Method | 参数示例/备注 |
| :--- | :--- | :--- |
| 获取登录信息 | `get_login_info` | 无 |
| 获取在线状态 | `get_status` | 无 |
| 获取版本信息 | `get_version_info` | 无 |
| 退出机器人 | `bot_exit` | 无 |
| 清除缓存 | `clean_cache` | 无 |
| 设置个性签名 | `set_self_longnick` | `longNick`: string |
| 设置输入状态 | `set_input_status` | `user_id`, `event_type` |
| 设置自定义在线状态 | `set_diy_online_status` | `face_id`, `face_type`, `wording` (NapCat 特有) |
| 设置在线状态 | `set_online_status` | `status`: string |
| 设置 QQ 资料 | `set_qq_profile` | 个人资料相关参数 |
| 设置 QQ 头像 | `set_qq_avatar` | `file`: string (path/url/base64) |
| 获取客户端密钥 | `get_clientkey` | 无 |

## 2. 好友相关 (Friends)

| 描述 | API Method | 参数示例/备注 |
| :--- | :--- | :--- |
| 获取好友列表 | `get_friend_list` | `no_cache`: boolean |
| 获取分类好友列表 | `get_friends_with_category` | 无 |
| 发送私聊消息 | `send_private_msg` | `user_id`, `message` |
| 撤回消息 | `delete_msg` | `message_id` |
| 获取消息 | `get_msg` | `message_id` |
| 发送好友点赞 | `send_like` | `user_id`, `times` |
| 处理好友添加请求 | `set_friend_add_request` | `flag`, `approve`, `remark` |
| 设置好友备注 | `set_friend_remark` | `user_id`, `remark` |
| 删除好友 | `delete_friend` | `user_id` |
| 获取单向好友列表 | `get_unidirectional_friend_list` | 无 |
| 好友戳一戳 | `friend_poke` | `user_id` |
| 标记私聊已读 | `mark_private_msg_as_read` | `user_id` |
| 获取私聊历史消息 | `get_friend_msg_history` | `user_id`, `count` |
| 转发单条好友消息 | `forward_friend_single_msg` | `user_id`, `message_id` |
| 获取个人资料点赞 | `get_profile_like` | 无 |
| 获取表情点赞 | `fetch_emoji_like` | 无 |
| 获取用户状态 | `nc_get_user_status` | `user_id` (NapCat 特有) |

## 3. 群组相关 (Groups)

| 描述 | API Method | 参数示例/备注 |
| :--- | :--- | :--- |
| 获取群列表 | `get_group_list` | `no_cache`: boolean |
| 获取群信息 | `get_group_info` | `group_id`, `no_cache` |
| 获取群扩展信息 | `get_group_info_ex` | `group_id` (NapCat 特有) |
| 发送群消息 | `send_group_msg` | `group_id`, `message` |
| 处理加群请求 | `set_group_add_request` | `flag`, `approve`, `reason` |
| 踢出群成员 | `set_group_kick` | `group_id`, `user_id`, `reject_add_request` |
| 设置群禁言 | `set_group_ban` | `group_id`, `user_id`, `duration` (0为解除) |
| 设置全员禁言 | `set_group_whole_ban` | `group_id`, `enable` |
| 设置群管理员 | `set_group_admin` | `group_id`, `user_id`, `enable` |
| 设置群名片 | `set_group_card` | `group_id`, `user_id`, `card` |
| 设置群名称 | `set_group_name` | `group_id`, `group_name` |
| 退出群聊 | `set_group_leave` | `group_id`, `is_dismiss` |
| 设置专属头衔 | `set_group_special_title` | `group_id`, `user_id`, `special_title` |
| 获取群成员信息 | `get_group_member_info` | `group_id`, `user_id`, `no_cache` |
| 获取群成员列表 | `get_group_member_list` | `group_id`, `no_cache` |
| 获取群荣誉信息 | `get_group_honor_info` | `group_id`, `type` |
| 获取精华消息列表 | `get_essence_msg_list` | `group_id` |
| 设置精华消息 | `set_essence_msg` | `message_id` |
| 删除精华消息 | `delete_essence_msg` | `message_id` |
| 群内戳一戳 | `group_poke` | `group_id`, `user_id` |
| 标记群消息已读 | `mark_group_msg_as_read` | `group_id` |
| 转发单条群消息 | `forward_group_single_msg` | `group_id`, `message_id` |
| 设置群头像 | `set_group_portrait` | `group_id`, `file` |
| 发送群公告 | `_send_group_notice` | `group_id`, `content` |
| 获取群公告 | `_get_group_notice` | `group_id` |
| 删除群公告 | `_del_group_notice` | `group_id`, `notice_id` |
| 获取@全体剩余次数 | `get_group_at_all_remain` | `group_id` |
| 获取群系统消息 | `get_group_system_msg` | 无 |
| 获取群禁言列表 | `get_group_shut_list` | `group_id` |
| 设置群备注 | `set_group_remark` | `group_id`, `remark` |
| 群打卡/签到 | `set_group_sign` / `send_group_sign` | `group_id` |

## 4. 消息与通用 (Messages & Common)

| 描述 | API Method | 参数示例/备注 |
| :--- | :--- | :--- |
| 发送消息 (通用) | `send_msg` | `message_type`, `user_id`/`group_id`, `message` |
| 获取语音 | `get_record` | `file`, `out_format` |
| 获取图片 | `get_image` | `file` |
| 检查能否发图片 | `can_send_image` | 无 |
| 检查能否发语音 | `can_send_record` | 无 |
| 获取文件信息 | `get_file` | `file` |
| 图片 OCR | `ocr_image` | `image` (ID/hash/file) |
| 英译中 | `translate_en2zh` | `words` (NapCat 特有) |
| 获取 Cookie | `get_cookies` | `domain` |
| 获取 CSRF Token | `get_csrf_token` | 无 |
| 获取 QQ 接口凭证 | `get_credentials` | `domain` |

## 5. 文件操作 (Files)

| 描述 | API Method | 参数示例/备注 |
| :--- | :--- | :--- |
| 上传群文件 | `upload_group_file` | `group_id`, `file`, `name` |
| 上传私聊文件 | `upload_private_file` | `user_id`, `file`, `name` |
| 获取群文件列表 | `get_group_root_files` / `get_group_files_by_folder` | `group_id` |
| 创建群文件夹 | `create_group_file_folder` | `group_id`, `name` |
| 删除群文件 | `delete_group_file` | `group_id`, `file_id` |
| 下载文件 | `download_file` | `url`, `headers` |

## 6. 其他扩展 (NapCat Specific)

| 描述 | API Method | 参数示例/备注 |
| :--- | :--- | :--- |
| 获取 AI 录音 | `get_ai_record` | NapCat 特有 |
| 获取 AI 角色 | `get_ai_characters` | NapCat 特有 |
| 检查链接安全性 | `check_url_safely` | `url` |
| 获取机器人账号范围 | `get_robot_uin_range` | 无 |
