from abc import ABC, abstractmethod
from typing import Dict, Any, List

class BasePreprocessor(ABC):
    """
    所有消息预处理器的抽象基类。
    预处理器接收当前处理上下文，对其进行修改，然后返回。
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """返回预处理器的唯一名称。"""
        pass

    @abstractmethod
    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        处理上下文。

        Args:
            context: 一个字典，至少包含：
                     - 'messages': List[Dict[str, str]] (目前的对话历史)
                     - 'variables': Dict[str, Any] (用于提示词渲染的变量)
                     - 'session': AsyncSession (数据库会话)
                     - 'user_input': str (当前用户输入，如果有)

        Returns:
            修改后的上下文。
        """
        pass
