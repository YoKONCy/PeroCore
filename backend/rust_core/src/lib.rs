//! Pero Rust Core
//!
//! 高性能视觉-意图-记忆引擎
//!
//! 主要模块:
//! - `aura_vision`: 纯 Rust ONNX 视觉推理
//! - `intent_engine`: SIMD 加速的意图锚点搜索
//! - `vision_intent_memory`: 视觉-意图-记忆集成核心
//!
//! 版本: 0.2.0
//! 重构: 从 PyO3+Python 方案迁移到纯 Rust 原生推理

use ahash::AHashMap;
use pyo3::prelude::*;
use rayon::prelude::*;
use regex::Regex;
use std::collections::HashMap;

// 模块声明
#[cfg(feature = "vision")]
pub mod aura_vision;
pub mod intent_engine;
#[cfg(feature = "vision")]
pub mod vision_intent_memory;

// 重导出核心类型
#[cfg(feature = "vision")]
pub use aura_vision::AuraVisionEncoder;
pub use intent_engine::{IntentAnchor, IntentEngine};
#[cfg(feature = "vision")]
pub use vision_intent_memory::{VisionIntentMemoryManager, VisionProcessResult};

// === 常量 ===
const MAX_INPUT_LENGTH: usize = 100_000;

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
    target_node_id: i64,
    connection_strength: f32,
}

// ============================================================================
// 认知图谱引擎 (高性能 CSR 优化版)
// ============================================================================

/// 认知图谱引擎 (高性能 CSR 优化版)
#[pyclass]
pub struct CognitiveGraphEngine {
    dynamic_map: AHashMap<i64, Vec<GraphEdge>>,
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
                edges.sort_by(|a, b| {
                    b.connection_strength
                        .partial_cmp(&a.connection_strength)
                        .unwrap()
                });
                edges.truncate(self.max_fan_out);
            }
        }
    }

    fn add_single_edge(&mut self, src: i64, tgt: i64, weight: f32) {
        let edges = self.dynamic_map.entry(src).or_default();
        if let Some(existing) = edges.iter_mut().find(|e| e.target_node_id == tgt) {
            if weight > existing.connection_strength {
                existing.connection_strength = weight;
            }
        } else {
            edges.push(GraphEdge {
                target_node_id: tgt,
                connection_strength: weight,
            });
        }
    }

    fn clear_graph(&mut self) {
        self.dynamic_map.clear();
    }

    /// 执行激活扩散计算 (带稳定性剪枝和并行优化)
    #[pyo3(text_signature = "($self, initial_scores, steps=1, decay=0.5, min_threshold=0.01)")]
    fn propagate_activation(
        &self,
        initial_scores: HashMap<i64, f32>,
        steps: usize,
        decay: f32,
        min_threshold: f32,
    ) -> HashMap<i64, f32> {
        let mut current_scores: AHashMap<i64, f32> = initial_scores.into_iter().collect();

        for _ in 0..steps {
            let mut active_nodes: Vec<(&i64, &f32)> = current_scores
                .iter()
                .filter(|(_, &score)| score >= min_threshold)
                .collect();

            if active_nodes.len() > self.max_active_nodes {
                active_nodes
                    .sort_by(|a, b| b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal));
                active_nodes.truncate(self.max_active_nodes);
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
                                let energy = score * edge.connection_strength * decay;
                                if energy >= min_threshold * 0.5 {
                                    *acc.entry(edge.target_node_id).or_default() += energy;
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
    // 核心类 (视觉部分 - 可选)
    #[cfg(feature = "vision")]
    {
        m.add_class::<VisionIntentMemoryManager>()?;
        m.add_class::<VisionProcessResult>()?;
    }

    // 核心类 (记忆/搜索部分 - 始终包含)
    m.add_class::<CognitiveGraphEngine>()?;
    m.add_class::<SemanticVectorIndex>()?;
    m.add_class::<TextSanitizer>()?;

    // 辅助函数
    m.add_function(wrap_pyfunction!(sanitize_text_content, m)?)?;

    Ok(())
}
