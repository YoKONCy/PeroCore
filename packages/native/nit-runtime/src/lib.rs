//! @perocore/nit-runtime — Rust N-API 高性能计算模块
//!
//! 通过 napi-rs 将 Rust 原生算法暴露给 Node.js:
//! - minGRU 前向推理 (<2ms CPU)
//! - minGRU 在线训练 (SGD, <10ms)
//! - 投影矩阵乘法 (SIMD 友好)
//!
//! Leiden 聚类: 空 API 占位, 等 TriviumDB 原生支持。

#[macro_use]
extern crate napi_derive;

mod mingru;

use napi::bindgen_prelude::*;

// ─────────────────────────────────────────────
// 常量导出
// ─────────────────────────────────────────────

/// minGRU 隐状态维度
#[napi]
pub const HIDDEN_DIM: u32 = mingru::HIDDEN_DIM as u32;

// ─────────────────────────────────────────────
// minGRU 推理
// ─────────────────────────────────────────────

/// minGRU 前向推理
///
/// 更新隐状态 h_t → h_{t+1}
///
/// @param hidden  当前隐状态 (256 维 Float32Array)
/// @param input   投影后的查询向量 (256 维 Float32Array)
/// @returns 更新后的隐状态 (256 维 Float32Array)
#[napi(js_name = "minGruForward")]
pub fn min_gru_forward(hidden: Float32Array, input: Float32Array) -> Result<Float32Array> {
    let h = hidden.as_ref();
    let x = input.as_ref();

    if h.len() < mingru::HIDDEN_DIM {
        return Err(Error::new(
            Status::InvalidArg,
            format!("hidden 维度不足: 期望 {}, 实际 {}", mingru::HIDDEN_DIM, h.len()),
        ));
    }
    if x.len() < mingru::HIDDEN_DIM {
        return Err(Error::new(
            Status::InvalidArg,
            format!("input 维度不足: 期望 {}, 实际 {}", mingru::HIDDEN_DIM, x.len()),
        ));
    }

    let result = mingru::forward(h, x);
    Ok(Float32Array::new(result))
}

/// 投影输入向量到隐状态空间
///
/// @param queryEmbedding 查询向量 (如 1536 维)
/// @param projMatrix     投影矩阵 W_in (inputDim × 256)
/// @returns 投影后的向量 (256 维 Float32Array)
#[napi(js_name = "projectInput")]
pub fn project_input(query_embedding: Float32Array, proj_matrix: Float32Array) -> Result<Float32Array> {
    let q = query_embedding.as_ref();
    let p = proj_matrix.as_ref();

    if p.len() < q.len() * mingru::HIDDEN_DIM {
        return Err(Error::new(
            Status::InvalidArg,
            format!(
                "投影矩阵大小不匹配: 期望 {} ({}×{}), 实际 {}",
                q.len() * mingru::HIDDEN_DIM,
                q.len(),
                mingru::HIDDEN_DIM,
                p.len()
            ),
        ));
    }

    let result = mingru::project(q, p);
    Ok(Float32Array::new(result))
}

// ─────────────────────────────────────────────
// minGRU 在线训练
// ─────────────────────────────────────────────

/// 训练样本 (JS 传入)
#[napi(object)]
pub struct JsTrainingSample {
    /// 查询时的隐状态
    pub hidden_state: Float32Array,
    /// 查询向量 (已投影到 HIDDEN_DIM)
    pub query_embedding: Float32Array,
    /// 标签 (1.0=positive, 0.0=negative)
    pub label: f64,
}

/// minGRU 在线微调 (SGD)
///
/// @param samples      反馈样本列表
/// @param learningRate 学习率 (默认 0.001)
/// @returns 平均训练损失
#[napi(js_name = "minGruTrain")]
pub fn min_gru_train(samples: Vec<JsTrainingSample>, learning_rate: Option<f64>) -> Result<f64> {
    let lr = learning_rate.unwrap_or(0.001) as f32;

    let rust_samples: Vec<mingru::TrainingSample> = samples
        .iter()
        .map(|s| mingru::TrainingSample {
            hidden_state: s.hidden_state.as_ref().to_vec(),
            query_embedding: s.query_embedding.as_ref().to_vec(),
            label: s.label as f32,
        })
        .collect();

    let loss = mingru::train(&rust_samples, lr);
    Ok(loss as f64)
}

// ─────────────────────────────────────────────
// Leiden 聚类 (空 API 占位)
// ─────────────────────────────────────────────

/// 聚类结果
#[napi(object)]
pub struct JsClusterResult {
    /// 节点 ID → cluster ID 映射 (平铺数组: [nodeId1, clusterId1, nodeId2, clusterId2, ...])
    pub node_to_cluster: Vec<i64>,
    /// cluster ID → cluster 标签 (平铺数组: [clusterId1, "label1", clusterId2, "label2", ...])
    pub cluster_labels: Vec<String>,
    /// cluster ID → centroid (平铺数组)
    pub centroids: Vec<f64>,
}

/// Leiden 社区发现算法
///
/// 当前为**空 API 占位** — 返回空聚类结果。
/// 后续在 TriviumDB Rust 内核中原生实现。
///
/// @param _adjacency 邻接表 (当前忽略)
/// @returns 空聚类结果
#[napi(js_name = "leidenCluster")]
pub fn leiden_cluster() -> JsClusterResult {
    // 空 API 占位
    JsClusterResult {
        node_to_cluster: vec![],
        cluster_labels: vec![],
        centroids: vec![],
    }
}

// ─────────────────────────────────────────────
// NIT AST 执行 (预留)
// ─────────────────────────────────────────────

/// NIT AST 执行加速 (预留接口)
///
/// 当前 TS runtime 已够用, 此函数仅为预留。
#[napi(js_name = "executeAst")]
pub fn execute_ast() -> Result<()> {
    Err(Error::new(
        Status::GenericFailure,
        "请使用 TS 版 NIT runtime",
    ))
}
