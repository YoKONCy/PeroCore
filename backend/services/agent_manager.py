
import os
import json
import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

@dataclass
class AgentProfile:
    """
    Represents a loaded agent profile.
    """
    id: str
    name: str
    description: str = ""
    work_custom_persona: str = ""
    work_traits: List[str] = field(default_factory=list)
    social_custom_persona: str = ""
    social_traits: List[str] = field(default_factory=list)
    model_config: Dict[str, Any] = field(default_factory=dict)
    social_binding: Dict[str, Any] = field(default_factory=dict)
    config_path: str = ""
    prompt_path: str = ""
    identity_label: str = "智能助手"
    personality_tags: List[str] = field(default_factory=list)

class AgentManager:
    """
    Manages the lifecycle, configuration, and discovery of Agents.
    """
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(AgentManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        
        # Base directory for agents: backend/services/mdp/agents
        self.agents_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "mdp", "agents"))
        self.agents: Dict[str, AgentProfile] = {}
        self.active_agent_id: str = "pero" # Default active agent
        self.enabled_agents: set[str] = set() # Set of enabled agent IDs
        
        self.reload_agents()
        
        # Load launch config from file (synced with frontend)
        try:
            data_dir = os.environ.get("PERO_DATA_DIR", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data")))
            config_path = os.path.join(data_dir, "agent_launch_config.json")
            if os.path.exists(config_path):
                with open(config_path, "r", encoding="utf-8") as f:
                    launch_config = json.load(f)
                    enabled = launch_config.get("enabled_agents", [])
                    active = launch_config.get("active_agent")
                    
                    if enabled:
                        # Validate IDs
                        valid_enabled = [aid for aid in enabled if aid in self.agents]
                        self.enabled_agents = set(valid_enabled)
                        logger.info(f"Loaded enabled agents from launch config: {self.enabled_agents}")
                    
                    if active and active in self.agents:
                        self.active_agent_id = active
                        logger.info(f"Loaded active agent from launch config: {active}")
            else:
                logger.info("No agent launch config found, using defaults.")
                self.enabled_agents = set(self.agents.keys())
        except Exception as e:
            logger.error(f"Failed to load agent launch config: {e}")
            self.enabled_agents = set(self.agents.keys())
        
        # Fallback: if config was empty or invalid, ensure defaults
        if not self.enabled_agents and self.agents:
             self.enabled_agents = set(self.agents.keys())

        self._initialized = True

    def reload_agents(self):
        """Scans the agents directory and loads all configurations."""
        self.agents.clear()
        
        if not os.path.exists(self.agents_dir):
            logger.warning(f"Agent directory not found: {self.agents_dir}")
            # Create default directory if not exists
            try:
                os.makedirs(self.agents_dir)
                logger.info(f"Created agent directory: {self.agents_dir}")
            except Exception as e:
                logger.error(f"Failed to create agent directory: {e}")
                return

        for entry in os.scandir(self.agents_dir):
            if entry.is_dir():
                agent_id = entry.name.lower()
                config_path = os.path.join(entry.path, "config.json")
                prompt_path = os.path.join(entry.path, "system_prompt.md")
                
                if os.path.exists(config_path):
                    try:
                        profile = self._load_agent_config(agent_id, config_path, prompt_path)
                        self.agents[agent_id] = profile
                        logger.info(f"Loaded agent: {profile.name} ({agent_id})")
                    except Exception as e:
                        logger.error(f"Failed to load agent {agent_id}: {e}")
                else:
                    logger.debug(f"Skipping directory {agent_id}: No config.json found")

        if not self.agents:
            logger.warning("No agents loaded! Please check backend/agents directory.")
        
        # Ensure active agent is in the list, if not, reset to first available or 'pero'
        if self.active_agent_id not in self.agents and self.agents:
             self.active_agent_id = next(iter(self.agents))

    def _load_agent_config(self, agent_id: str, config_path: str, prompt_path: str) -> AgentProfile:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        
        agent_dir = os.path.dirname(config_path)
        
        # Helper to load persona content
        def load_persona(type_key: str, legacy_key: str) -> str:
            # Try loading from file first
            personas = config.get("personas", {})
            if type_key in personas:
                rel_path = personas[type_key]
                abs_path = os.path.join(agent_dir, rel_path)
                try:
                    if os.path.exists(abs_path):
                        with open(abs_path, "r", encoding="utf-8") as pf:
                            return pf.read()
                    else:
                        logger.warning(f"Persona file not found: {abs_path}")
                except Exception as e:
                    logger.error(f"Error reading persona file {abs_path}: {e}")
            
            # Fallback to legacy key in config
            return config.get(legacy_key, "")

        work_persona = load_persona("work", "work_custom_persona")
        social_persona = load_persona("social", "social_custom_persona")
        
        # Handle traits (new nested structure vs old flat structure)
        traits = config.get("traits", {})
        work_traits = traits.get("work", config.get("work_traits", []))
        social_traits = traits.get("social", config.get("social_traits", []))
            
        return AgentProfile(
            id=agent_id,
            name=config.get("name", agent_id.capitalize()),
            description=config.get("description", ""),
            work_custom_persona=work_persona,
            work_traits=work_traits,
            social_custom_persona=social_persona,
            social_traits=social_traits,
            model_config=config.get("model_config", {}),
            social_binding=config.get("social_binding", {}),
            config_path=config_path,
            prompt_path=prompt_path,
            identity_label=config.get("identity_label", "智能助手"),
            personality_tags=config.get("personality_tags", [])
        )

    def get_agent(self, agent_id: str) -> Optional[AgentProfile]:
        return self.agents.get(agent_id.lower())

    def get_active_agent(self) -> Optional[AgentProfile]:
        return self.agents.get(self.active_agent_id)

    def set_active_agent(self, agent_id: str) -> bool:
        if agent_id.lower() in self.agents:
            self.active_agent_id = agent_id.lower()
            logger.info(f"Switched active agent to: {agent_id}")
            return True
        logger.warning(f"Cannot switch to unknown agent: {agent_id}")
        return False

    def set_enabled_agents(self, agent_ids: List[str]):
        """Sets the list of enabled agents."""
        valid_ids = [aid.lower() for aid in agent_ids if aid.lower() in self.agents]
        self.enabled_agents = set(valid_ids)
        logger.info(f"Enabled agents updated: {self.enabled_agents}")
        
        # If active agent is not in enabled list, warn or switch?
        # For now, just warn, as the user might be configuring for the future.
        if self.active_agent_id not in self.enabled_agents and self.enabled_agents:
            logger.warning(f"Active agent {self.active_agent_id} is not in enabled list!")

    def get_enabled_agents(self) -> List[str]:
        return list(self.enabled_agents)

    def is_agent_enabled(self, agent_id: str) -> bool:
        return agent_id.lower() in self.enabled_agents

    def list_agents(self) -> List[Dict[str, Any]]:
        # Defensive: If no agents loaded, try reloading once
        if not self.agents:
            logger.info("No agents found in memory, attempting to reload...")
            self.reload_agents()
            # If still empty, ensure enabled_agents is also cleared to avoid inconsistency
            if not self.agents:
                self.enabled_agents.clear()
            else:
                # If loaded, default enable all if none enabled (first run scenario)
                if not self.enabled_agents:
                    self.enabled_agents = set(self.agents.keys())

        return [
            {
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "is_active": p.id == self.active_agent_id,
                "is_enabled": p.id in self.enabled_agents
            }
            for p in self.agents.values()
        ]

# Global instance accessor
_agent_manager_instance = None

def get_agent_manager() -> AgentManager:
    global _agent_manager_instance
    if _agent_manager_instance is None:
        _agent_manager_instance = AgentManager()
    return _agent_manager_instance
