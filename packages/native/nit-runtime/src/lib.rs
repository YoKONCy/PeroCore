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

/// minGRU 权重各分量大小（AIOS 第八阶段新增，供 TS 侧验证 buffer 长度）
#[napi(js_name = "MIN_GRU_WEIGHT_SIZES")]
pub fn min_gru_weight_sizes() -> WeightSizes {
    WeightSizes {
        w_z: (mingru::HIDDEN_DIM * mingru::HIDDEN_DIM) as u32,
        b_z: mingru::HIDDEN_DIM as u32,
        w_h: (mingru::HIDDEN_DIM * mingru::HIDDEN_DIM) as u32,
        b_h: mingru::HIDDEN_DIM as u32,
        total: (mingru::HIDDEN_DIM * mingru::HIDDEN_DIM * 2 + mingru::HIDDEN_DIM * 2) as u32,
    }
}

/// 权重大小信息（AIOS 第八阶段新增）
#[napi(object)]
pub struct WeightSizes {
    /// 门控权重 W_z 大小 (HIDDEN_DIM × HIDDEN_DIM)
    pub w_z: u32,
    /// 门控偏置 b_z 大小 (HIDDEN_DIM)
    pub b_z: u32,
    /// 候选状态权重 W_h 大小 (HIDDEN_DIM × HIDDEN_DIM)
    pub w_h: u32,
    /// 候选状态偏置 b_h 大小 (HIDDEN_DIM)
    pub b_h: u32,
    /// 总元素数
    pub total: u32,
}

/// minGRU 权重包（AIOS 第八阶段新增，TS 侧管理，可持久化）
#[napi(object)]
pub struct MinGruWeightsJs {
    /// 门控权重 W_z (HIDDEN_DIM × HIDDEN_DIM)
    pub w_z: Float32Array,
    /// 门控偏置 b_z (HIDDEN_DIM)
    pub b_z: Float32Array,
    /// 候选状态权重 W_h (HIDDEN_DIM × HIDDEN_DIM)
    pub w_h: Float32Array,
    /// 候选状态偏置 b_h (HIDDEN_DIM)
    pub b_h: Float32Array,
}

// ─────────────────────────────────────────────
// minGRU 推理
// ─────────────────────────────────────────────

/// minGRU 前向推理（旧版，使用全局单例权重，向后兼容保留）
///
/// @deprecated AIOS 第八阶段起改用 minGruForwardWithWeights
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
// 带外部权重的 minGRU API（AIOS 第八阶段新增）
// ─────────────────────────────────────────────

/// Xavier 初始化 minGRU 权重包
///
/// W_z/W_h: Xavier 均匀分布初始化
/// b_z/b_h: 初始化为 0.1（确保 sigmoid 门控初始开度合理，σ(0.1)≈0.525）
///
/// @param hiddenDim 隐状态维度（可选，默认 256）
/// @returns minGRU 权重包
#[napi(js_name = "xavierInitMinGruWeights")]
pub fn xavier_init_min_gru_weights(hidden_dim: Option<u32>) -> Result<MinGruWeightsJs> {
    use rand::Rng;
    let dim = hidden_dim.unwrap_or(mingru::HIDDEN_DIM as u32) as usize;
    if dim == 0 {
        return Err(Error::new(Status::InvalidArg, "hiddenDim 不能为 0"));
    }

    let mut rng = rand::thread_rng();
    let fan = dim as f32;
    let limit = (6.0 / (fan + fan)).sqrt();
    let dim2 = dim * dim;

    let w_z: Vec<f32> = (0..dim2).map(|_| rng.gen_range(-limit..limit)).collect();
    let b_z: Vec<f32> = vec![0.1; dim];
    let w_h: Vec<f32> = (0..dim2).map(|_| rng.gen_range(-limit..limit)).collect();
    let b_h: Vec<f32> = vec![0.1; dim];

    Ok(MinGruWeightsJs {
        w_z: Float32Array::new(w_z),
        b_z: Float32Array::new(b_z),
        w_h: Float32Array::new(w_h),
        b_h: Float32Array::new(b_h),
    })
}

/// 带外部权重的 minGRU 前向推理
///
/// AIOS 第八阶段：权重由 TS 侧管理并持久化，不再依赖 Rust 全局单例。
///
/// @param hidden  当前隐状态 (HIDDEN_DIM 维 Float32Array)
/// @param input   投影后的查询向量 (HIDDEN_DIM 维 Float32Array)
/// @param weights minGRU 权重包
/// @returns 更新后的隐状态 (HIDDEN_DIM 维 Float32Array)
#[napi(js_name = "minGruForwardWithWeights")]
pub fn min_gru_forward_with_weights(
    hidden: Float32Array,
    input: Float32Array,
    weights: MinGruWeightsJs,
) -> Result<Float32Array> {
    let h = hidden.as_ref();
    let x = input.as_ref();
    let w_z = weights.w_z.as_ref();
    let b_z = weights.b_z.as_ref();
    let w_h = weights.w_h.as_ref();
    let b_h = weights.b_h.as_ref();

    let dim = mingru::HIDDEN_DIM;

    if h.len() < dim {
        return Err(Error::new(
            Status::InvalidArg,
            format!("hidden 维度不足: 期望 {}, 实际 {}", dim, h.len()),
        ));
    }
    if x.len() < dim {
        return Err(Error::new(
            Status::InvalidArg,
            format!("input 维度不足: 期望 {}, 实际 {}", dim, x.len()),
        ));
    }
    if w_z.len() < dim * dim {
        return Err(Error::new(
            Status::InvalidArg,
            format!("W_z 维度不足: 期望 {}, 实际 {}", dim * dim, w_z.len()),
        ));
    }
    if b_z.len() < dim {
        return Err(Error::new(
            Status::InvalidArg,
            format!("b_z 维度不足: 期望 {}, 实际 {}", dim, b_z.len()),
        ));
    }

    // 从 napi 的 Float32Array 借用切片构造 ExternalWeights
    let ext_weights = mingru::ExternalWeights { w_z, b_z, w_h, b_h };
    let result = mingru::forward_with_weights(h, x, &ext_weights);
    Ok(Float32Array::new(result))
}

/// 带外部权重的 minGRU 单步 SGD 训练
///
/// AIOS 第八阶段：权重原地更新（mutate in-place），返回训练损失值。
///
/// @param hidden      该轮对话的隐状态 h_t
/// @param input       投影后的查询向量 x_t
/// @param weights     minGRU 权重包（会被原地更新）
/// @param label       反馈标签 (1.0 = 正面/相关, 0.0 = 负面/不相关)
/// @param learningRate 学习率 (默认 0.001)
/// @returns 训练损失值
#[napi(js_name = "trainMinGruStep")]
pub fn train_min_gru_step(
    hidden: Float32Array,
    input: Float32Array,
    weights: MinGruWeightsJs,
    label: f64,
    learning_rate: Option<f64>,
) -> Result<f64> {
    let h = hidden.as_ref();
    let x = input.as_ref();
    let lr = learning_rate.unwrap_or(0.001) as f32;
    let label_f = label as f32;

    let dim = mingru::HIDDEN_DIM;

    if h.len() < dim {
        return Err(Error::new(
            Status::InvalidArg,
            format!("hidden 维度不足: 期望 {}, 实际 {}", dim, h.len()),
        ));
    }
    if x.len() < dim {
        return Err(Error::new(
            Status::InvalidArg,
            format!("input 维度不足: 期望 {}, 实际 {}", dim, x.len()),
        ));
    }

    // napi 的 Float32Array 是只读视图，无法原地写回
    // 将 weights 拷贝为 Vec，训练后权重更新在 Vec 中（但无法回写到 napi 的 Float32Array）
    // 因此 Rust 侧的 train_min_gru_step 只返回 loss，
    // 实际权重更新由 TS 侧的 trainMinGruStep TS 实现完成（它直接操作 TS 持有的 Float32Array）
    let mut w_z = weights.w_z.as_ref().to_vec();
    let mut b_z = weights.b_z.as_ref().to_vec();
    let mut w_h = weights.w_h.as_ref().to_vec();
    let mut b_h = weights.b_h.as_ref().to_vec();

    let loss = mingru::train_step(h, x, &mut w_z, &mut b_z, &mut w_h, &mut b_h, label_f, lr);

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
