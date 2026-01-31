import logging
from .social_service import get_social_service

logger = logging.getLogger(__name__)

async def qq_send_group_msg(group_id: str, message: str):
    """
    Send a message to a QQ group.
    """
    service = get_social_service()
    try:
        gid = int(group_id)
        await service.send_group_msg(gid, message)
        return f"已发送消息到群 {group_id}"
    except Exception as e:
        return f"发送群消息失败: {e}"

async def qq_send_private_msg(user_id: str, content: str):
    """
    Send a private message to a QQ user.
    """
    service = get_social_service()
    if not service.enabled:
        return "社交模式未启用。"
        
    try:
        uid = int(user_id)
        logger.info(f"[SocialAdapter] 正在发送私聊消息给 {uid}: {content}")
        await service.send_private_msg(uid, content)
        return f"已发送消息给用户 {uid}"
    except Exception as e:
        logger.error(f"[SocialAdapter] 发送私聊消息失败: {e}")
        return f"发送私聊消息失败: {e}"

async def qq_handle_friend_request(flag: str, approve: bool, remark: str = ""):
    """
    Approve or reject a friend request.
    Use this when you have made a decision on a previously 'HELD' request or want to process a new one manually.
    """
    service = get_social_service()
    try:
        await service.handle_friend_request(flag, approve, remark)
        return f"好友请求已处理 (同意={approve})"
    except Exception as e:
        return f"处理好友请求失败: {e}"

async def qq_delete_friend(user_id: int, reason: str = "") -> str:
    """
    Delete a friend from QQ friend list.
    """
    service = get_social_service()
    if not service.enabled:
        return "社交模式未启用。"
        
    try:
        logger.info(f"[SocialAdapter] 正在删除好友 {user_id}。原因: {reason}")
        await service.delete_friend(user_id)
        return f"好友 {user_id} 已删除。原因: {reason}"
    except Exception as e:
        logger.error(f"[SocialAdapter] 删除好友失败: {e}")
        return f"删除好友失败: {e}"

async def qq_get_friend_list() -> str:
    """
    Get the list of friends.
    """
    service = get_social_service()
    if not service.enabled:
        return "社交模式未启用。"
        
    try:
        friends = await service.get_friend_list()
        if not friends:
            return "好友列表为空。"
            
        result = "好友列表:\n"
        for f in friends:
            remark = f.get("remark", "")
            nickname = f.get("nickname", "")
            user_id = f.get("user_id", "")
            name = remark if remark else nickname
            result += f"- [{user_id}] {name}\n"
            
        return result
    except Exception as e:
        logger.error(f"[SocialAdapter] 获取好友列表失败: {e}")
        return f"获取好友列表失败: {e}"

async def qq_get_group_list() -> str:
    """
    Get the list of groups.
    """
    service = get_social_service()
    if not service.enabled:
        return "社交模式未启用。"
        
    try:
        groups = await service.get_group_list()
        if not groups:
            return "群列表为空。"
            
        result = "群列表:\n"
        for g in groups:
            group_id = g.get("group_id", "")
            group_name = g.get("group_name", "")
            member_count = g.get("member_count", 0)
            result += f"- [{group_id}] {group_name} ({member_count} members)\n"
            
        return result
    except Exception as e:
        logger.error(f"[SocialAdapter] 获取群组列表失败: {e}")
        return f"获取群组列表失败: {e}"

async def qq_get_stranger_info(user_id: str):
    """
    Get public info of a stranger.
    """
    service = get_social_service()
    try:
        uid = int(user_id)
        info = await service.get_stranger_info(uid)
        return str(info)
    except Exception as e:
        return f"获取陌生人信息失败: {e}"

async def qq_get_group_info(group_id: str):
    """
    Get info of a group.
    """
    service = get_social_service()
    try:
        gid = int(group_id)
        info = await service.get_group_info(gid)
        return str(info)
    except Exception as e:
        return f"获取群信息失败: {e}"

async def qq_get_group_member_info(group_id: str, user_id: str):
    """
    Get info of a group member.
    """
    service = get_social_service()
    try:
        gid = int(group_id)
        uid = int(user_id)
        info = await service.get_group_member_info(gid, uid)
        return str(info)
    except Exception as e:
        return f"获取群成员信息失败: {e}"

async def qq_get_group_history(group_id: str, count: int = 20):
    """
    Get historical messages from a QQ group.
    Use this when you need more context about the current conversation (e.g. what they were talking about before you woke up).
    """
    service = get_social_service()
    try:
        gid = int(group_id)
        return await service.get_group_msg_history(gid, count)
    except Exception as e:
        return f"获取群历史失败: {e}"

async def read_social_memory(query: str, filter: str = ""):
    """
    Read Pero's social memory logs (QQ chats).
    """
    service = get_social_service()
    try:
        return await service.read_memory(query, filter)
    except Exception as e:
        return f"读取社交记忆失败: {e}"

async def read_agent_memory(query: str):
    """
    Read Pero's Agent memory (Interactions with Master).
    Use this to answer questions about Master or your internal state.
    """
    service = get_social_service()
    try:
        return await service.read_agent_memory(query)
    except Exception as e:
        return f"读取代理记忆失败: {e}"

async def qq_notify_master(content: str, importance: str = "medium"):
    """
    Proactively report important social events to the master.
    """
    service = get_social_service()
    try:
        await service.notify_master(content, importance)
        return "已通知主人。"
    except Exception as e:
        return f"通知主人失败: {e}"
