from abc import ABC, abstractmethod
from typing import Dict, Any, AsyncIterable

class BasePostprocessor(ABC):
    """
    Abstract base class for all message postprocessors.
    A postprocessor takes the generated content (or stream), modifies it, and returns it.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the unique name of the postprocessor."""
        pass

    @abstractmethod
    async def process(self, content: str, context: Dict[str, Any]) -> str:
        """
        Process the full content (Batch mode).
        
        Args:
            content: The full text content to process.
            context: A dictionary containing metadata (e.g., target='memory', 'ui', etc.)
                     
        Returns:
            The modified content.
        """
        pass

    async def process_stream(self, stream: AsyncIterable[str], context: Dict[str, Any]) -> AsyncIterable[str]:
        """
        Process the content stream (Streaming mode).
        
        Default implementation returns the stream as-is.
        Override this if the postprocessor needs to filter/modify streaming tokens.
        
        Args:
            stream: An async iterable of string chunks.
            context: Context metadata.
            
        Yields:
            Modified string chunks.
        """
        async for chunk in stream:
            yield chunk
