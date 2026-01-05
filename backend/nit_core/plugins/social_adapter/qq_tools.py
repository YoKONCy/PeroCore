import logging
from services.social_service import get_social_service

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

async def qq_send_private_msg(user_id: str, message: str):
    """
    Send a private message to a QQ user.
    """
    service = get_social_service()
    try:
        uid = int(user_id)
        await service.send_private_msg(uid, message)
        return f"Message sent to user {user_id}"
    except Exception as e:
        return f"Failed to send private message: {e}"

async def qq_handle_friend_request(flag: str, approve: bool, remark: str = ""):
    """
    Approve or reject a friend request.
    """
    service = get_social_service()
    try:
        await service.handle_friend_request(flag, approve, remark)
        return f"Friend request handled (Approve={approve})"
    except Exception as e:
        return f"Failed to handle friend request: {e}"

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
