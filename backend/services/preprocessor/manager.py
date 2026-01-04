from typing import List, Dict, Any
import logging
from .base import BasePreprocessor

logger = logging.getLogger(__name__)

class PreprocessorManager:
    """
    Manages and executes a pipeline of preprocessors.
    """
    def __init__(self):
        self.preprocessors: List[BasePreprocessor] = []

    def register(self, preprocessor: BasePreprocessor):
        """Register a new preprocessor to the end of the pipeline."""
        self.preprocessors.append(preprocessor)
        # logger.info(f"Registered preprocessor: {preprocessor.name}")

    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Run the context through all registered preprocessors in order.
        """
        current_context = context
        for processor in self.preprocessors:
            try:
                # logger.debug(f"Running preprocessor: {processor.name}")
                current_context = await processor.process(current_context)
            except Exception as e:
                logger.error(f"Error in preprocessor {processor.name}: {e}", exc_info=True)
                # Decide whether to halt or continue. For now, we continue but log error.
                # In a robust system, we might want to flag this in the context.
                current_context["errors"] = current_context.get("errors", []) + [f"{processor.name}: {str(e)}"]
        
        return current_context
