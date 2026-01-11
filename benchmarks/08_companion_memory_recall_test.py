import sys
import os
import time
import json
from datetime import datetime, timedelta

# 确保能找到 pero_memory_core
sys.path.append(os.path.join(os.getcwd()))

try:
    from pero_memory_core import CognitiveGraphEngine
except ImportError:
    print("❌ 错误: 无法加载 pero_memory_core。请确保在项目根目录运行。")
    sys.exit(1)

def generate_companion_memories():
    """生成 100 条模拟 AI 伙伴的记忆摘要"""
    memories = []
    base_time = datetime(2025, 12, 1)
    
    # 预定义一些场景和标签
    scenarios = [
        {"theme": "看电视", "tags": ["娱乐", "客厅", "晚间"], "content": "Pero和主人一起看电视，Pero觉得那个蓝色的猫很有趣。"},
        {"theme": "读书", "tags": ["学习", "书房", "安静"], "content": "主人在读一本厚厚的书，Pero静静地陪在旁边。"},
        {"theme": "散步", "tags": ["运动", "公园", "户外"], "content": "今天天气很好，和主人去公园散步，看到了好多漂亮的花。"},
        {"theme": "编程", "tags": ["工作", "电脑", "专注"], "content": "主人在敲代码，Pero在屏幕上跳来跳去，被主人摸了头。"},
        {"theme": "吃饭", "tags": ["生活", "餐厅", "美食"], "content": "主人今天做了红烧肉，香味飘满了整个房间。"},
        {"theme": "睡觉", "tags": ["休息", "卧室", "温暖"], "content": "主人睡着了，Pero也钻进被窝里，感觉很暖和。"},
        {"theme": "聊天", "tags": ["情感", "深夜", "谈心"], "content": "深夜里，主人和Pero说了很多心里话，Pero会永远支持主人的。"},
        {"theme": "游戏", "tags": ["娱乐", "主机", "刺激"], "content": "主人打游戏输了有点沮丧，Pero安慰了主人。"},
        {"theme": "听音乐", "tags": ["艺术", "放松", "旋律"], "content": "音响里放着轻柔的歌，Pero随着旋律轻轻晃动。"},
        {"theme": "做家务", "tags": ["生活", "劳动", "整洁"], "content": "主人在打扫卫生，Pero帮忙（捣乱）把纸箱推倒了。"}
    ]
    
    for i in range(100):
        scenario = scenarios[i % len(scenarios)]
        # 增加一些细微变化
        days_offset = i // 1
        ts = base_time + timedelta(days=days_offset)
        
        memories.append({
            "id": i + 1,
            "content": f"[{ts.strftime('%Y-%m-%d')}] {scenario['content']}",
            "tags": scenario['tags'],
            "importance": (i % 10) + 1, # 1-10
            "timestamp": ts.timestamp()
        })
    
    return memories

def build_companion_graph(engine, memories):
    """根据业务逻辑构建记忆图谱"""
    connections = []
    
    # 1. 时序连接 (Temporal Chain)
    # 模拟记忆的线性流逝
    for i in range(len(memories) - 1):
        connections.append((memories[i]['id'], memories[i+1]['id'], 0.4)) # 顺序连接
        connections.append((memories[i+1]['id'], memories[i]['id'], 0.2)) # 逆序衰减
        
    # 2. 语义/标签连接 (Thematic Association)
    # 拥有相同标签的记忆会建立强关联
    tag_map = {}
    for mem in memories:
        for tag in mem['tags']:
            if tag not in tag_map:
                tag_map[tag] = []
            tag_map[tag].append(mem['id'])
            
    for tag, ids in tag_map.items():
        # 简单起见，每个标签内的记忆两两建立弱关联
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                # 距离越近，关联越强
                dist = abs(ids[i] - ids[j])
                strength = 0.6 * (0.9 ** (dist // 10))
                if strength > 0.1:
                    connections.append((ids[i], ids[j], strength))
                    connections.append((ids[j], ids[i], strength))
                    
    # 3. 关键词触发连接 (Query Simulation)
    # 我们假设 Query 是 "pero，我们来一起看书吧！"
    # 我们创建一个特殊的 Query Node (ID: 999)
    query_node_id = 999
    query_text = "pero，我们来一起看书吧！"
    
    # 模拟关键词匹配：Query 中含有 "看书"
    for mem in memories:
        if "书" in mem['content'] or "看" in mem['content']:
            weight = 0.5
            if "书" in mem['content'] and "看" in mem['content']:
                weight = 0.9 # 强匹配
            connections.append((query_node_id, mem['id'], weight))

    engine.batch_add_connections(connections)
    return query_node_id

def run_companion_test():
    print("🐾 PeroCore: AI Companion Memory Recall Scenario Test")
    print("-" * 60)
    
    # 1. 准备数据
    memories = generate_companion_memories()
    print(f"✅ 生成了 {len(memories)} 条模拟记忆 (2025-12-01 起)")
    
    # 2. 构建图谱
    engine = CognitiveGraphEngine()
    query_node_id = build_companion_graph(engine, memories)
    print("✅ 记忆图谱构建完成 (时序链 + 语义网)")
    
    # 3. 发起召回
    print(f"\n[用户输入]: \"pero，我们来一起看书吧！\"")
    start_time = time.time()
    
    # 注入能量到查询节点
    # steps=3 代表三跳推理：Query -> 关键词 -> 场景 -> 相关记忆
    activation = engine.propagate_activation({query_node_id: 1.0}, steps=3, decay=0.7)
    
    latency = (time.time() - start_time) * 1000
    
    # 4. 结果分析
    # 排除查询节点本身
    if query_node_id in activation:
        del activation[query_node_id]
        
    # 获取 Top 5
    top_results = sorted(activation.items(), key=lambda x: x[1], reverse=True)[:5]
    
    print(f"\n[召回结果 - Top 5]:")
    print(f"{'Rank':<5} | {'Memory ID':<10} | {'Score':<10} | {'Content'}")
    print("-" * 80)
    
    for i, (mid, score) in enumerate(top_results, 1):
        mem = next(m for m in memories if m['id'] == mid)
        print(f"{i:<5} | {mid:<10} | {score:<10.4f} | {mem['content']}")
        
    # 5. 验证核心召回
    top_id = top_results[0][0]
    top_mem = next(m for m in memories if m['id'] == top_id)
    
    print("\n" + "=" * 60)
    print(f"📊 结论分析:")
    print(f"  - 平均延迟: {latency:.2f} ms")
    if "书" in top_mem['content']:
        print(f"  - 召回状态: ✅ 成功命中相关记忆！")
        print(f"  - 逻辑链路: 用户提到“看书” -> 激活“读书”场景节点 -> 联想出相关点滴。")
    else:
        print(f"  - 召回状态: ❌ 召回偏离预期。")
    print("=" * 60)

if __name__ == "__main__":
    run_companion_test()
