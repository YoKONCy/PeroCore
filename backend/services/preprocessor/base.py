from abc import ABC, abstractmethod
from typing import Dict, Any, List

class BasePreprocessor(ABC):
    """
    Abstract base class for all message preprocessors.
    A preprocessor takes the current processing context, modifies it, and returns it.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the unique name of the preprocessor."""
        pass

    @abstractmethod
    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process the context.
        
        Args:
            context: A dictionary containing at least:
                     - 'messages': List[Dict[str, str]] (The conversation history so far)
                     - 'variables': Dict[str, Any] (Variables for prompt rendering)
                     - 'session': AsyncSession (Database session)
                     - 'user_input': str (The current user input, if any)
                     
        Returns:
            The modified context.
        """
        pass
