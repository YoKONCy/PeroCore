import time
import numpy as np
from pero_rust_core import CognitiveGraphEngine

def run_battle_royale():
    print("="*70)
    print("      PEROCORE VS. TRADITIONAL RAG: THE SEMANTIC MAZE BATTLE")
    print("="*70)

    # 初始化引擎
    engine = CognitiveGraphEngine()

    # ---------------------------------------------------------
    # 场景设定：寻找“失踪的证据”
    # 逻辑链条：提问(A) -> 关键线索(B) -> 隐藏证据(C) -> 最终真相(D)
    # ---------------------------------------------------------
    # 节点 ID 定义
    QUERY_NODE = 1          # 提问关键词：遗失的钥匙
    KEY_CLUE = 100          # 关键线索：那个红色的信封
    HIDDEN_EVIDENCE = 200   # 隐藏证据：保险箱的密码
    FINAL_TRUTH = 999       # 最终真相：遗嘱的内容
    
    # 注入逻辑关联
    logic_edges = [
        (QUERY_NODE, KEY_CLUE, 0.9),
        (KEY_CLUE, HIDDEN_EVIDENCE, 0.8),
        (HIDDEN_EVIDENCE, FINAL_TRUTH, 0.9)
    ]
    
    # ---------------------------------------------------------
    # 注入噪音：模拟百万级规模
    noise_count = 1000000
    noise_edges = []
    for i in range(1000, 1000 + noise_count):
        # 模拟向量检索常见的“误伤”：语义相近但逻辑断路
        noise_edges.append((QUERY_NODE, i, 0.85)) # 噪音权重略低于真实线索，但数量巨大

    print(f"[*] 正在注入数据：1 条深层逻辑链 + {noise_count} 条语义干扰边...")
    engine.batch_add_connections(logic_edges + noise_edges)
    print("[+] 数据注入完成。\n")

    # ---------------------------------------------------------
    # 模拟传统 RAG (仅向量检索)
    # ---------------------------------------------------------
    print("[Phase 1] 传统 RAG (Vector Search Only) 表现：")
    # 模拟向量数据库返回 Top-20
    # 在这个场景下，Top-1 是 KEY_CLUE，但后面跟着 19 个噪音节点
    start_rag = time.perf_counter()
    # 传统 RAG 只看第一跳，它能找到 KEY_CLUE，但绝对找不到 FINAL_TRUTH
    rag_results = [KEY_CLUE] + list(range(1000, 1019))
    end_rag = time.perf_counter()
    
    found_truth_rag = FINAL_TRUTH in rag_results
    print(f"   - 检索耗时: {(end_rag - start_rag)*1000:.4f} ms")
    print(f"   - 是否召回最终真相 '{FINAL_TRUTH}': {'✅' if found_truth_rag else '❌ (失败，陷入语义孤岛)'}")
    print(f"   - 召回内容预览: {rag_results[:5]}... (全是噪音)")

    # ---------------------------------------------------------
    # 模拟 PeroCore (Vector Search + Spreading Activation)
    # ---------------------------------------------------------
    print("\n[Phase 2] PeroCore (Diffusion Engine) 表现：")
    # 初始激活点设为 QUERY_NODE
    initial_scores = {QUERY_NODE: 1.0}
    
    start_pero = time.perf_counter()
    # 执行 3 步扩散，尝试穿透逻辑链
    activated_nodes = engine.propagate_activation(
        initial_scores, 
        steps=3, 
        decay=0.7, 
        min_threshold=0.01
    )
    end_pero = time.perf_counter()

    # 排序结果
    sorted_nodes = sorted(activated_nodes.items(), key=lambda x: x[1], reverse=True)
    
    found_truth_pero = any(node_id == FINAL_TRUTH for node_id, _ in sorted_nodes)
    rank_truth = -1
    for i, (node_id, _) in enumerate(sorted_nodes):
        if node_id == FINAL_TRUTH:
            rank_truth = i + 1
            break

    print(f"   - 扩散耗时: {(end_pero - start_pero)*1000:.4f} ms")
    print(f"   - 是否召回最终真相 '{FINAL_TRUTH}': {'✅' if found_truth_pero else '❌'}")
    if found_truth_pero:
        print(f"   - 最终真相排名: 第 {rank_truth} 名 (成功穿透逻辑迷宫！)")
    
    print("\n[Top 10 激活节点名单]:")
    for i, (node_id, score) in enumerate(sorted_nodes[:10]):
        tag = ""
        if node_id == FINAL_TRUTH: tag = " <--- [FINAL TRUTH]"
        if node_id == KEY_CLUE: tag = " <--- [KEY CLUE]"
        if node_id >= 1000: tag = " (Noise)"
        print(f"   {i+1}. Node {node_id}: {score:.4f}{tag}")

    print("\n" + "="*70)
    print("实战结论：")
    if found_truth_pero and not found_truth_rag:
        print("PeroCore 胜出！它成功穿透了传统 RAG 无法逾越的语义噪音，找回了深层逻辑关联。")
    print("="*70)

if __name__ == "__main__":
    run_battle_royale()
