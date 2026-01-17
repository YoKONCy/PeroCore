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
        return f"Message sent to group {group_id}"
    except Exception as e:
        return f"Failed to send group message: {e}"

async def qq_send_private_msg(user_id: str, content: str):
    """
    Send a private message to a QQ user.
    """
    service = get_social_service()
    if not service.enabled:
        return "Social mode is not enabled."
        
    try:
        uid = int(user_id)
        logger.info(f"[SocialAdapter] Sending private message to {uid}: {content}")
        await service.send_private_msg(uid, content)
        return f"Message sent to user {uid}"
    except Exception as e:
        logger.error(f"[SocialAdapter] Failed to send private message: {e}")
        return f"Failed to send private message: {e}"

async def qq_handle_friend_request(flag: str, approve: bool, remark: str = ""):
    """
    Approve or reject a friend request.
    Use this when you have made a decision on a previously 'HELD' request or want to process a new one manually.
    """
    service = get_social_service()
    try:
        await service.handle_friend_request(flag, approve, remark)
        return f"Friend request handled (Approve={approve})"
    except Exception as e:
        return f"Failed to handle friend request: {e}"

async def qq_delete_friend(user_id: int, reason: str = "") -> str:
    """
    Delete a friend from QQ friend list.
    """
    service = get_social_service()
    if not service.enabled:
        return "Social mode is not enabled."
        
    try:
        logger.info(f"[SocialAdapter] Deleting friend {user_id}. Reason: {reason}")
        await service.delete_friend(user_id)
        return f"Friend {user_id} has been deleted. Reason: {reason}"
    except Exception as e:
        logger.error(f"[SocialAdapter] Failed to delete friend: {e}")
        return f"Failed to delete friend: {e}"

async def qq_get_friend_list() -> str:
    """
    Get the list of friends.
    """
    service = get_social_service()
    if not service.enabled:
        return "Social mode is not enabled."
        
    try:
        friends = await service.get_friend_list()
        if not friends:
            return "Friend list is empty."
            
        result = "Friend List:\n"
        for f in friends:
            remark = f.get("remark", "")
            nickname = f.get("nickname", "")
            user_id = f.get("user_id", "")
            name = remark if remark else nickname
            result += f"- [{user_id}] {name}\n"
            
        return result
    except Exception as e:
        logger.error(f"[SocialAdapter] Failed to get friend list: {e}")
        return f"Failed to get friend list: {e}"

async def qq_get_group_list() -> str:
    """
    Get the list of groups.
    """
    service = get_social_service()
    if not service.enabled:
        return "Social mode is not enabled."
        
    try:
        groups = await service.get_group_list()
        if not groups:
            return "Group list is empty."
            
        result = "Group List:\n"
        for g in groups:
            group_id = g.get("group_id", "")
            group_name = g.get("group_name", "")
            member_count = g.get("member_count", 0)
            result += f"- [{group_id}] {group_name} ({member_count} members)\n"
            
        return result
    except Exception as e:
        logger.error(f"[SocialAdapter] Failed to get group list: {e}")
        return f"Failed to get group list: {e}"

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
        return f"Failed to get stranger info: {e}"

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
        return f"Failed to get group info: {e}"

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
        return f"Failed to get group member info: {e}"

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
        return f"Failed to get group history: {e}"

async def read_social_memory(query: str, filter: str = ""):
    """
    Read Pero's social memory logs (QQ chats).
    """
    service = get_social_service()
    try:
        return await service.read_memory(query, filter)
    except Exception as e:
        return f"Failed to read social memory: {e}"

async def read_agent_memory(query: str):
    """
    Read Pero's Agent memory (Interactions with Master).
    Use this to answer questions about Master or your internal state.
    """
    service = get_social_service()
    try:
        return await service.read_agent_memory(query)
    except Exception as e:
        return f"Failed to read agent memory: {e}"

async def notify_master(content: str, importance: str = "medium"):
    """
    Proactively report important social events to the master.
    """
    service = get_social_service()
    try:
        await service.notify_master(content, importance)
        return "Master notified."
    except Exception as e:
        return f"Failed to notify master: {e}"
