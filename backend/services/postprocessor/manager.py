from typing import List, Dict, Any, AsyncIterable
import logging
from .base import BasePostprocessor

logger = logging.getLogger(__name__)

class PostprocessorManager:
    """
    Manages and executes a pipeline of postprocessors.
    Supports both batch processing and streaming processing.
    """
    def __init__(self):
        self.postprocessors: List[BasePostprocessor] = []

    def register(self, postprocessor: BasePostprocessor):
        """Register a new postprocessor to the end of the pipeline."""
        self.postprocessors.append(postprocessor)
        # logger.info(f"Registered postprocessor: {postprocessor.name}")

    async def process(self, content: str, context: Dict[str, Any]) -> str:
        """
        Run the content through all registered postprocessors in order (Batch).
        """
        current_content = content
        for processor in self.postprocessors:
            try:
                # logger.debug(f"Running postprocessor: {processor.name}")
                current_content = await processor.process(current_content, context)
            except Exception as e:
                logger.error(f"后处理器 {processor.name} (批处理) 出错: {e}", exc_info=True)
        
        return current_content

    async def process_stream(self, stream: AsyncIterable[str], context: Dict[str, Any]) -> AsyncIterable[str]:
        """
        按顺序通过所有注册的后处理器运行流（流式）。
        """
        current_stream = stream
        for processor in self.postprocessors:
            try:
                # 每个处理器包装前一个流。
                # 假设 process_stream 是一个异步生成器函数 (async def ... yield)
                # 调用它会立即返回一个 AsyncGenerator。
                current_stream = processor.process_stream(current_stream, context)
            except Exception as e:
                logger.error(f"链接后处理器 {processor.name} 出错: {e}")
        
        async for chunk in current_stream:
            yield chunk
