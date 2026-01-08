"""
PeroCore 认知精确度测试 - 高难度版
包含高权重"伪逻辑链"作为竞争干扰

测试目标: 
- 黄金路径: 苹果 → 牛顿 → 万有引力 → 爱因斯坦 → 相对论
- 伪路径1: 苹果 → 乔布斯 → iPhone → 科技 → 未来
- 伪路径2: 苹果 → 水果 → 维生素 → 健康 → 长寿
- 伪路径3: 苹果 → 蛇 → 亚当 → 伊甸园 → 圣经
"""
import time
import random
import json
from pero_rust_core import CognitiveGraphEngine

def test_competitive_precision():
    print("="*70)
    print("PeroCore Advanced Precision Test - Competing Logic Chains")
    print("="*70)
    
    # 定义所有节点
    nodes = {
        # 黄金路径 (1-5): 苹果 → 牛顿 → 万有引力 → 爱因斯坦 → 相对论
        1: "Apple",
        2: "Newton", 
        3: "Gravity",
        4: "Einstein",
        5: "Relativity",  # 目标
        
        # 伪路径1 (10-14): 苹果 → 乔布斯 → iPhone → 科技 → 未来
        10: "Apple",  # 共享起点
        11: "Jobs",
        12: "iPhone",
        13: "Tech",
        14: "Future",
        
        # 伪路径2 (20-24): 苹果 → 水果 → 维生素 → 健康 → 长寿
        20: "Apple",  # 共享起点
        21: "Fruit",
        22: "Vitamin",
        23: "Health",
        24: "Longevity",
        
        # 伪路径3 (30-34): 苹果 → 蛇 → 亚当 → 伊甸园 → 圣经
        30: "Apple",  # 共享起点
        31: "Snake",
        32: "Adam",
        33: "Eden",
        34: "Bible",
    }
    
    # 定义连接 - 所有路径都有高权重
    golden_path = [
        (1, 2, 0.95),   # Apple → Newton
        (2, 3, 0.95),   # Newton → Gravity
        (3, 4, 0.90),   # Gravity → Einstein
        (4, 5, 0.95),   # Einstein → Relativity
    ]
    
    # 伪路径从同一个起点(1)出发，形成竞争
    fake_path_1 = [
        (1, 11, 0.95),  # Apple → Jobs (高权重竞争!)
        (11, 12, 0.90), # Jobs → iPhone
        (12, 13, 0.85), # iPhone → Tech
        (13, 14, 0.80), # Tech → Future
    ]
    
    fake_path_2 = [
        (1, 21, 0.90),  # Apple → Fruit (高权重竞争!)
        (21, 22, 0.85), # Fruit → Vitamin
        (22, 23, 0.80), # Vitamin → Health
        (23, 24, 0.75), # Health → Longevity
    ]
    
    fake_path_3 = [
        (1, 31, 0.85),  # Apple → Snake (高权重竞争!)
        (31, 32, 0.80), # Snake → Adam
        (32, 33, 0.85), # Adam → Eden
        (33, 34, 0.90), # Eden → Bible
    ]
    
    # 测试多种配置
    test_configs = [
        {
            "name": "Only Golden Path (Baseline)",
            "paths": [golden_path],
            "noise_count": 0
        },
        {
            "name": "Golden + 1 Fake Path",
            "paths": [golden_path, fake_path_1],
            "noise_count": 0
        },
        {
            "name": "Golden + 3 Fake Paths",
            "paths": [golden_path, fake_path_1, fake_path_2, fake_path_3],
            "noise_count": 0
        },
        {
            "name": "Golden + 3 Fake Paths + 1M Noise",
            "paths": [golden_path, fake_path_1, fake_path_2, fake_path_3],
            "noise_count": 1000000
        },
        {
            "name": "Golden + 3 Fake Paths + 10M Noise",
            "paths": [golden_path, fake_path_1, fake_path_2, fake_path_3],
            "noise_count": 10000000
        },
    ]
    
    results = []
    
    for config in test_configs:
        print(f"\n[TEST] {config['name']}")
        print("-" * 50)
        
        engine = CognitiveGraphEngine()
        
        # 注入所有逻辑路径
        all_connections = []
        for path in config["paths"]:
            all_connections.extend(path)
        engine.batch_add_connections(all_connections)
        
        # 注入噪音
        if config["noise_count"] > 0:
            print(f"  Injecting {config['noise_count']:,} noise edges...")
            BATCH_SIZE = 500000
            for i in range(0, config["noise_count"], BATCH_SIZE):
                noise_connections = []
                for _ in range(min(BATCH_SIZE, config["noise_count"] - i)):
                    src = random.randint(100, 1000000)
                    tgt = random.randint(100, 1000000)
                    weight = random.random() * 0.1
                    noise_connections.append((src, tgt, weight))
                engine.batch_add_connections(noise_connections)
        
        # 执行扩散
        initial_scores = {1: 1.0}  # 从 Apple 开始
        
        start_time = time.perf_counter()
        result = engine.propagate_activation(
            initial_scores, 
            steps=5, 
            decay=0.7, 
            min_threshold=0.001
        )
        duration = (time.perf_counter() - start_time) * 1000
        
        # 排序结果
        sorted_results = sorted(result.items(), key=lambda x: x[1], reverse=True)
        
        # 统计各目标节点的排名
        target_ranks = {
            "Relativity (Golden Target)": {"id": 5, "rank": -1, "score": 0},
            "Future (Fake1)": {"id": 14, "rank": -1, "score": 0},
            "Longevity (Fake2)": {"id": 24, "rank": -1, "score": 0},
            "Bible (Fake3)": {"id": 34, "rank": -1, "score": 0},
        }
        
        for rank, (node_id, score) in enumerate(sorted_results, 1):
            for name, info in target_ranks.items():
                if node_id == info["id"]:
                    info["rank"] = rank
                    info["score"] = round(score, 4)
        
        # Top 10
        top_10 = []
        for rank, (node_id, score) in enumerate(sorted_results[:15], 1):
            name = nodes.get(node_id, f"Noise_{node_id}")
            top_10.append(f"  {rank:2d}. {name:<20} Score: {score:.4f}")
        
        print(f"  Latency: {duration:.2f} ms")
        print(f"  Total activated nodes: {len(result)}")
        print(f"\n  Target Rankings:")
        for name, info in target_ranks.items():
            status = "WIN!" if info["id"] == 5 and info["rank"] == min(
                r["rank"] for r in target_ranks.values() if r["rank"] > 0
            ) else ""
            if info["rank"] > 0:
                print(f"    - {name}: Rank #{info['rank']}, Score: {info['score']} {status}")
            else:
                print(f"    - {name}: Not in results")
        
        print(f"\n  Top 15 Results:")
        for line in top_10:
            print(line)
        
        case_result = {
            "test_case": config["name"],
            "noise_count": config["noise_count"],
            "num_competing_paths": len(config["paths"]) - 1,
            "latency_ms": round(duration, 2),
            "total_activated_nodes": len(result),
            "target_ranks": {k: v for k, v in target_ranks.items()},
            "golden_target_won": target_ranks["Relativity (Golden Target)"]["rank"] > 0 and 
                                 target_ranks["Relativity (Golden Target)"]["rank"] <= 
                                 min((r["rank"] for r in target_ranks.values() if r["rank"] > 0), default=999)
        }
        results.append(case_result)
    
    # 汇总
    print("\n" + "="*70)
    print("SUMMARY")
    print("="*70)
    
    summary = {
        "test_name": "Competitive Precision Test",
        "description": "Test diffusion with multiple high-weight competing logic chains",
        "results": results
    }
    
    for r in results:
        status = "PASS" if r["golden_target_won"] else "FAIL"
        golden_rank = r["target_ranks"]["Relativity (Golden Target)"]["rank"]
        print(f"  [{status}] {r['test_case']}: Golden target at rank #{golden_rank}")
    
    print("\n" + json.dumps(summary, indent=2, default=str))
    
    return summary

if __name__ == "__main__":
    test_competitive_precision()
