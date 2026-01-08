import sys
import os
import asyncio
import math
from datetime import datetime, timedelta
from unittest.mock import MagicMock, AsyncMock, patch

# 添加路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from models import Memory, MemoryRelation

async def test_memory_service_logic():
    print("🧠 PeroCore MemoryService 深度逻辑验证")
    print("=" * 60)
    
    # 1. Mock 依赖 (通过 sys.modules 替换)
    # 先清理可能存在的旧模块
    for mod in ['services.vector_service', 'services.embedding_service', 'services.memory_service']:
        if mod in sys.modules:
            del sys.modules[mod]

    mock_vec_module = MagicMock()
    mock_vector_service = MagicMock()
    mock_vec_module.vector_service = mock_vector_service
    sys.modules['services.vector_service'] = mock_vec_module
    
    mock_embed_module = MagicMock()
    mock_embedding_service = MagicMock()
    mock_embed_module.embedding_service = mock_embedding_service
    sys.modules['services.embedding_service'] = mock_embed_module
    
    # Mock Embedding Service behavior
    mock_embedding_service.encode_one.return_value = [0.1] * 384 
    # Rerank 必须返回带有 index 的结果
    mock_embedding_service.rerank.return_value = [
        {"index": 0, "score": 0.9},
        {"index": 1, "score": 0.8},
        {"index": 2, "score": 0.7}
    ]
    
    # Mock Rust Engine
    mock_rust_engine = MagicMock()
    def mock_propagate(initial_scores, steps, decay, min_threshold):
        return initial_scores 
    mock_rust_engine.propagate_activation.side_effect = mock_propagate
    
    # 2. 构造测试数据 (The Contestants)
    base_time = datetime.now()
    
    # Case A: "老学究" (高相关，高重要，但很老，无簇匹配)
    mem_a = Memory(
        id=1, content="Deep learning theory...", tags="AI", 
        base_importance=9.0, importance=9,
        timestamp=(base_time - timedelta(days=60)).timestamp() * 1000, 
        clusters="逻辑推理簇"
    )
    
    # Case B: "新宠儿" (中相关，低重要，很新，有簇匹配)
    mem_b = Memory(
        id=2, content="I feel happy today!", tags="Emotion",
        base_importance=2.0, importance=2,
        timestamp=(base_time - timedelta(minutes=30)).timestamp() * 1000, 
        clusters="情感偏好簇"
    )
    
    # Case C: "普通人" (低相关，中重要，近期)
    mem_c = Memory(
        id=3, content="Bought some milk", tags="Life",
        base_importance=5.0, importance=5,
        timestamp=(base_time - timedelta(days=2)).timestamp() * 1000, 
        clusters="生活琐事"
    )
    
    mock_session = AsyncMock()
    
    # Result 1: Memories
    mock_result_mem = MagicMock()
    mock_result_mem.all.return_value = [mem_a, mem_b, mem_c]
    
    # Result 2: Relations (Mock 一条关联)
    rel_1 = MemoryRelation(source_id=1, target_id=2, strength=0.8)
    mock_result_rel = MagicMock()
    mock_result_rel.all.return_value = [rel_1]
    
    # 设置 side_effect: 根据 SQL 语句返回不同结果
    def side_effect_func(statement):
        s_str = str(statement).lower()
        print(f"DEBUG: session.exec called with SQL: {s_str[:50]}...")
        
        if "memoryrelation" in s_str:
            return mock_result_rel
        elif "memory" in s_str: # Memory table
            return mock_result_mem
        else:
            print("DEBUG: Unknown statement")
            return mock_result_mem # Default fallback
            
    mock_session.exec.side_effect = side_effect_func
    
    vector_results = [
        {"id": 1, "score": 0.9},
        {"id": 2, "score": 0.6},
        {"id": 3, "score": 0.3}
    ]
    mock_vector_service.search.return_value = vector_results
    
    # 3. 直接替换函数引用 (Patching directly)
    from services.memory_service import MemoryService
    import services.memory_service
    
    # 强行替换 get_rust_engine
    services.memory_service.get_rust_engine = AsyncMock(return_value=mock_rust_engine)
    
    # 诊断 Mock 状态
    print(f"DEBUG: Mock Vector Search Result: {mock_vector_service.search([0.1]*384)}")
    
    # 构造 Query，触发 "情感偏好簇" (Intent Detection)
    # 使用英文关键词以避免 Windows 下的中文编码问题
    query = "I feel love today" 
    
    print(f"Query: {query}")
    print("-" * 40)
    
    results = await MemoryService.get_relevant_memories(
        mock_session, query, limit=5, update_access_stats=False
    )
        
    # 4. 验证结果与分数分析
    # 我们需要手动计算预期分数来验证逻辑
    
    # --- Mem A (老学究) ---
    # Sim: 0.9
    # Cluster: 0 (Target is 情感, A is 逻辑)
    # Importance: 0.9
    # Decay: exp(-0.023 * 60) ≈ 0.25
    # Recency: 0
    # Score = (0.9 * 0.7) + 0 + (0.9 * 0.3 * 0.25) + 0 = 0.63 + 0.0675 = 0.6975
    
    # --- Mem B (新宠儿) ---
    # Sim: 0.6
    # Cluster: 0.15 (Match!)
    # Importance: 0.2
    # Decay: ~1.0
    # Recency: 0.2 * (1 - 0) = 0.2 (30 mins < 1 day)
    # Score = (0.6 * 0.7) + 0.15 + (0.2 * 0.3 * 1.0) + 0.2 = 0.42 + 0.15 + 0.06 + 0.2 = 0.83
    
    # --- Mem C (普通人) ---
    # Sim: 0.3
    # Cluster: 0
    # Importance: 0.5
    # Decay: exp(-0.023 * 2) ≈ 0.95
    # Recency: 0 (2 days > 1 day)
    # Score = (0.3 * 0.7) + 0 + (0.5 * 0.3 * 0.95) + 0 = 0.21 + 0.1425 = 0.3525
    
    # 预期排名: B > A > C
    # 尽管 A 的向量相似度高达 0.9，但 B 凭借 Recency 和 Cluster Bonus 逆袭了！
    
    report_lines = []
    report_lines.append("PeroCore MemoryService Logic Verification")
    report_lines.append("=" * 60)
    
    report_lines.append("Expected Ranking: Mem B (0.83) > Mem A (0.70) > Mem C (0.35)")
    report_lines.append("Actual Results:")
    
    for i, m in enumerate(results):
        report_lines.append(f"{i+1}. [ID: {m.id}] {m.content} (Tags: {m.tags})")
        
    # Assertions
    if not results:
        report_lines.append("X No results returned!")
    else:
        if results[0].id == 2:
            report_lines.append("V Success: Mem B (New Favorite) is ranked 1st!")
            report_lines.append("   Proven: Cluster Bonus (+0.15) and Recency Bonus (+0.2) effectively boosted context relevance.")
        else:
            report_lines.append(f"X Failed: Ranked 1st is ID {results[0].id}")
            
        if len(results) > 1 and results[1].id == 1:
            report_lines.append("V Success: Mem A (Old Expert) is ranked 2nd.")
            report_lines.append("   Proven: High Similarity and Importance saved it despite heavy Time Decay.")
            
    with open("logic_test_report.md", "w", encoding="utf-8") as f:
        f.write("\n".join(report_lines))
        
    print("Test finished. Results written to logic_test_report.md")

if __name__ == "__main__":
    asyncio.run(test_memory_service_logic())
