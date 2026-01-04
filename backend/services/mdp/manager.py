import os
import re
import yaml
import logging
from typing import Dict, Any, Optional, List, Set

logger = logging.getLogger(__name__)

class MDPrompt:
    """
    Represents a Modular Dynamic Prompt (MDP).
    Stores metadata (frontmatter) and content.
    """
    def __init__(self, name: str, content: str, metadata: Dict[str, Any]):
        self.name = name
        self.content = content
        self.metadata = metadata
        self.version = metadata.get("version", "1.0")
        self.description = metadata.get("description", "")
        # Extract variables from content using regex {{variable}}
        self.variables = set(re.findall(r"\{\{([a-zA-Z0-9_]+)\}\}", content))

class MDPManager:
    """
    Manages loading, caching, and rendering of Modular Dynamic Prompts.
    """
    def __init__(self, prompt_dir: str):
        self.prompt_dir = prompt_dir
        self.prompts: Dict[str, MDPrompt] = {}
        self.cache_enabled = True
        
        # Initial load
        self.reload_all()

    def reload_all(self):
        """Reloads all prompts from the disk."""
        self.prompts.clear()
        if not os.path.exists(self.prompt_dir):
            logger.warning(f"MDP prompt directory not found: {self.prompt_dir}")
            return

        for root, _, files in os.walk(self.prompt_dir):
            for file in files:
                if file.endswith(".md") or file.endswith(".txt"):
                    file_path = os.path.join(root, file)
                    try:
                        self._load_file(file_path)
                    except Exception as e:
                        logger.error(f"Failed to load prompt file {file_path}: {e}")
        
        logger.info(f"Loaded {len(self.prompts)} MDP prompts from {self.prompt_dir}")

    def _load_file(self, file_path: str):
        """Parses a single file with frontmatter."""
        filename = os.path.basename(file_path)
        name = os.path.splitext(filename)[0]
        
        with open(file_path, "r", encoding="utf-8") as f:
            raw_content = f.read()

        # Parse frontmatter
        content = raw_content
        metadata = {}
        
        # Check for YAML frontmatter block
        match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", raw_content, re.DOTALL)
        if match:
            yaml_block = match.group(1)
            content = match.group(2)
            try:
                metadata = yaml.safe_load(yaml_block) or {}
            except yaml.YAMLError as e:
                logger.error(f"YAML error in {filename}: {e}")
        
        self.prompts[name] = MDPrompt(name, content.strip(), metadata)

    def get_prompt(self, name: str) -> Optional[MDPrompt]:
        return self.prompts.get(name)

    def render(self, template_name: str, context: Dict[str, Any] = None) -> str:
        """
        Renders a prompt by name, recursively resolving variables.
        
        Args:
            template_name: The name of the prompt file (without extension).
            context: Dictionary of variables to inject.
            
        Returns:
            The rendered string.
        """
        if context is None:
            context = {}
            
        if template_name not in self.prompts:
            # Fallback: if not found, maybe it's a raw string or missing
            # For now, return a warning or empty string
            logger.warning(f"Prompt template '{template_name}' not found.")
            return f"{{{{Missing Prompt: {template_name}}}}}"

        prompt = self.prompts[template_name]
        return self._recursive_render(prompt.content, context, set())

    def _recursive_render(self, text: str, context: Dict[str, Any], active_stack: Set[str]) -> str:
        """
        Internal recursive renderer.
        Handles {{variable}} replacement where variable can be:
        1. A key in the context dict.
        2. Another MDP prompt name (dynamic inclusion).
        """
        def replace_match(match):
            key = match.group(1)
            
            # 1. Check recursion loop
            if key in active_stack:
                logger.error(f"Circular dependency detected for variable '{key}'")
                return f"{{{{Circular: {key}}}}}"

            # 2. Priority: Context Variable
            if key in context:
                value = context[key]
                # If the value itself is a string that might contain variables, we could choose to render it too.
                # But typically context variables are final values. 
                # However, if we want full flexibility:
                if isinstance(value, str) and "{{" in value:
                     # Add current key to stack to prevent infinite loop if value refers back to key (unlikely but possible)
                    return self._recursive_render(value, context, active_stack | {key})
                return str(value)

            # 3. Priority: MDP Prompt (Sub-template)
            if key in self.prompts:
                sub_prompt = self.prompts[key]
                # Recursive render of the sub-prompt
                return self._recursive_render(sub_prompt.content, context, active_stack | {key})

            # 4. Fallback: Keep as is (maybe it's intended for later processing or invalid)
            # Or return empty string? Keeping it makes debugging easier.
            return f"{{{{{key}}}}}"

        # Regex to find {{key}}
        # Non-greedy match for content inside {{ }}
        return re.sub(r"\{\{([a-zA-Z0-9_]+)\}\}", replace_match, text)

