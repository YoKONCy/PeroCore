
import os
import json
import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

@dataclass
class AgentProfile:
    """
    表示已加载的代理配置文件。
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
    管理代理的生命周期、配置和发现。
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
        
        # 代理的基础目录: backend/services/mdp/agents
        self.agents_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "mdp", "agents"))
        self.agents: Dict[str, AgentProfile] = {}
        self.active_agent_id: str = "pero" # 默认活跃代理
        self.enabled_agents: set[str] = set() # 已启用代理 ID 集合
        
        self.reload_agents()
        
        # 从文件加载启动配置 (与前端同步)
        try:
            data_dir = os.environ.get("PERO_DATA_DIR", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data")))
            config_path = os.path.join(data_dir, "agent_launch_config.json")
            if os.path.exists(config_path):
                with open(config_path, "r", encoding="utf-8") as f:
                    launch_config = json.load(f)
                    enabled = launch_config.get("enabled_agents", [])
                    active = launch_config.get("active_agent")
                    
                    if enabled:
                        # 验证 ID
                        valid_enabled = [aid for aid in enabled if aid in self.agents]
                        self.enabled_agents = set(valid_enabled)
                        logger.info(f"从启动配置加载已启用的代理: {self.enabled_agents}")
                    
                    if active and active in self.agents:
                        self.active_agent_id = active
                        logger.info(f"从启动配置加载活跃代理: {active}")
            else:
                logger.info("未找到代理启动配置，使用默认设置。")
                self.enabled_agents = set(self.agents.keys())
        except Exception as e:
            logger.error(f"加载代理启动配置失败: {e}")
            self.enabled_agents = set(self.agents.keys())
        
        # 回退：如果配置为空或无效，确保默认值
        if not self.enabled_agents and self.agents:
             self.enabled_agents = set(self.agents.keys())

        self._initialized = True

    def reload_agents(self):
        """扫描代理目录并加载所有配置。"""
        self.agents.clear()
        
        if not os.path.exists(self.agents_dir):
            logger.warning(f"代理目录未找到: {self.agents_dir}")
            # 如果不存在则创建默认目录
            try:
                os.makedirs(self.agents_dir)
                logger.info(f"已创建代理目录: {self.agents_dir}")
            except Exception as e:
                logger.error(f"创建代理目录失败: {e}")
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
                        logger.info(f"已加载代理: {profile.name} ({agent_id})")
                    except Exception as e:
                        logger.error(f"加载代理 {agent_id} 失败: {e}")
                else:
                    logger.debug(f"跳过目录 {agent_id}: 未找到 config.json")

        if not self.agents:
            logger.warning("未加载任何代理！请检查 backend/agents 目录。")
        
        # 确保活跃代理在列表中，如果不在，重置为第一个可用的或 'pero'
        if self.active_agent_id not in self.agents and self.agents:
             self.active_agent_id = next(iter(self.agents))

    def _load_agent_config(self, agent_id: str, config_path: str, prompt_path: str) -> AgentProfile:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        
        agent_dir = os.path.dirname(config_path)
        
        # 加载人设内容的辅助函数
        def load_persona(type_key: str, legacy_key: str) -> str:
            # 首先尝试从文件加载
            personas = config.get("personas", {})
            if type_key in personas:
                rel_path = personas[type_key]
                abs_path = os.path.join(agent_dir, rel_path)
                try:
                    if os.path.exists(abs_path):
                        with open(abs_path, "r", encoding="utf-8") as pf:
                            return pf.read()
                    else:
                        logger.warning(f"人设文件未找到: {abs_path}")
                except Exception as e:
                    logger.error(f"读取人设文件 {abs_path} 错误: {e}")
            
            # 回退到配置中的旧键
            return config.get(legacy_key, "")

        work_persona = load_persona("work", "work_custom_persona")
        social_persona = load_persona("social", "social_custom_persona")
        
        # 处理特征 (新嵌套结构 vs 旧扁平结构)
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
            logger.info(f"已切换活跃代理为: {agent_id}")
            return True
        logger.warning(f"无法切换到未知代理: {agent_id}")
        return False

    def set_enabled_agents(self, agent_ids: List[str]):
        """设置已启用的代理列表。"""
        valid_ids = [aid.lower() for aid in agent_ids if aid.lower() in self.agents]
        self.enabled_agents = set(valid_ids)
        logger.info(f"已启用代理更新: {self.enabled_agents}")
        
        # 如果活跃代理不在启用列表中，警告或切换？
        # 目前仅警告，因为用户可能是在为未来配置。
        if self.active_agent_id not in self.enabled_agents and self.enabled_agents:
            logger.warning(f"活跃代理 {self.active_agent_id} 不在启用列表中！")

    def get_enabled_agents(self) -> List[str]:
        return list(self.enabled_agents)

    def is_agent_enabled(self, agent_id: str) -> bool:
        return agent_id.lower() in self.enabled_agents

    def list_agents(self) -> List[Dict[str, Any]]:
        # 防御性编程：如果未加载代理，尝试重新加载一次
        if not self.agents:
            logger.info("内存中未找到代理，尝试重新加载...")
            self.reload_agents()
            # 如果仍然为空，确保 enabled_agents 也被清除以避免不一致
            if not self.agents:
                self.enabled_agents.clear()
            else:
                # 如果已加载，且没有启用任何代理，则默认启用所有 (首次运行场景)
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

# 全局实例访问器
_agent_manager_instance = None

def get_agent_manager() -> AgentManager:
    global _agent_manager_instance
    if _agent_manager_instance is None:
        _agent_manager_instance = AgentManager()
    return _agent_manager_instance
