import os
import sys
import logging

# Setup path
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)

# Configure logging
logging.basicConfig(level=logging.INFO)

from services.agent_manager import AgentManager

def check_agents():
    print("正在初始化 AgentManager...")
    manager = AgentManager()
    
    print(f"Agent 目录: {manager.agents_dir}")
    print(f"已加载 Agent: {list(manager.agents.keys())}")
    print(f"已启用 Agent: {manager.enabled_agents}")
    
    agents = manager.list_agents()
    print("Agent 列表输出:")
    for a in agents:
        print(a)

if __name__ == "__main__":
    check_agents()
