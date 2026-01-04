from typing import List, Dict, Any, Optional
import os
import sys

# Ensure backend path is in sys.path if running standalone
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.dirname(current_dir)
if backend_dir not in sys.path:
    sys.path.append(backend_dir)

# from services.vector_service import VectorService # DEPRECATED
from services.embedding_service import embedding_service
from services.memory_service import MemoryService

class ThinkingChainService:
    def __init__(self):
        # self.vector_service = VectorService() # Removed dependency
        self.embedding_service = embedding_service
        
        # Define standard chains (Thinking Chains)
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
        Determine which chain to use based on the query.
        Returns the chain name or None (for default handling).
        """
        import re
        
        query = query.lower()
        
        # 1. DeepCoding Trigger
        # Keywords: code, error, bug, python, js, api, implementation, function, class
        coding_keywords = [
            r"代码", r"报错", r"bug", r"python", r"javascript", r"typescript", r"api", 
            r"函数", r"类", r"怎么写", r"实现", r"优化", r"refactor", r"debug", r"sql", r"database"
        ]
        if any(re.search(k, query) for k in coding_keywords):
            return "DeepCoding"
            
        # 2. ProjectPlanning Trigger
        # Keywords: plan, scheme, roadmap, step, goal
        planning_keywords = [
            r"计划", r"方案", r"路线图", r"步骤", r"目标", r"规划", r"安排", r"项目", r"todo", r"待办"
        ]
        if any(re.search(k, query) for k in planning_keywords):
            return "ProjectPlanning"

        # 3. Reflection Trigger
        # Keywords: reflect, summary, mistake, improve, review
        reflection_keywords = [
            r"反思", r"总结", r"复盘", r"哪里错", r"改进", r"教训", r"回顾"
        ]
        if any(re.search(k, query) for k in reflection_keywords):
            return "Reflection"
            
        # Default: No specific chain (Daily Chat uses standard RAG or none)
        return None

    async def execute_chain(self, session: Any, chain_name: str, query: str) -> Dict[str, Any]:
        """
        Execute a thinking chain retrieval.
        Returns a structured result: 
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
            # Fallback to simple search if chain not found
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
            
            # Construct filter: {"cluster_Name": True}
            # Note: We store "cluster_Name" in metadata (exploded)
            filter_criteria = {f"cluster_{cluster_name}": True}
            
            try:
                # Use MemoryService (Vector + Filter)
                # Since we want cluster filtering, we use search_memories_simple but it needs filter support in Rust?
                # Rust index doesn't support metadata filter. 
                # So search_memories_simple fetches candidates from vector search then filters in SQLite.
                # However, for specific cluster, vector search might not return enough candidates if the cluster is small/rare.
                # Ideally we should use get_memories_by_filter IF we only care about cluster, but we also want relevance.
                # Let's use search_memories_simple.
                
                memories = await MemoryService.search_memories_simple(
                    session=session,
                    query_vec=query_embedding,
                    limit=k,
                    filter_criteria=filter_criteria
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
        Format the chain result into a string for LLM context.
        Implements the "Inertia Channel" (惯性通道) effect.
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
                # Metadata might contain timestamp etc.
                meta = mem.get("metadata", {})
                ts = meta.get("timestamp", "Unknown Time")
                # Add score for debugging/transparency? Maybe not for final prompt.
                output.append(f"{i}. [{ts}] {content}")
        
        if not has_content:
            return ""
            
        return "\n".join(output)

    async def generate_weekly_report_context(self, session: Any) -> str:
        """
        Generate context for a weekly report (Thematic Review).
        Fetches memories from the last 7 days, AND related historical memories.
        """
        import time
        from datetime import datetime
        
        # Calculate timestamp for 7 days ago (milliseconds)
        now_ms = time.time() * 1000
        one_week_ago = now_ms - (7 * 24 * 3600 * 1000)
        
        # Define clusters to review
        clusters_to_review = ["逻辑推理簇", "反思簇", "计划意图簇", "创造灵感簇"]
        
        output = ["### 自动化周报生成上下文 (Thinking Pipeline Phase 2)"]
        output.append(f"Report Period: {datetime.fromtimestamp(one_week_ago/1000).strftime('%Y-%m-%d')} to {datetime.now().strftime('%Y-%m-%d')}")
        
        has_content = False
        all_weekly_contents = [] # Store for historical search
        
        for cluster in clusters_to_review:
            # Filter: Cluster matches AND timestamp >= one_week_ago
            filter_criteria = {
                "$and": [
                    {f"cluster_{cluster}": True},
                    {"timestamp": {"$gte": one_week_ago}}
                ]
            }
            
            # Fetch up to 8 items per cluster for the report (Reduced from 20 to avoid context overflow)
            # Use MemoryService.get_memories_by_filter
            memories = await MemoryService.get_memories_by_filter(
                session=session,
                limit=8,
                filter_criteria=filter_criteria
            )
            
            if not memories:
                continue
            
            has_content = True
            output.append(f"\n#### [{cluster}] (本周)")
            
            # Sort by importance (if available in metadata) descending
            # Metadata importance is usually 1-10
            memories.sort(key=lambda x: x.get("metadata", {}).get("importance", 1), reverse=True)
            
            for i, mem in enumerate(memories, 1):
                content = mem.get("document", "")
                if len(content) > 300:
                     content = content[:300] + "..." # Truncate long content
                
                all_weekly_contents.append(content) # Collect for historical search
                
                meta = mem.get("metadata", {})
                ts_val = meta.get("timestamp", 0)
                try:
                    ts_str = datetime.fromtimestamp(ts_val/1000).strftime('%Y-%m-%d %H:%M')
                except:
                    ts_str = str(ts_val)
                    
                output.append(f"- [{ts_str}] {content}")
        
        # [Feature] Cross-Time Context Association
        # Search for related memories OLDER than 7 days
        if all_weekly_contents:
            output.append("\n#### [历史回响] (关联的过往记忆)")
            # Create a summary query from this week's content (take top 3 longest items as proxy for importance)
            top_contents = sorted(all_weekly_contents, key=len, reverse=True)[:3]
            combined_query = " ".join(top_contents)[:1000] # Limit length
            
            query_vec = self.embedding_service.encode_one(combined_query)
            
            # Search with filter: timestamp < one_week_ago
            hist_filter = {"timestamp": {"$lt": one_week_ago}}
            
            hist_memories = await MemoryService.search_memories_simple(
                session=session,
                query_vec=query_vec,
                limit=5,
                filter_criteria=hist_filter
            )
            
            if hist_memories:
                for mem in hist_memories:
                    content = mem.get("document", "")
                    meta = mem.get("metadata", {})
                    ts_val = meta.get("timestamp", 0)
                    score = mem.get("score", 0)
                    if score < 0.4: continue # Filter low relevance
                    
                    try:
                        ts_str = datetime.fromtimestamp(ts_val/1000).strftime('%Y-%m-%d')
                    except:
                        ts_str = "Unknown"
                    output.append(f"- [{ts_str}] {content}")
            else:
                output.append("(无显著相关的历史记忆)")

        # 4. Limit Control to avoid token explosion
        # Calculate estimated tokens (rough estimate: 1 token ≈ 1.5 chars for Chinese/English mix)
        # We aim for max ~6000 tokens context to be safe for 8k/32k models
        # 6000 tokens ≈ 9000 chars. Let's set a safe hard limit of 10000 chars.
        
        full_text = "\n".join(output)
        
        if len(full_text) > 10000:
            print(f"[ThinkingChain] Context too long ({len(full_text)} chars), enforcing strict truncation...")
            
            # Strategy: Keep Header + Echoes + High Importance Weekly Items
            # We already sorted weekly items by importance.
            # So simply slicing from the top of each section is effective, but 'output' is a flat list now.
            # We need to rebuild it carefully or just brutally slice the middle.
            
            # Better approach: Keep first 20 lines (Header + Echoes usually at bottom? No, Echoes added last)
            # Wait, Echoes are added at the END.
            # Structure: [Header] ... [Cluster A] ... [Cluster B] ... [Echoes]
            
            # To preserve Echoes (highly valuable), we should cut from the middle (Weekly details).
            
            safe_output = []
            safe_output.extend(output[:5]) # Header + Date
            
            # Calculate remaining budget
            remaining_chars = 9000 - len("\n".join(safe_output))
            
            # Get Echoes (last few items usually, looking for "历史回响")
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
            
            # Add Echoes to safe output (they are critical)
            # If Echoes themselves are huge, truncate them too
            if len("\n".join(echo_items)) > 2000:
                echo_items = echo_items[:10] + ["... (More historical echoes truncated)"]
            
            remaining_chars -= len("\n".join(echo_items))
            
            # Fill remaining budget with Weekly items
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

    async def generate_weekly_report(self, session: Any) -> str:
        """
        Generate the actual weekly report using LLM.
        """
        from sqlmodel import select
        from models import AIModelConfig
        from services.llm_service import LLMService

        context = await self.generate_weekly_report_context(session)
        if "No activities found" in context:
            return ""

        # Fetch Active LLM Config
        # We prefer the one marked as 'chat' or just the first active one
        result = await session.exec(select(AIModelConfig).where(AIModelConfig.is_active == True))
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

        prompt = f"""
You are Pero, an intelligent AI assistant.
Please generate a "Weekly Knowledge Report" based on the user's activities and thinking clusters from the past week.

Context Data:
{context}

Requirements:
1. **Tone**: Professional yet encouraging, like a thoughtful secretary or partner.
2. **Structure**:
   - **Summary**: Brief overview of the week's focus.
   - **Key Insights**: Highlight 2-3 important technical or logical points from the "Logic/Reasoning" clusters.
   - **Historical Echoes**: If there are "[历史回响]" items, analyze the connection between this week's events and past memories. (Does it show progress? Or a recurring issue?)
   - **Reflections**: Summarize any "Reflection" items and suggest improvements.
   - **Next Steps**: Based on "Planning" items, suggest what to focus on next week.
3. **Format**: Use Markdown.

Output the report directly.
"""
        try:
            messages = [{"role": "user", "content": prompt}]
            response = await llm.chat(messages)
            content = response["choices"][0]["message"]["content"]
            return content
        except Exception as e:
            print(f"[ThinkingChain] Error generating weekly report: {e}")
            return ""

# Singleton instance
chain_service = ThinkingChainService()
