from abc import ABC, abstractmethod
from typing import Dict, Any, AsyncIterable

class BasePostprocessor(ABC):
    """
    所有消息后处理器的抽象基类。
    后处理器接收生成的内容（或流），对其进行修改，然后返回。
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """返回后处理器的唯一名称。"""
        pass

    @abstractmethod
    async def process(self, content: str, context: Dict[str, Any]) -> str:
        """
        处理完整内容（批处理模式）。
        
        Args:
            content: 要处理的完整文本内容。
            context: 包含元数据的字典（例如，target='memory', 'ui' 等）。
                     
        Returns:
            修改后的内容。
        """
        pass

    async def process_stream(self, stream: AsyncIterable[str], context: Dict[str, Any]) -> AsyncIterable[str]:
        """
        处理内容流（流模式）。
        
        默认实现按原样返回流。
        如果后处理器需要过滤/修改流式 token，请覆盖此方法。
        
        Args:
            stream: 字符串块的异步可迭代对象。
            context: 上下文元数据。
            
        Yields:
            修改后的字符串块。
        """
        async for chunk in stream:
            yield chunk
