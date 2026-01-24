//! Pero Rust Core
//!
//! 高性能意图-记忆扩散引擎
//!
//! 主要模块:
//! - `intent_engine`: SIMD 加速的意图锚点搜索 (向量数据库)
//! - `cognitive_graph`: 基于 PEDSA 算法的认知图谱扩散激活
//!
//! 版本: 0.2.1
//! 架构: 专注于记忆存储与激活，视觉推理已分离至 `vision_core`

use ahash::AHashMap;
/*
 * Copyright (c) 2026 YoKONCy. All rights reserved.
 * This software is licensed under the GNU General Public License v3.0.
 * Any unauthorized commercial use or closed-source redistribution is a direct violation of the GPL-3.0 license.
 * Original Repository: https://github.com/YoKONCy/PeroCore
 */

use pyo3::prelude::*;
use rayon::prelude::*;
use regex::Regex;
use smallvec::SmallVec;
use std::collections::HashMap;

// 模块声明
pub mod intent_engine;

// 重导出核心类型
pub use intent_engine::{IntentAnchor, IntentEngine};

// === 常量与元数据 ===
const MAX_INPUT_LENGTH: usize = 100_000;
const CORE_VERSION: &str = "0.2.1-stable";
const ENGINE_FINGERPRINT: &str = "PERO-CORE-KDN-SIMD-PRO-v2-2026";

/// 引擎元数据信息
#[pyclass]
#[derive(Clone)]
struct EngineManifest {
    #[pyo3(get)]
    version: String,
    #[pyo3(get)]
    fingerprint: String,
    #[pyo3(get)]
    simd_support: String,
    #[pyo3(get)]
    memory_layout: String,
    #[pyo3(get)]
    optimization_level: String,
}

#[pymethods]
impl EngineManifest {
    fn __repr__(&self) -> String {
        format!(
            "PeroCore Engine Manifest [v{} | SIMD: {} | Layout: {}]",
            self.version, self.simd_support, self.memory_layout
        )
    }
}

// ============================================================================
// 文本清洗器 (保留原有功能)
// ============================================================================

/// 文本清洗器
/// 使用 Rust 正则表达式高效清洗文本
#[pyclass]
struct TextSanitizer;

#[pymethods]
impl TextSanitizer {
    #[new]
    fn new() -> Self {
        TextSanitizer
    }

    /// 净化文本：移除 Base64 图片数据
    #[pyo3(text_signature = "($self, text)")]
    fn sanitize(&self, text: &str) -> String {
        sanitize_text_content(text)
    }
}

/// 模块级辅助函数：清洗文本内容
#[pyfunction]
fn sanitize_text_content(text: &str) -> String {
    // 物理截断防御 (ReDoS 防护与内存占用控制)
    let text = if text.len() > MAX_INPUT_LENGTH {
        let end = text
            .char_indices()
            .map(|(i, _)| i)
            .nth(MAX_INPUT_LENGTH)
            .unwrap_or(text.len());
        &text[..end]
    } else {
        text
    };

    // 移除 Base64 图片数据
    let pattern_str = r"data:image/[^;]+;base64,[^".to_owned() + "\"'\\s>]+";
    let base64_pattern = Regex::new(&pattern_str).unwrap();
    let text = base64_pattern.replace_all(text, "[IMAGE_DATA]");

    let result = text.into_owned();

    // 截断 (保留前 2000 个字符)
    let truncated: String = result.chars().take(2000).collect();
    truncated.trim().to_string()
}

// ============================================================================
// 图谱边缘连接
// ============================================================================

#[derive(Clone, Debug)]
struct GraphEdge {
    /// 目标节点 ID (优化为 i32 以减少内存占用)
    /// 注意：这限制了单机图谱节点 ID 不能超过 21 亿 (i32::MAX)，
    /// 但换取了 i32(4B) + f32(4B) = 8B 的完美内存对齐和翻倍的缓存效率。
    /// 如果未来需要支持万亿级节点，此处需回退为 i64。
    target_node_id: i32,
    /// 连接强度 (量化压缩: f32 -> u16)
    /// 映射: 0.0-1.0 -> 0-65535
    /// 注意：虽然目前由于 i32 对齐导致 struct 仍占用 8 字节 (4+2+2pad)，
    /// 但这减少了有效数据载荷，为未来的 SoA 布局或磁盘存储压缩做好了准备。
    connection_strength: u16,
}

// ============================================================================
// 认知图谱引擎 (动态类 CSR 模拟优化版)
// 基于 PEDSA (Parallel Energy-Decay Spreading Activation) 算法
// ============================================================================

/// 认知图谱引擎 (动态类 CSR 模拟优化版)
/// 
/// 该引擎目前采用动态邻接表模拟 CSR (Simulated CSR) 结构，以平衡“实时写入灵活性”与“图遍历性能”。
/// 标准的静态 CSR 矩阵在写入新关联时需要重建整个索引，而此模拟版本支持 O(1) 的动态关联添加。
/// 仅当数据量达到万亿级且趋于静态时，系统才会考虑塌缩为标准 CSR。
#[pyclass]
pub struct CognitiveGraphEngine {
    // 使用 SmallVec 优化内存: 
    // 大多数节点连接数较少，直接内联存储在结构体中，避免堆分配
    // [GraphEdge; 4] 意味着如果边数 <= 4，则不使用堆内存
    dynamic_map: AHashMap<i64, SmallVec<[GraphEdge; 4]>>,
    max_active_nodes: usize,
    max_fan_out: usize,
}

#[pymethods]
impl CognitiveGraphEngine {
    #[new]
    pub fn new() -> Self {
        CognitiveGraphEngine {
            dynamic_map: AHashMap::new(),
            max_active_nodes: 10000,
            max_fan_out: 20,
        }
    }

    /// 配置引擎参数
    #[pyo3(text_signature = "($self, max_active_nodes, max_fan_out)")]
    fn configure(&mut self, max_active_nodes: usize, max_fan_out: usize) {
        self.max_active_nodes = max_active_nodes;
        self.max_fan_out = max_fan_out;
    }

    /// 批量添加连接关系 (带自动剪枝)
    #[pyo3(text_signature = "($self, connections)")]
    fn batch_add_connections(&mut self, connections: Vec<(i64, i64, f32)>) {
        for (src, tgt, weight) in connections {
            self.add_single_edge(src, tgt, weight);
            self.add_single_edge(tgt, src, weight);
        }

        // 自动剪枝
        for edges in self.dynamic_map.values_mut() {
            if edges.len() > self.max_fan_out {
                edges.sort_by(|a, b| b.connection_strength.cmp(&a.connection_strength));
                edges.truncate(self.max_fan_out);
            }
        }
    }

    fn add_single_edge(&mut self, src: i64, tgt: i64, weight: f32) {
        let edges = self.dynamic_map.entry(src).or_default();
        // 量化权重: f32 [0.0, 1.0] -> u16 [0, 65535]
        let quantized_weight = (weight.clamp(0.0, 1.0) * 65535.0) as u16;

        // tgt as i32: 假设节点 ID 在 i32 范围内
        if let Some(existing) = edges.iter_mut().find(|e| e.target_node_id == tgt as i32) {
            if quantized_weight > existing.connection_strength {
                existing.connection_strength = quantized_weight;
            }
        } else {
            edges.push(GraphEdge {
                target_node_id: tgt as i32,
                connection_strength: quantized_weight,
            });
        }
    }

    /// 获取引擎技术清单 (用于诊断与合规性检查)
    fn get_manifest(&self) -> EngineManifest {
        let simd_info = if cfg!(all(target_arch = "x86_64", target_feature = "avx2")) {
            "AVX2-Enabled (Manual Intrinsics)".to_string()
        } else if cfg!(target_arch = "aarch64") {
            "NEON-Enabled (Auto-Vectorization)".to_string()
        } else {
            "Generic (SIMD Disabled)".to_string()
        };

        EngineManifest {
            version: CORE_VERSION.to_string(),
            fingerprint: ENGINE_FINGERPRINT.to_string(),
            simd_support: simd_info,
            memory_layout: "Simulated CSR (Quantized u16)".to_string(),
            optimization_level: if cfg!(debug_assertions) { "Debug" } else { "Release (Full O3)" }.to_string(),
        }
    }

    fn clear_graph(&mut self) {
        self.dynamic_map.clear();
    }

    /// 执行激活扩散计算 (带稳定性剪枝和并行优化)
    /// 
    /// 优化策略：
    /// 1. 动态阈值截断 (Dynamic Pruning): 每轮扩散仅保留能量最高的 Top-N 节点
    /// 2. 能量衰减 (Decay): 防止能量无限发散
    /// 3. 并行计算: 利用 Rayon 进行并行规约
    #[pyo3(text_signature = "($self, initial_scores, steps=1, decay=0.5, min_threshold=0.01, max_active_nodes_per_layer=10000)")]
    fn propagate_activation(
        &self,
        initial_scores: HashMap<i64, f32>,
        steps: usize,
        decay: f32,
        min_threshold: f32,
        max_active_nodes_per_layer: Option<usize>,
    ) -> HashMap<i64, f32> {
        let mut current_scores: AHashMap<i64, f32> = initial_scores.into_iter().collect();
        // 默认每层最大激活节点数 10000
        let layer_limit = max_active_nodes_per_layer.unwrap_or(10000);

        for _ in 0..steps {
            let mut active_nodes: Vec<(&i64, &f32)> = current_scores
                .iter()
                .filter(|(_, &score)| score >= min_threshold)
                .collect();

            // 动态截断：如果激活节点过多，只保留能量最高的 Top-K
            // 这能显著减少长尾计算量，同时保留最重要的信号
            if active_nodes.len() > layer_limit {
                active_nodes.select_nth_unstable_by(layer_limit, |a, b| {
                    b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal)
                });
                active_nodes.truncate(layer_limit);
            }

            if active_nodes.is_empty() {
                break;
            }

            let increments: AHashMap<i64, f32> = active_nodes
                .into_par_iter()
                .fold(
                    || AHashMap::new(),
                    |mut acc, (&node_id, &score)| {
                        if let Some(neighbors) = self.dynamic_map.get(&node_id) {
                            for edge in neighbors {
                                // 反量化: u16 [0, 65535] -> f32 [0.0, 1.0]
                                let weight = edge.connection_strength as f32 / 65535.0;
                                let energy = score * weight * decay;
                                if energy >= min_threshold * 0.5 {
                                    *acc.entry(edge.target_node_id as i64).or_default() += energy;
                                }
                            }
                        }
                        acc
                    },
                )
                .reduce(
                    || AHashMap::new(),
                    |mut map1, map2| {
                        for (k, v) in map2 {
                            *map1.entry(k).or_default() += v;
                        }
                        map1
                    },
                );

            for (node_id, energy) in increments {
                let entry = current_scores.entry(node_id).or_insert(0.0);
                *entry += energy;
                if *entry > 2.0 {
                    *entry = 2.0;
                }
            }
        }

        current_scores.into_iter().collect()
    }
}

impl Default for CognitiveGraphEngine {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// 语义向量索引 (基于 IntentEngine)
// ============================================================================

/// 语义向量索引
#[pyclass]
pub struct SemanticVectorIndex {
    engine: IntentEngine,
}

#[pymethods]
impl SemanticVectorIndex {
    #[new]
    fn new(dim: usize, _capacity: usize) -> PyResult<Self> {
        let engine = IntentEngine::new(dim).map_err(|e| {
            PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!("引擎创建失败: {:?}", e))
        })?;

        Ok(SemanticVectorIndex { engine })
    }

    /// 插入单个向量
    fn insert_vector(&mut self, id: u64, vector: Vec<f32>) -> PyResult<()> {
        self.engine
            .add_anchor(IntentAnchor {
                id: id as i64,
                vector,
                description: String::new(),
                importance: 1.0,
                tags: String::new(),
            })
            .map_err(|e| {
                PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!("插入失败: {:?}", e))
            })?;
        Ok(())
    }

    /// 批量插入向量
    fn batch_insert_vectors(&mut self, ids: Vec<u64>, vectors: Vec<Vec<f32>>) -> PyResult<()> {
        if ids.len() != vectors.len() {
            return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(
                "ID 列表与向量列表长度不一致",
            ));
        }

        for (&id, vec) in ids.iter().zip(vectors.into_iter()) {
            self.engine
                .add_anchor(IntentAnchor {
                    id: id as i64,
                    vector: vec,
                    description: String::new(),
                    importance: 1.0,
                    tags: String::new(),
                })
                .map_err(|e| {
                    PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!(
                        "批量插入失败: {:?}",
                        e
                    ))
                })?;
        }
        Ok(())
    }

    /// 搜索相似向量
    fn search_similar_vectors(&self, vector: Vec<f32>, k: usize) -> PyResult<Vec<(u64, f32)>> {
        let results = self.engine.search_ids(&vector, k).map_err(|e| {
            PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!("搜索失败: {:?}", e))
        })?;

        Ok(results
            .into_iter()
            .map(|(id, sim)| (id as u64, sim))
            .collect())
    }

    /// 持久化索引到磁盘
    fn persist_index(&self, path: String) -> PyResult<()> {
        self.engine
            .save(&path)
            .map_err(|e| PyErr::new::<pyo3::exceptions::PyIOError, _>(format!("保存失败: {:?}", e)))
    }

    /// 从磁盘加载索引
    #[staticmethod]
    fn load_index(path: String, dim: usize) -> PyResult<Self> {
        let mut engine = IntentEngine::new(dim).map_err(|e| {
            PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(format!("初始化失败: {:?}", e))
        })?;

        engine.load(&path).map_err(|e| {
            PyErr::new::<pyo3::exceptions::PyIOError, _>(format!("加载失败: {:?}", e))
        })?;

        Ok(SemanticVectorIndex { engine })
    }

    fn size(&self) -> usize {
        self.engine.size()
    }

    fn capacity(&self) -> usize {
        self.engine.capacity()
    }
}

// ============================================================================
// Python 模块入口
// ============================================================================

/// Pero Rust Core Python 模块入口
#[pymodule]
fn pero_memory_core(_py: Python, m: &Bound<'_, PyModule>) -> PyResult<()> {
    // 核心类 (记忆/搜索部分 - 始终包含)
    m.add_class::<CognitiveGraphEngine>()?;
    m.add_class::<SemanticVectorIndex>()?;
    m.add_class::<TextSanitizer>()?;
    m.add_class::<EngineManifest>()?;

    // 辅助函数
    m.add_function(wrap_pyfunction!(sanitize_text_content, m)?)?;

    Ok(())
}
