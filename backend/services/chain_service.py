from typing import List, Dict, Any, Optional
import os
import sys

# 如果独立运行，确保 backend 路径在 sys.path 中
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.dirname(current_dir)
if backend_dir not in sys.path:
    sys.path.append(backend_dir)

# from services.vector_service import VectorService # 已弃用
from services.embedding_service import embedding_service
from services.memory_service import MemoryService
from services.mdp.manager import mdp
from core.config_manager import get_config_manager

class ThinkingChainService:
    def __init__(self):
        # self.vector_service = VectorService() # 已移除依赖
        self.embedding_service = embedding_service
        
        # 定义标准链（思维链）
        self.chains = {
            "DeepCoding": [
                {"cluster": "逻辑推理簇", "k": 3, "desc": "相关技术原理与逻辑"},
                {"cluster": "历史报错簇", "k": 2, "desc": "相关的历史报错经验"},
                {"cluster": "创造灵感簇", "k": 2, "desc": "可能的优化思路"}
            ],
            "ProjectPlanning": [
                {"cluster": "计划意图簇", "k": 3, "desc": "相关的计划与目标"},
                {"cluster": "逻辑推理簇", "k": 3, "desc": "类似项目的实施方案"},
                {"cluster": "反思簇", "k": 2, "desc": "过往项目的避坑指南"}
            ],
            "Reflection": [
                {"cluster": "反思簇", "k": 5, "desc": "过往的反思与总结"},
                {"cluster": "计划意图簇", "k": 3, "desc": "相关的改进计划"},
                {"cluster": "情感偏好簇", "k": 2, "desc": "当时的情感状态"}
            ],
            "CasualChat": [
                {"cluster": "闲聊簇", "k": 3, "desc": "过往闲聊话题"},
                {"cluster": "人际关系簇", "k": 2, "desc": "相关的社交记忆"}
            ]
        }

    def route_chain(self, query: str) -> Optional[str]:
        """
        根据查询确定使用哪个链。
        返回链名称或 None（用于默认处理）。
        """
        import re
        
        query = query.lower()
        
        # 1. DeepCoding 触发器
        # 关键字：code, error, bug, python, js, api, implementation, function, class
        coding_keywords = [
            r"代码", r"报错", r"bug", r"python", r"javascript", r"typescript", r"api", 
            r"函数", r"类", r"怎么写", r"实现", r"优化", r"refactor", r"debug", r"sql", r"database"
        ]
        if any(re.search(k, query) for k in coding_keywords):
            return "DeepCoding"
            
        # 2. ProjectPlanning 触发器
        # 关键字：plan, scheme, roadmap, step, goal
        planning_keywords = [
            r"计划", r"方案", r"路线图", r"步骤", r"目标", r"规划", r"安排", r"项目", r"todo", r"待办"
        ]
        if any(re.search(k, query) for k in planning_keywords):
            return "ProjectPlanning"

        # 3. Reflection 触发器
        # 关键字：reflect, summary, mistake, improve, review
        reflection_keywords = [
            r"反思", r"总结", r"复盘", r"哪里错", r"改进", r"教训", r"回顾"
        ]
        if any(re.search(k, query) for k in reflection_keywords):
            return "Reflection"
            
        # 默认：无特定链（日常聊天使用标准 RAG 或不使用）
        return None

    async def execute_chain(self, session: Any, chain_name: str, query: str, agent_id: str = "pero") -> Dict[str, Any]:
        """
        执行思维链检索。
        返回结构化结果：
        {
            "chain_name": str,
            "steps": [
                {
                    "cluster": str,
                    "memories": [ ... ]
                }
            ]
        }
        """
        if chain_name not in self.chains:
            # 如果未找到链，回退到简单搜索
            print(f"[ThinkingChain] Chain '{chain_name}' not found. Returning empty.")
            return {"chain_name": chain_name, "steps": [], "error": "Chain not found"}

        chain_steps = self.chains[chain_name]
        query_embedding = self.embedding_service.encode_one(query)
        
        results = {
            "chain_name": chain_name,
            "steps": []
        }

        print(f"[ThinkingChain] Executing chain '{chain_name}' for query: {query}")

        for step in chain_steps:
            cluster_name = step["cluster"]
            k = step["k"]
            desc = step.get("desc", "")
            
            # 构建过滤器：{"cluster_Name": True}
            # 注意：我们将 "cluster_Name" 存储在元数据中（展开）
            filter_criteria = {f"cluster_{cluster_name}": True}
            
            try:
                # 使用 MemoryService (Vector + Filter)
                # 因为我们需要聚类过滤，我们使用 search_memories_simple，但它需要 Rust 中的过滤器支持？
                # Rust 索引不支持元数据过滤器。
                # 所以 search_memories_simple 从向量搜索中获取候选项，然后在 SQLite 中过滤。
                # 然而，对于特定聚类，如果聚类较小/稀有，向量搜索可能无法返回足够的候选项。
                # 理想情况下，如果我们只关心聚类，应该使用 get_memories_by_filter，但我们也想要相关性。
                # 让我们使用 search_memories_simple。
                
                memories = await MemoryService.search_memories_simple(
                    session=session,
                    query_vec=query_embedding,
                    limit=k,
                    filter_criteria=filter_criteria,
                    agent_id=agent_id
                )
            except Exception as e:
                print(f"[ThinkingChain] Error searching cluster '{cluster_name}': {e}")
                memories = []
            
            results["steps"].append({
                "cluster": cluster_name,
                "description": desc,
                "memories": memories
            })
            
        return results

    def format_chain_result(self, chain_result: Dict[str, Any]) -> str:
        """
        将链结果格式化为 LLM 上下文的字符串。
        实现 "惯性通道" (Inertia Channel) 效果。
        """
        if "error" in chain_result:
            return ""

        output = []
        output.append(f"### 启动思维链: {chain_result['chain_name']}")
        
        has_content = False
        for step in chain_result.get("steps", []):
            cluster = step["cluster"]
            desc = step["description"]
            memories = step["memories"]
            
            if not memories:
                continue
            
            has_content = True
            output.append(f"\n#### [{cluster}] - {desc}")
            for i, mem in enumerate(memories, 1):
                content = mem.get("document", "")
                # 元数据可能包含时间戳等。
                meta = mem.get("metadata", {})
                ts = meta.get("timestamp", "Unknown Time")
                # 添加分数用于调试/透明度？可能不需要用于最终提示词。
                output.append(f"{i}. [{ts}] {content}")
        
        if not has_content:
            return ""
            
        return "\n".join(output)

    async def generate_weekly_report_context(self, session: Any, agent_id: str = "pero") -> str:
        """
        生成周报上下文（主题回顾）。
        获取过去 7 天的记忆，以及相关的历史记忆。
        """
        import time
        from datetime import datetime
        
        # 计算 7 天前的时间戳（毫秒）
        now_ms = time.time() * 1000
        one_week_ago = now_ms - (7 * 24 * 3600 * 1000)
        
        # 定义要回顾的聚类
        clusters_to_review = ["逻辑推理簇", "反思簇", "计划意图簇", "创造灵感簇"]
        
        output = ["### 自动化周报生成上下文 (Thinking Pipeline Phase 2)"]
        output.append(f"Report Period: {datetime.fromtimestamp(one_week_ago/1000).strftime('%Y-%m-%d')} to {datetime.now().strftime('%Y-%m-%d')}")
        
        has_content = False
        all_weekly_contents = [] # 存储用于历史搜索
        
        for cluster in clusters_to_review:
            # 过滤器：聚类匹配且时间戳 >= one_week_ago
            filter_criteria = {
                "$and": [
                    {f"cluster_{cluster}": True},
                    {"timestamp": {"$gte": one_week_ago}}
                ]
            }
            
            # 每个聚类最多获取 8 个条目用于报告（从 20 减少以避免上下文溢出）
            # 使用 MemoryService.get_memories_by_filter
            memories = await MemoryService.get_memories_by_filter(
                session=session,
                limit=8,
                filter_criteria=filter_criteria,
                agent_id=agent_id
            )
            
            if not memories:
                continue
            
            has_content = True
            output.append(f"\n#### [{cluster}] (本周)")
            
            # 按重要性（如果元数据中可用）降序排序
            # 元数据重要性通常为 1-10
            memories.sort(key=lambda x: x.get("metadata", {}).get("importance", 1), reverse=True)
            
            for i, mem in enumerate(memories, 1):
                content = mem.get("document", "")
                if len(content) > 300:
                     content = content[:300] + "..." # 截断长内容
                
                all_weekly_contents.append(content) # 收集用于历史搜索
                
                meta = mem.get("metadata", {})
                ts_val = meta.get("timestamp", 0)
                try:
                    ts_str = datetime.fromtimestamp(ts_val/1000).strftime('%Y-%m-%d %H:%M')
                except:
                    ts_str = str(ts_val)
                    
                output.append(f"- [{ts_str}] {content}")
        
        # [特性] 跨时间上下文关联
        # 搜索早于 7 天的相关记忆
        if all_weekly_contents:
            output.append("\n#### [历史回响] (关联的过往记忆)")
            # 从本周内容创建摘要查询（取前 3 个最长的条目作为重要性的代理）
            top_contents = sorted(all_weekly_contents, key=len, reverse=True)[:3]
            combined_query = " ".join(top_contents)[:1000] # 限制长度
            
            query_vec = self.embedding_service.encode_one(combined_query)
            
            # 使用过滤器搜索：timestamp < one_week_ago
            hist_filter = {"timestamp": {"$lt": one_week_ago}}
            
            hist_memories = await MemoryService.search_memories_simple(
                session=session,
                query_vec=query_vec,
                limit=5,
                filter_criteria=hist_filter,
                agent_id=agent_id
            )
            
            if hist_memories:
                for mem in hist_memories:
                    content = mem.get("document", "")
                    meta = mem.get("metadata", {})
                    ts_val = meta.get("timestamp", 0)
                    score = mem.get("score", 0)
                    if score < 0.4: continue # 过滤低相关性
                    
                    try:
                        ts_str = datetime.fromtimestamp(ts_val/1000).strftime('%Y-%m-%d')
                    except:
                        ts_str = "Unknown"
                    output.append(f"- [{ts_str}] {content}")
            else:
                output.append("(无显著相关的历史记忆)")

        # 4. 限制控制以避免 Token 爆炸
        # 计算估计的 Token（粗略估计：中英文混合 1 token ≈ 1.5 字符）
        # 我们的目标是最大约 6000 token 上下文，以便对于 8k/32k 模型是安全的
        # 6000 token ≈ 9000 字符。让我们设置一个 10000 字符的安全硬限制。
        
        full_text = "\n".join(output)
        
        if len(full_text) > 10000:
            print(f"[ThinkingChain] Context too long ({len(full_text)} chars), enforcing strict truncation...")
            
            # 策略：保留头部 + 回响 + 高重要性周报条目
            # 我们已经按重要性对周报条目进行了排序。
            # 所以简单地从每个部分的顶部切片是有效的，但 'output' 现在是一个扁平列表。
            # 我们需要小心地重建它，或者直接粗暴地切掉中间部分。
            
            # 更好的方法：保留前 20 行（头部 + 回响通常在底部？不，回响是最后添加的）
            # 等等，回响是最后添加的。
            # 结构：[Header] ... [Cluster A] ... [Cluster B] ... [Echoes]
            
            # 为了保留回响（非常有价值），我们应该从中间切掉（周报详情）。
            
            safe_output = []
            safe_output.extend(output[:5]) # Header + Date
            
            # Calculate remaining budget
            remaining_chars = 9000 - len("\n".join(safe_output))
            
            # 获取回响（通常是最后几项，查找 "历史回响"）
            echo_items = []
            weekly_items = []
            
            in_echo_section = False
            for line in output[5:]:
                if "历史回响" in line:
                    in_echo_section = True
                
                if in_echo_section:
                    echo_items.append(line)
                else:
                    weekly_items.append(line)
            
            # 将回响添加到安全输出（它们很关键）
            # 如果回响本身很大，也截断它们
            if len("\n".join(echo_items)) > 2000:
                echo_items = echo_items[:10] + ["... (More historical echoes truncated)"]
            
            remaining_chars -= len("\n".join(echo_items))
            
            # 用周报条目填充剩余预算
            current_chars = 0
            for item in weekly_items:
                if current_chars + len(item) < remaining_chars:
                    safe_output.append(item)
                    current_chars += len(item)
                else:
                    safe_output.append("... (Remaining weekly items truncated for safety) ...")
                    break
            
            safe_output.extend(echo_items)
            output = safe_output
            
        return "\n".join(output)

    async def generate_weekly_report(self, session: Any, agent_id: str = "pero") -> str:
        """
        使用 LLM 生成实际的周报。
        """
        from sqlmodel import select
        from models import AIModelConfig
        from services.llm_service import LLMService

        context = await self.generate_weekly_report_context(session, agent_id=agent_id)
        if "No activities found" in context:
            return ""

        # 获取活跃的 LLM 配置
        # 优先查找名为 "对话模型" 的配置，如果找不到则使用任意一个
        result = await session.exec(select(AIModelConfig).where(AIModelConfig.name == "对话模型"))
        model_config = result.first()
        
        if not model_config:
            # Fallback: get first available model
            result = await session.exec(select(AIModelConfig))
            model_config = result.first()
        
        if not model_config:
            print("[ThinkingChain] No active model config found for weekly report.")
            return ""

        llm = LLMService(
            api_key=model_config.api_key,
            api_base=model_config.api_base,
            model=model_config.model_id,
            provider=model_config.provider
        )

        from datetime import datetime
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M')
        
        config_manager = get_config_manager()
        bot_name = config_manager.get("bot_name", "Pero")

        # Get Agent Profile for dynamic persona injection
        agent_manager = AgentManager()
        agent_profile = agent_manager.agents.get(agent_manager.active_agent_id)
        identity_label = agent_profile.identity_label if agent_profile else "智能助手"

        prompt = mdp.render("services/analysis/weekly_report", {
            "agent_name": bot_name,
            "current_time": now_str,
            "context": context,
            "identity_label": identity_label
        })
        try:
            messages = [{"role": "user", "content": prompt}]
            response = await llm.chat(messages)
            content = response["choices"][0]["message"]["content"]
            return content
        except Exception as e:
            print(f"[ThinkingChain] Error generating weekly report: {e}")
            return ""

# 单例实例
chain_service = ThinkingChainService()
