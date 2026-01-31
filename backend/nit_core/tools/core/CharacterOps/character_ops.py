import json
from typing import Dict, Any, Optional, List, Union
from datetime import datetime

try:
    from services.session_service import _CURRENT_SESSION_CONTEXT
    from models import PetState
    from sqlmodel import select
except ImportError:
    from backend.services.session_service import _CURRENT_SESSION_CONTEXT
    from backend.models import PetState
    from sqlmodel import select

async def update_character_status(
    mood: str = None, 
    vibe: str = None, 
    mind: str = None,
    click_head_msgs: Union[str, List[str]] = None,
    click_chest_msgs: Union[str, List[str]] = None,
    click_body_msgs: Union[str, List[str]] = None,
    idle_msgs: Union[str, List[str]] = None,
    back_msgs: Union[str, List[str]] = None,
    **kwargs
) -> str:
    """
    Updates the character's emotion, motion, and interactive messages.
    Persists changes to database and returns a JSON string of triggers.
    """
    try:
        # 1. Construct triggers dictionary
        triggers = {}
        
        # (1) State / Perocue
        state_data = {}
        if mood: state_data["mood"] = mood
        if vibe: state_data["vibe"] = vibe
        if mind: state_data["mind"] = mind
        
        if state_data:
            triggers["state"] = state_data

        # (2) Click Messages
        click_data = {}
        
        # Map parameter names to internal keys
        msg_map = {
            "head": click_head_msgs,
            "chest": click_chest_msgs,
            "body": click_body_msgs
        }
        
        for short_key, val in msg_map.items():
            if val:
                if isinstance(val, str):
                    try:
                        parsed = json.loads(val)
                        click_data[short_key] = parsed if isinstance(parsed, list) else [val]
                    except:
                        click_data[short_key] = [s.strip() for s in val.split(",") if s.strip()]
                elif isinstance(val, list):
                    click_data[short_key] = val
        
        if click_data:
            triggers["click_messages"] = click_data

        # (3) Idle Messages
        if idle_msgs:
            if isinstance(idle_msgs, str):
                try:
                    parsed = json.loads(idle_msgs)
                    triggers["idle_messages"] = parsed if isinstance(parsed, list) else [idle_msgs]
                except:
                    triggers["idle_messages"] = [s.strip() for s in idle_msgs.split(",") if s.strip()]
            elif isinstance(idle_msgs, list):
                    triggers["idle_messages"] = idle_msgs

        # (4) Back Messages
        if back_msgs:
                if isinstance(back_msgs, str):
                    try:
                        parsed = json.loads(back_msgs)
                        triggers["back_messages"] = parsed if isinstance(parsed, list) else [back_msgs]
                    except:
                        triggers["back_messages"] = [s.strip() for s in back_msgs.split(",") if s.strip()]
                elif isinstance(back_msgs, list):
                    triggers["back_messages"] = back_msgs

        # --- Database Update Logic ---
        session = _CURRENT_SESSION_CONTEXT.get("db_session")
        if session:
            # Get or Create PetState
            pet_state = (await session.exec(select(PetState).limit(1))).first()
            if not pet_state:
                pet_state = PetState()
                session.add(pet_state)
            
            # Update Fields
            if mood: pet_state.mood = mood
            if vibe: pet_state.vibe = vibe
            if mind: pet_state.mind = mind
            
            # Update JSON fields if present
            if click_data:
                # Merge with existing? Or overwrite? 
                # Ideally merge, but simple overwrite is safer for consistency with current thought.
                # But let's check if we need to merge. 
                # For now, let's overwrite to ensure new behavior takes effect.
                # Actually, if only 'head' is provided, we shouldn't wipe 'chest'.
                current_click = json.loads(pet_state.click_messages_json) if pet_state.click_messages_json else {}
                current_click.update(click_data)
                pet_state.click_messages_json = json.dumps(current_click, ensure_ascii=False)
                
            if "idle_messages" in triggers:
                pet_state.idle_messages_json = json.dumps(triggers["idle_messages"], ensure_ascii=False)
                
            if "back_messages" in triggers:
                pet_state.back_messages_json = json.dumps(triggers["back_messages"], ensure_ascii=False)
                
            pet_state.updated_at = datetime.now()
            session.add(pet_state)
            await session.commit()
            
            # [Feature] Broadcast State Update via Gateway
            try:
                from services.gateway_client import gateway_client
                await gateway_client.broadcast_pet_state(pet_state.model_dump())
            except Exception as e:
                print(f"[CharacterOps] Broadcast failed: {e}")
            
            # No refresh needed unless we read back
            
        else:
            print("[CharacterOps] Warning: No database session available. Changes not persisted.")

        if not triggers:
            return "No status updates provided."

        # Broadcast to frontend (Tauri/Web)
        try:
            # Lazy import to avoid circular dependency
            try:
                from services.realtime_session_manager import realtime_session_manager
            except ImportError:
                from backend.services.realtime_session_manager import realtime_session_manager
                
            await realtime_session_manager.broadcast({
                "type": "triggers",
                "data": triggers
            })
        except Exception as e:
            print(f"[CharacterOps] Failed to broadcast triggers: {e}")

        return json.dumps(triggers, ensure_ascii=False)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return f"Error updating status: {str(e)}"

# Aliases for backward compatibility if needed by direct python calls
update_status = update_character_status
set_status = update_character_status
set_state = update_character_status
