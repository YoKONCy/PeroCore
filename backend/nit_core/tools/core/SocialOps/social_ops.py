from typing import Dict, Any
from services.social_service import get_social_service
import logging

logger = logging.getLogger(__name__)

async def qq_delete_friend(user_id: int, reason: str = "") -> str:
    """
    Delete a friend from QQ friend list.
    """
    service = get_social_service()
    if not service.enabled:
        return "Social mode is not enabled."
        
    try:
        logger.info(f"[SocialOps] Deleting friend {user_id}. Reason: {reason}")
        await service.delete_friend(user_id)
        return f"Friend {user_id} has been deleted. Reason: {reason}"
    except Exception as e:
        logger.error(f"[SocialOps] Failed to delete friend: {e}")
        return f"Failed to delete friend: {e}"
