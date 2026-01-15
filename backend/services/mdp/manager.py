import os
import re
import yaml
import logging
from typing import Dict, Any, Optional, List, Set

logger = logging.getLogger(__name__)

class MDPrompt:
    """
    表示一个模块化动态提示词 (MDP)。
    存储元数据 (frontmatter) 和内容。
    """
    def __init__(self, name: str, content: str, metadata: Dict[str, Any]):
        self.name = name
        self.content = content
        self.metadata = metadata
        self.version = metadata.get("version", "1.0")
        self.description = metadata.get("description", "")
        # 使用正则表达式 {{variable}} 从内容中提取变量
        self.variables = set(re.findall(r"\{\{([a-zA-Z0-9_]+)\}\}", content))

class MDPManager:
    """
    管理模块化动态提示词的加载、缓存和渲染。
    """
    def __init__(self, prompt_dir: str):
        self.prompt_dir = prompt_dir
        self.prompts: Dict[str, MDPrompt] = {}
        self.cache_enabled = True
        
        # 初始加载
        self.reload_all()

    def reload_all(self):
        """从磁盘重新加载所有提示词。"""
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
        """解析带有 frontmatter 的单个文件。"""
        filename = os.path.basename(file_path)
        name = os.path.splitext(filename)[0]
        
        with open(file_path, "r", encoding="utf-8") as f:
            raw_content = f.read()

        # 解析 frontmatter
        content = raw_content
        metadata = {}
        
        # 检查 YAML frontmatter 块
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
        按名称渲染提示词，递归解析变量。
        
        Args:
            template_name: 提示词文件名（不带扩展名）。
            context: 要注入的变量字典。
            
        Returns:
            渲染后的字符串。
        """
        if context is None:
            context = {}
            
        if template_name not in self.prompts:
            # 回退：如果未找到，也许它是一个原始字符串或丢失了
            # 目前，返回警告或空字符串
            logger.warning(f"Prompt template '{template_name}' not found.")
            return f"{{{{Missing Prompt: {template_name}}}}}"

        prompt = self.prompts[template_name]
        return self._recursive_render(prompt.content, context, set())

    def _recursive_render(self, text: str, context: Dict[str, Any], active_stack: Set[str]) -> str:
        """
        内部递归渲染器。
        处理 {{variable}} 替换，其中 variable 可以是：
        1. context 字典中的键。
        2. 另一个 MDP 提示词名称（动态包含）。
        """
        def replace_match(match):
            key = match.group(1)
            
            # 1. 检查递归循环
            if key in active_stack:
                logger.error(f"Circular dependency detected for variable '{key}'")
                return f"{{{{Circular: {key}}}}}"

            # 2. 优先级：上下文变量
            if key in context:
                value = context[key]
                # 如果值本身是一个可能包含变量的字符串，我们可以选择也渲染它。
                # 但通常上下文变量是最终值。
                # 但是，如果我们想要完全的灵活性：
                if isinstance(value, str) and "{{" in value:
                     # 将当前键添加到堆栈以防止死循环，如果值引用回键（不太可能但可能）
                    return self._recursive_render(value, context, active_stack | {key})
                return str(value)

            # 3. 优先级：MDP 提示词（子模板）
            if key in self.prompts:
                sub_prompt = self.prompts[key]
                # 递归渲染子提示词
                return self._recursive_render(sub_prompt.content, context, active_stack | {key})

            # 4. 回退：保持原样（也许它是为了稍后处理或无效）
            # 或者返回空字符串？保持它使调试更容易。
            return f"{{{{{key}}}}}"

        # 查找 {{key}} 的正则表达式
        # 对 {{ }} 内的内容进行非贪婪匹配
        return re.sub(r"\{\{([a-zA-Z0-9_]+)\}\}", replace_match, text)

