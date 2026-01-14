#![cfg(feature = "vision")]
//! 视觉意图记忆集成模块
//!
//! 实现技术文档中的核心链路：
//! 视觉编码 -> 锚点匹配 -> 扩散激活 -> 记忆唤醒
//!
//! 这是 Pero 视觉感知系统的核心模块，将视觉信号与记忆系统深度耦合

use crate::aura_vision::AuraVisionEncoder;
use crate::intent_engine::{IntentAnchor, IntentEngine};
use ahash::AHashMap;
use pyo3::prelude::*;
use smallvec::SmallVec;
use std::collections::HashMap;

/// 视觉图谱边缘连接 (内存优化版)
///
/// 采用与核心引擎相同的压缩策略：
/// 1. ID 压缩: i64 -> i32 (假设锚点 ID < 21亿)
/// 2. 权重压缩: f32 -> u16 (0-65535 映射 0.0-1.0)
/// 3. 内存对齐: 4 + 2 + 2(padding) = 8 bytes
#[derive(Clone, Debug)]
struct VisionGraphEdge {
    target_node_id: i32,
    weight: u16,
}

/// 扩散激活计算用的图结构
///
/// 简化版的 CognitiveGraphEngine，专门用于视觉触发的记忆唤醒
struct ActivationGraph {
    /// 邻接表: node_id -> [Edges]
    /// 使用 SmallVec<[VisionGraphEdge; 4]> 优化:
    /// 绝大多数视觉锚点的关联数较少，内联存储避免堆分配
    adjacency: AHashMap<i64, SmallVec<[VisionGraphEdge; 4]>>,

    /// 最大扇出 (每个节点最多连接数)
    max_fan_out: usize,
}

impl ActivationGraph {
    fn new() -> Self {
        Self {
            adjacency: AHashMap::new(),
            max_fan_out: 20,
        }
    }

    /// 添加边 (双向)
    fn add_edge(&mut self, src: i64, dst: i64, weight: f32) {
        self.add_directed_edge(src, dst, weight);
        self.add_directed_edge(dst, src, weight);
    }

    fn add_directed_edge(&mut self, src: i64, dst: i64, weight: f32) {
        let neighbors = self.adjacency.entry(src).or_default();
        // 量化权重: f32 [0.0, 1.0] -> u16 [0, 65535]
        let quantized_weight = (weight.clamp(0.0, 1.0) * 65535.0) as u16;

        // 检查是否已存在
        if let Some(existing) = neighbors.iter_mut().find(|e| e.target_node_id == dst as i32) {
            // 取较大权重
            if quantized_weight > existing.weight {
                existing.weight = quantized_weight;
            }
        } else {
            neighbors.push(VisionGraphEdge {
                target_node_id: dst as i32,
                weight: quantized_weight,
            });

            // 自动剪枝: 保留权重最高的 max_fan_out 个邻居
            if neighbors.len() > self.max_fan_out {
                neighbors
                    .sort_by(|a, b| b.weight.cmp(&a.weight));
                neighbors.truncate(self.max_fan_out);
            }
        }
    }

    /// 批量添加边
    fn add_edges(&mut self, edges: &[(i64, i64, f32)]) {
        for &(src, dst, weight) in edges {
            self.add_edge(src, dst, weight);
        }
    }

    /// 扩散激活计算
    ///
    /// # Arguments
    /// * `initial_scores` - 初始激活源及其能量
    /// * `steps` - 扩散步数
    /// * `decay` - 衰减因子
    /// * `min_threshold` - 最小能量阈值
    ///
    /// # Returns
    /// * 激活后的节点及其能量
    fn propagate(
        &self,
        initial_scores: HashMap<i64, f32>,
        steps: usize,
        decay: f32,
        min_threshold: f32,
    ) -> HashMap<i64, f32> {
        let mut current: AHashMap<i64, f32> = initial_scores.into_iter().collect();

        for _ in 0..steps {
            // 收集当前活跃节点
            let active: Vec<(i64, f32)> = current
                .iter()
                .filter(|(_, &score)| score >= min_threshold)
                .map(|(&id, &score)| (id, score))
                .collect();

            if active.is_empty() {
                break;
            }

            // 计算增量
            let mut increments: AHashMap<i64, f32> = AHashMap::new();

            for (node_id, score) in active {
                if let Some(neighbors) = self.adjacency.get(&node_id) {
                    for edge in neighbors {
                        let neighbor_id = edge.target_node_id as i64;
                        // 反量化权重
                        let weight = edge.weight as f32 / 65535.0;

                        let energy = score * weight * decay;
                        if energy >= min_threshold * 0.5 {
                            *increments.entry(neighbor_id).or_default() += energy;
                        }
                    }
                }
            }

            // 合并增量
            for (node_id, energy) in increments {
                let entry = current.entry(node_id).or_insert(0.0);
                *entry += energy;
                // 能量封顶，防止爆炸
                if *entry > 2.0 {
                    *entry = 2.0;
                }
            }
        }

        current.into_iter().collect()
    }

    fn clear(&mut self) {
        self.adjacency.clear();
    }
}

/// 视觉处理结果
#[pyclass]
#[derive(Clone, Debug)]
pub struct VisionProcessResult {
    /// 是否应该触发主动对话
    #[pyo3(get)]
    pub triggered: bool,

    /// 最匹配的锚点 ID
    #[pyo3(get)]
    pub top_anchor_id: i64,

    /// 匹配相似度
    #[pyo3(get)]
    pub top_similarity: f32,

    /// 锚点描述 (用于 LLM 提示词)
    #[pyo3(get)]
    pub top_description: String,

    /// 扩散激活唤醒的记忆 ID 列表
    #[pyo3(get)]
    pub activated_memory_ids: Vec<i64>,

    /// 上下文饱和度
    #[pyo3(get)]
    pub saturation: f32,
}

#[pymethods]
impl VisionProcessResult {
    fn __repr__(&self) -> String {
        format!(
            "VisionProcessResult(triggered={}, anchor_id={}, similarity={:.4}, saturation={:.4})",
            self.triggered, self.top_anchor_id, self.top_similarity, self.saturation
        )
    }
}

/// 视觉意图记忆管理器
///
/// 核心集成模块，实现技术文档中的完整链路：
/// 1. 视觉编码 -> 384D 向量
/// 2. EMA 平滑
/// 3. 锚点匹配
/// 4. 扩散激活
/// 5. 饱和度检测
#[pyclass]
pub struct VisionIntentMemoryManager {
    /// 视觉编码器
    encoder: Option<AuraVisionEncoder>,

    /// 意图引擎
    intent_engine: IntentEngine,

    /// 扩散激活图
    graph: ActivationGraph,

    // === EMA 平滑参数 ===
    /// 上一帧的向量 (用于平滑)
    last_vector: Option<Vec<f32>>,

    /// EMA 系数 (0-1, 越小越平滑)
    ema_alpha: f32,

    // === 触发阈值 ===
    /// 相似度阈值
    similarity_threshold: f32,

    // === 饱和度检测 ===
    /// 最近一次激活的记忆 ID 列表
    recent_activated_ids: Vec<i64>,

    /// 饱和度阈值 (超过此值则抑制主动对话)
    saturation_threshold: f32,

    /// 模型是否已加载
    model_loaded: bool,
}

#[pymethods]
impl VisionIntentMemoryManager {
    /// 创建新的管理器实例
    ///
    /// # Arguments
    /// * `model_path` - ONNX 模型文件路径 (可选，可后续加载)
    /// * `dim` - 向量维度 (应为 384)
    #[new]
    #[pyo3(signature = (model_path=None, dim=384))]
    fn new(model_path: Option<String>, dim: usize) -> PyResult<Self> {
        let intent_engine = IntentEngine::new(dim).map_err(|e| {
            PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!(
                "初始化意图引擎失败: {:?}",
                e
            ))
        })?;

        let mut manager = Self {
            encoder: None,
            intent_engine,
            graph: ActivationGraph::new(),
            last_vector: None,
            ema_alpha: 0.3,
            similarity_threshold: 0.85,
            recent_activated_ids: Vec::new(),
            saturation_threshold: 0.7,
            model_loaded: false,
        };

        // 如果提供了模型路径，尝试加载
        if let Some(path) = model_path {
            manager.load_model(path)?;
        }

        Ok(manager)
    }

    /// 加载视觉编码模型
    fn load_model(&mut self, model_path: String) -> PyResult<()> {
        let encoder = AuraVisionEncoder::load(&model_path).map_err(|e| {
            PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!("加载模型失败: {:?}", e))
        })?;

        self.encoder = Some(encoder);
        self.model_loaded = true;
        Ok(())
    }

    /// 检查模型是否已加载
    fn is_model_loaded(&self) -> bool {
        self.model_loaded
    }

    /// 添加意图锚点
    ///
    /// # Arguments
    /// * `id` - 锚点 ID (应与 Memory 表的 ID 对应)
    /// * `vector` - 384 维向量
    /// * `description` - 场景描述
    /// * `importance` - 重要性权重 (0-1)
    /// * `tags` - 标签 (逗号分隔)
    #[pyo3(signature = (id, vector, description, importance=1.0, tags=""))]
    fn add_intent_anchor(
        &mut self,
        id: i64,
        vector: Vec<f32>,
        description: String,
        importance: f32,
        tags: &str,
    ) -> PyResult<()> {
        self.intent_engine
            .add_anchor(IntentAnchor {
                id,
                vector,
                description,
                importance,
                tags: tags.to_string(),
            })
            .map_err(|e| {
                PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!("添加锚点失败: {:?}", e))
            })?;
        Ok(())
    }

    /// 添加记忆关联边 (用于扩散激活)
    ///
    /// # Arguments
    /// * `connections` - [(source_id, target_id, weight), ...]
    fn add_memory_connections(&mut self, connections: Vec<(i64, i64, f32)>) {
        self.graph.add_edges(&connections);
    }

    /// 清空记忆关联图
    fn clear_memory_connections(&mut self) {
        self.graph.clear();
    }

    /// 处理视觉输入并触发记忆唤醒
    ///
    /// 完整链路：
    /// 1. 视觉编码 -> 384D 向量
    /// 2. EMA 平滑
    /// 3. 锚点匹配
    /// 4. 扩散激活
    /// 5. 饱和度检测
    ///
    /// # Arguments
    /// * `pixels` - 预处理后的像素数据 (4096 个值, [-1, 1])
    /// * `propagation_steps` - 扩散步数 (建议 2)
    /// * `propagation_decay` - 扩散衰减 (建议 0.5)
    ///
    /// # Returns
    /// * `VisionProcessResult` - 处理结果
    #[pyo3(signature = (pixels, propagation_steps=2, propagation_decay=0.5))]
    fn process_visual_input(
        &mut self,
        pixels: Vec<f32>,
        propagation_steps: usize,
        propagation_decay: f32,
    ) -> PyResult<VisionProcessResult> {
        // 1. 视觉编码
        let encoder = self
            .encoder
            .as_ref()
            .ok_or_else(|| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>("模型未加载"))?;

        let mut current_vector = encoder.forward_from_pixels(&pixels).map_err(|e| {
            PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!("视觉编码失败: {:?}", e))
        })?;

        // 2. EMA 时序平滑
        if let Some(ref last) = self.last_vector {
            for (cur, prev) in current_vector.iter_mut().zip(last.iter()) {
                *cur = self.ema_alpha * *cur + (1.0 - self.ema_alpha) * prev;
            }
            // 重新归一化
            Self::l2_normalize_static(&mut current_vector);
        }
        self.last_vector = Some(current_vector.clone());

        // 3. 锚点匹配
        let matches = self.intent_engine.search(&current_vector, 3).map_err(|e| {
            PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!("意图搜索失败: {:?}", e))
        })?;

        if matches.is_empty() {
            return Ok(VisionProcessResult {
                triggered: false,
                top_anchor_id: -1,
                top_similarity: 0.0,
                top_description: String::new(),
                activated_memory_ids: Vec::new(),
                saturation: 0.0,
            });
        }

        let (top_sim, top_anchor) = &matches[0];
        let top_anchor_id = top_anchor.id;
        let top_description = top_anchor.description.clone();

        // 检查是否超过触发阈值
        if *top_sim < self.similarity_threshold {
            return Ok(VisionProcessResult {
                triggered: false,
                top_anchor_id,
                top_similarity: *top_sim,
                top_description,
                activated_memory_ids: Vec::new(),
                saturation: 0.0,
            });
        }

        // 4. 扩散激活
        let initial_scores: HashMap<i64, f32> = matches
            .iter()
            .map(|(sim, anchor)| (anchor.id, sim * anchor.importance))
            .collect();

        let activated =
            self.graph
                .propagate(initial_scores, propagation_steps, propagation_decay, 0.01);

        // 提取激活的记忆 ID (按能量排序)
        let mut activated_ids: Vec<(i64, f32)> = activated.into_iter().collect();
        activated_ids.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        let activated_memory_ids: Vec<i64> = activated_ids
            .iter()
            .take(20) // 最多返回 20 个
            .map(|(id, _)| *id)
            .collect();

        // 5. 饱和度检测
        let saturation = self.calculate_saturation(&activated_memory_ids);

        // 更新最近激活列表
        self.recent_activated_ids = activated_memory_ids.clone();

        // 判断是否触发：相似度超过阈值 且 饱和度低于阈值
        let triggered = saturation < self.saturation_threshold;

        Ok(VisionProcessResult {
            triggered,
            top_anchor_id,
            top_similarity: *top_sim,
            top_description,
            activated_memory_ids,
            saturation,
        })
    }

    /// 仅进行视觉搜索 (不触发扩散激活)
    ///
    /// 用于简单的意图检测场景
    fn search_intent(&self, pixels: Vec<f32>, top_k: usize) -> PyResult<Vec<(i64, f32, String)>> {
        let encoder = self
            .encoder
            .as_ref()
            .ok_or_else(|| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>("模型未加载"))?;

        let vector = encoder.forward_from_pixels(&pixels).map_err(|e| {
            PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!("视觉编码失败: {:?}", e))
        })?;

        let matches = self.intent_engine.search(&vector, top_k).map_err(|e| {
            PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!("意图搜索失败: {:?}", e))
        })?;

        Ok(matches
            .into_iter()
            .map(|(sim, anchor)| (anchor.id, sim, anchor.description.clone()))
            .collect())
    }

    /// 仅进行视觉编码 (用于调试或生成锚点)
    #[pyo3(signature = (pixels))]
    fn encode_pixels(&self, pixels: Vec<f32>) -> PyResult<Vec<f32>> {
        let encoder = self
            .encoder
            .as_ref()
            .ok_or_else(|| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>("模型未加载"))?;

        let vector = encoder.forward_from_pixels(&pixels).map_err(|e| {
            PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!("视觉编码失败: {:?}", e))
        })?;

        Ok(vector)
    }

    /// 配置参数
    ///
    /// # Arguments
    /// * `ema_alpha` - EMA 系数 (0-1)
    /// * `similarity_threshold` - 相似度阈值
    /// * `saturation_threshold` - 饱和度阈值
    #[pyo3(signature = (ema_alpha=None, similarity_threshold=None, saturation_threshold=None))]
    fn configure(
        &mut self,
        ema_alpha: Option<f32>,
        similarity_threshold: Option<f32>,
        saturation_threshold: Option<f32>,
    ) {
        if let Some(v) = ema_alpha {
            self.ema_alpha = v.clamp(0.0, 1.0);
        }
        if let Some(v) = similarity_threshold {
            self.similarity_threshold = v.clamp(0.0, 1.0);
        }
        if let Some(v) = saturation_threshold {
            self.saturation_threshold = v.clamp(0.0, 1.0);
        }
    }

    /// 重置 EMA 状态
    fn reset_ema(&mut self) {
        self.last_vector = None;
    }

    /// 获取锚点数量
    fn anchor_count(&self) -> usize {
        self.intent_engine.size()
    }

    /// 保存锚点数据
    fn save_anchors(&self, path: String) -> PyResult<()> {
        self.intent_engine
            .save(&path)
            .map_err(|e| PyErr::new::<pyo3::exceptions::PyIOError, _>(format!("保存失败: {:?}", e)))
    }

    /// 加载锚点数据
    fn load_anchors(&mut self, path: String) -> PyResult<()> {
        self.intent_engine
            .load(&path)
            .map_err(|e| PyErr::new::<pyo3::exceptions::PyIOError, _>(format!("加载失败: {:?}", e)))
    }
}

impl VisionIntentMemoryManager {
    /// 计算上下文饱和度
    ///
    /// S = |M_active ∩ M_recent| / |M_active|
    fn calculate_saturation(&self, current_ids: &[i64]) -> f32 {
        if current_ids.is_empty() {
            return 0.0;
        }

        let intersection_count = current_ids
            .iter()
            .filter(|id| self.recent_activated_ids.contains(id))
            .count();

        intersection_count as f32 / current_ids.len() as f32
    }

    /// L2 归一化
    fn l2_normalize_static(vec: &mut [f32]) {
        let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 1e-10 {
            let inv_norm = 1.0 / norm;
            for x in vec.iter_mut() {
                *x *= inv_norm;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_saturation_calculation() {
        let mut manager = VisionIntentMemoryManager::new(None, 384).unwrap();

        // 设置最近激活的 ID
        manager.recent_activated_ids = vec![1, 2, 3, 4, 5];

        // 完全重叠
        let saturation = manager.calculate_saturation(&[1, 2, 3, 4, 5]);
        assert!((saturation - 1.0).abs() < 1e-6);

        // 部分重叠
        let saturation = manager.calculate_saturation(&[1, 2, 6, 7]);
        assert!((saturation - 0.5).abs() < 1e-6);

        // 无重叠
        let saturation = manager.calculate_saturation(&[10, 11, 12]);
        assert!(saturation < 1e-6);

        // 空列表
        let saturation = manager.calculate_saturation(&[]);
        assert!(saturation < 1e-6);
    }

    #[test]
    fn test_activation_graph() {
        let mut graph = ActivationGraph::new();

        // 添加边: 1 -- 2 -- 3
        graph.add_edge(1, 2, 0.8);
        graph.add_edge(2, 3, 0.6);

        // 从节点 1 开始扩散
        let initial: HashMap<i64, f32> = [(1, 1.0)].into_iter().collect();
        let result = graph.propagate(initial, 2, 0.5, 0.01);

        // 节点 1, 2, 3 都应该被激活
        assert!(result.contains_key(&1));
        assert!(result.contains_key(&2));
        assert!(result.contains_key(&3));

        // 能量应该递减
        assert!(result[&1] > result[&2]);
        assert!(result[&2] > result[&3]);
    }
}
