
import asyncio
import sys
import os

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), "backend"))

from services.prompt_service import PromptManager
from services.mdp.manager import MDPManager
from core.config_manager import get_config_manager
from services.agent_manager import get_agent_manager

async def test_prompt_rendering():
    print("--- Starting Prompt Rendering Verification ---")
    
    # Initialize
    pm = PromptManager()
    config = get_config_manager()
    agent_manager = get_agent_manager()
    
    # Mock Config
    # We can't easily mock the DB config here without a session, but PromptManager uses config_manager (memory/file based for some things)
    # and AgentManager.
    
    # Let's check what Agent is active
    active_agent = agent_manager.active_agent_id
    print(f"Active Agent ID: {active_agent}")
    
    # Render System Prompt
    # We pass empty variables, expecting PromptManager to fill them
    variables = {}
    
    # We need to mock is_work_mode=False (Social/Normal)
    rendered_prompt = pm.build_system_prompt(variables, is_social_mode=False, is_work_mode=False)
    
    print("\n[Rendered Prompt Snippet]")
    print(rendered_prompt[:500])
    
    # Check for "Pero" (hardcoded) vs Dynamic
    # The default agent IS "pero", so "Pero" might appear.
    # But we want to ensure it comes from the variable.
    
    if "身份: Pero" in rendered_prompt:
        print("\n[Check] Found '身份: Pero'. Verifying source...")
        # Check if we can change the name dynamically
        # Hack: modify variables directly passed
        var_override = {"agent_name": "TestBot"}
        rendered_override = pm.build_system_prompt(var_override, is_social_mode=False, is_work_mode=False)
        if "身份: TestBot" in rendered_override:
            print("[Success] Dynamic Agent Name injection works!")
        else:
            print("[Failure] Agent Name seems hardcoded!")
            
    print("\n--- Verification Complete ---")

if __name__ == "__main__":
    asyncio.run(test_prompt_rendering())
