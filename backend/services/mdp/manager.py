import os
import re
import yaml
import logging
from typing import Dict, Any, Optional, Set
import jinja2

logger = logging.getLogger(__name__)

class MDPrompt:
    """
    表示一个模块化动态提示词 (MDP)。
    存储元数据 (frontmatter) 和内容。
    """
    def __init__(self, name: str, content: str, metadata: Dict[str, Any], path: str):
        self.name = name
        self.content = content
        self.metadata = metadata
        self.path = path # 相对路径键 (例如 "tasks/scorer_summary")
        self.version = metadata.get("version", "1.0")
        self.description = metadata.get("description", "")

class MDPManager:
    """
    管理模块化动态提示词的加载、缓存和渲染。
    支持递归 Jinja2 渲染。
    """
    def __init__(self, prompt_dir: str):
        self.prompt_dir = prompt_dir
        self.prompts: Dict[str, MDPrompt] = {}
        self.jinja_env = None
        
        # 初始加载
        self.reload_all()

    def reload_all(self):
        """从磁盘重新加载所有提示词并初始化 Jinja2 环境。"""
        self.prompts.clear()
        prompts_content_map = {}

        if not os.path.exists(self.prompt_dir):
            logger.warning(f"MDP 提示词目录未找到: {self.prompt_dir}")
            return

        for root, _, files in os.walk(self.prompt_dir):
            for file in files:
                if file.endswith(".md") or file.endswith(".txt"):
                    file_path = os.path.join(root, file)
                    try:
                        rel_path = os.path.relpath(file_path, self.prompt_dir)
                        # 将路径分隔符规范化为正斜杠以供 Jinja2 使用
                        rel_path = rel_path.replace("\\", "/")
                        # 键是没有扩展名的路径，例如 "tasks/scorer_summary"
                        key = os.path.splitext(rel_path)[0]
                        
                        prompt_obj = self._load_file(file_path, key)
                        self.prompts[key] = prompt_obj
                        prompts_content_map[key] = prompt_obj.content
                        
                        # 向后兼容：如果基名唯一，也注册基名
                        basename = os.path.splitext(file)[0]
                        if basename not in self.prompts:
                            self.prompts[basename] = prompt_obj
                            prompts_content_map[basename] = prompt_obj.content
                        
                    except Exception as e:
                        logger.error(f"加载提示词文件失败 {file_path}: {e}")
        
        # 初始化 Jinja2 环境
        # 我们使用 DictLoader 允许 {% include 'key' %}
        self.jinja_env = jinja2.Environment(
            loader=jinja2.DictLoader(prompts_content_map),
            autoescape=False, # 提示词是文本，不是 HTML
            variable_start_string="{{",
            variable_end_string="}}",
            undefined=jinja2.DebugUndefined # 保留未定义的变量为 {{ var }} 以便调试/部分渲染
        )
        
        logger.info(f"从 {self.prompt_dir} 加载了 {len(self.prompts)} 个 MDP 提示词")

    def _load_file(self, file_path: str, key: str) -> MDPrompt:
        """解析带有 frontmatter 的单个文件。"""
        with open(file_path, "r", encoding="utf-8") as f:
            raw_content = f.read()

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
                logger.error(f"文件 {file_path} 中存在 YAML 错误: {e}")
        
        return MDPrompt(key, content.strip(), metadata, key)

    def get_prompt(self, name: str) -> Optional[MDPrompt]:
        return self.prompts.get(name)

    def render(self, template_name: str, context: Dict[str, Any] = None) -> str:
        """
        使用 Jinja2 递归解析渲染提示词。
        
        Args:
            template_name: 提示词文件键 (例如 "tasks/scorer_summary" 或 "scorer_summary")
            context: 要注入的变量
            
        Returns:
            渲染后的字符串
        """
        if context is None:
            context = {}
            
        if not self.jinja_env:
            return f"{{{{Error: Jinja2 not initialized}}}}"

        if template_name not in self.prompts:
             logger.warning(f"提示词模板 '{template_name}' 未找到。")
             return f"{{{{Missing Prompt: {template_name}}}}}"
             
        try:
            # 步骤 1: 初始渲染
            template = self.jinja_env.get_template(template_name)
            rendered = template.render(**context)
            
            # 步骤 2: 递归展开
            # 我们循环最多 5 次以解析嵌套变量 (例如 {{ persona }} -> content)
            max_depth = 5
            for _ in range(max_depth):
                if "{{" not in rendered:
                    break
                
                # 扫描剩余的 {{ var }}，这些可能匹配提示词名称
                # 这支持隐式包含：如果 'my_sub_prompt' 是一个提示词键，{{ my_sub_prompt }} 将展开
                matches = re.findall(r"\{\{\s*([a-zA-Z0-9_./]+)\s*\}\}", rendered)
                new_context = context.copy()
                has_new_resolution = False
                
                for var in matches:
                    # 如果 var 不在上下文中但作为提示词存在，则注入它
                    if var not in new_context and var in self.prompts:
                        new_context[var] = self.prompts[var].content
                        has_new_resolution = True
                
                if not has_new_resolution:
                    # 如果没有找到新的匹配提示词的变量，停止以避免无限循环
                    # (除非我们假设变量可能由 Jinja 过滤器填充？不，我们坚持显式上下文/提示词)
                    break
                    
                # 再次渲染，将字符串视为模板
                rendered = self.jinja_env.from_string(rendered).render(**new_context)
            
            return rendered

        except Exception as e:
            logger.error(f"渲染提示词 '{template_name}' 时出错: {e}")
            return f"{{{{Error Rendering: {template_name}}}}}"

# 全局单例实例
_mdp_instance = None

def get_mdp_manager() -> MDPManager:
    global _mdp_instance
    if _mdp_instance is None:
        mdp_dir = os.path.join(os.path.dirname(__file__), "prompts")
        _mdp_instance = MDPManager(mdp_dir)
    return _mdp_instance

# 便于访问的别名
mdp = get_mdp_manager()
