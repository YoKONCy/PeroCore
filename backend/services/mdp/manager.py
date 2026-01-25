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
        # 使用 FileSystemLoader 以支持加载外部 Agent 目录
        loaders = [jinja2.DictLoader(prompts_content_map)]
        
        # 尝试加载内部 Agent 目录 (现在位于 mdp/agents)
        try:
            # prompt_dir = .../backend/services/mdp/prompts
            # mdp_dir = .../backend/services/mdp
            mdp_dir = os.path.dirname(os.path.abspath(self.prompt_dir))
            agents_dir = os.path.join(mdp_dir, "agents")
            
            if os.path.exists(agents_dir):
                loaders.append(jinja2.FileSystemLoader(agents_dir))
                logger.info(f"MDP: 已添加 Agent 目录到加载路径: {agents_dir}")
                
                # 同时扫描 agents 目录下的 .md 文件并加入 prompts_content_map
                # 这样可以直接通过 key 访问，而不只是通过 FileSystemLoader
                for root, _, files in os.walk(agents_dir):
                    for file in files:
                        if file.endswith(".md"):
                            file_path = os.path.join(root, file)
                            try:
                                rel_path = os.path.relpath(file_path, agents_dir)
                                rel_path = rel_path.replace("\\", "/")
                                # 为了避免冲突，可以给 agent 的 prompt 加个前缀，或者直接用路径
                                # 例如 pero/system_prompt
                                key = os.path.splitext(rel_path)[0]
                                
                                # 注意：这里不解析 frontmatter，因为 agent 的 prompt 通常就是纯文本或简单的 md
                                # 但为了统一，如果需要解析也可以调用 _load_file
                                # 这里我们简单读取内容
                                with open(file_path, "r", encoding="utf-8") as f:
                                     content = f.read()
                                     # 简单的 frontmatter 剥离如果需要
                                     if content.startswith("---"):
                                         _, _, content = content.split("---", 2)
                                     
                                     # Strip HTML comments
                                     content = re.sub(r'<!--[\s\S]*?-->', '', content)
                                         
                                prompts_content_map[key] = content.strip()
                                logger.info(f"MDP: 已索引 Agent Prompt: {key}")
                                
                            except Exception as e:
                                logger.warning(f"MDP: 索引 Agent Prompt 失败 {file}: {e}")

        except Exception as e:
            logger.warning(f"MDP: 无法添加 Agent 目录: {e}")

        self.jinja_env = jinja2.Environment(
            loader=jinja2.ChoiceLoader(loaders),
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
        
        # Strip HTML comments
        content = re.sub(r'<!--[\s\S]*?-->', '', content)
        
        return MDPrompt(key, content.strip(), metadata, key)

    def get_prompt(self, name: str) -> Optional[MDPrompt]:
        """
        获取提示词对象。
        注意：对于外部 Agent 目录中的文件，由于没有在 reload_all 中预加载到 self.prompts，
        此方法可能返回 None，但这并不代表 Jinja2 无法渲染它。
        """
        return self.prompts.get(name)

    def render(self, template_name: str, context: Dict[str, Any] = None) -> str:
        """
        使用 Jinja2 递归解析渲染提示词。
        
        Args:
            template_name: 提示词文件键 (例如 "tasks/scorer_summary" 或 "agent_id/system_prompt")
            context: 要注入的变量
            
        Returns:
            渲染后的字符串
        """
        if context is None:
            context = {}
            
        if not self.jinja_env:
            return f"{{{{Error: Jinja2 not initialized}}}}"

        # ---------------------------------------------------------
        # 支持 Agent 专属覆盖
        # 如果 context 中包含 agent_name，优先尝试加载 agents/{agent_name}/{template_name}
        # ---------------------------------------------------------
        agent_name = context.get("agent_name")
        target_template_name = template_name
        
        if agent_name:
            # 构造覆盖路径，例如 "pero/core/abilities/work_log"
            # 注意：agent_name 对应的目录必须在 FileSystemLoader 的根目录下 (即 mdp/agents)
            override_name = f"{agent_name}/{template_name}"
            
            # 检查 override 是否存在
            # 我们可以简单地尝试 get_template
            found_override = False
            try:
                self.jinja_env.get_template(override_name)
                target_template_name = override_name
                found_override = True
                logger.debug(f"MDP: 使用 Agent 覆盖提示词: {override_name}")
            except jinja2.TemplateNotFound:
                # 尝试 .md
                try:
                    self.jinja_env.get_template(f"{override_name}.md")
                    target_template_name = f"{override_name}.md"
                    found_override = True
                    logger.debug(f"MDP: 使用 Agent 覆盖提示词: {override_name}.md")
                except jinja2.TemplateNotFound:
                    pass
            
            if not found_override:
                # 仅在调试模式下记录，避免日志刷屏
                pass

        try:
            # 步骤 1: 初始渲染
            template = None
            try:
                template = self.jinja_env.get_template(target_template_name)
            except jinja2.TemplateNotFound:
                # 尝试添加 .md 后缀 (针对 FileSystemLoader)
                try:
                    template = self.jinja_env.get_template(f"{target_template_name}.md")
                except jinja2.TemplateNotFound:
                    pass

            if not template:
                 logger.warning(f"提示词模板 '{target_template_name}' (及其 .md 变体) 未找到。 (Original request: {template_name})")
                 return f"{{{{Missing Prompt: {template_name}}}}}"

            rendered = template.render(**context)
            
            # 步骤 2: 递归展开
            # 我们循环最多 5 次以解析嵌套变量 (例如 {{ persona }} -> content)
            max_depth = 5
            for _ in range(max_depth):
                if "{{" not in rendered:
                    break
                
                # 扫描剩余的 {{ var }}，支持隐式包含
                matches = re.findall(r"\{\{\s*([a-zA-Z0-9_./]+)\s*\}\}", rendered)
                new_context = context.copy()
                
                for var in matches:
                    # 如果 var 不在上下文中但作为提示词存在，则注入它
                    if var not in new_context and var in self.prompts:
                        new_context[var] = self.prompts[var].content
                
                # 即使没有从 prompts 加载新变量，上下文中可能已包含需要展开的变量（如 chain_logic）。
                # 因此，只要发现 {{}} 占位符，就尝试使用当前上下文再次渲染。
                # 通过比较渲染前后的结果来检测是否收敛，防止因无法解析的变量导致的死循环。
                prev_rendered = rendered
                rendered = self.jinja_env.from_string(rendered).render(**new_context)
                
                if rendered == prev_rendered:
                    # 没有变化，说明剩余的 {{}} 无法被当前 context 解析
                    break
                    
                # 如果有变化，说明展开成功（无论是通过新注入的提示词，还是已有的 context）
                # 继续下一轮循环

            
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
