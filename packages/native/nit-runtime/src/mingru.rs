//! minGRU 推理与在线训练
//!
//! 实现 "Were RNNs All We Needed?" 论文中的 minimal GRU 变体。
//!
//! 公式:
//!   x_t = W_in @ query_embedding  (投影: input_dim → hidden_dim, TS侧管理)
//!   z_t = σ(W_z @ x_t + b_z)      (门控)
//!   h̃_t = W_h @ x_t + b_h         (候选状态)
//!   h_{t+1} = (1 - z_t) ⊙ h_t + z_t ⊙ h̃_t  (状态更新)
//!
//! 参数量:
//!   W_z: hidden_dim × hidden_dim = 256×256 = 65,536
//!   b_z: hidden_dim = 256
//!   W_h: hidden_dim × hidden_dim = 65,536
//!   b_h: hidden_dim = 256
//!   总计: ~131,584 参数 = ~514KB (f32)

use rand::Rng;
use std::sync::{Mutex, OnceLock};

/// 隐状态维度 (与 TS 侧 HIDDEN_DIM 保持一致)
pub const HIDDEN_DIM: usize = 256;

/// minGRU 权重参数
pub struct MinGruWeights {
    /// 门控权重 W_z (HIDDEN_DIM × HIDDEN_DIM)
    w_z: Vec<f32>,
    /// 门控偏置 b_z (HIDDEN_DIM)
    b_z: Vec<f32>,
    /// 候选状态权重 W_h (HIDDEN_DIM × HIDDEN_DIM)
    w_h: Vec<f32>,
    /// 候选状态偏置 b_h (HIDDEN_DIM)
    b_h: Vec<f32>,
}

impl MinGruWeights {
    /// Xavier 均匀初始化
    ///
    /// AIOS 第八阶段：偏置初始化为 0.1（不再是 0），
    /// 确保 sigmoid 门控初始时有合理的开度（σ(0.1) ≈ 0.525），避免梯度消失。
    fn xavier_init() -> Self {
        let mut rng = rand::thread_rng();
        let fan = HIDDEN_DIM as f32;
        let limit = (6.0 / (fan + fan)).sqrt();

        let dim2 = HIDDEN_DIM * HIDDEN_DIM;
        Self {
            w_z: (0..dim2).map(|_| rng.gen_range(-limit..limit)).collect(),
            b_z: vec![0.1; HIDDEN_DIM], // 偏置 0.1，不再是 0
            w_h: (0..dim2).map(|_| rng.gen_range(-limit..limit)).collect(),
            b_h: vec![0.1; HIDDEN_DIM], // 偏置 0.1，不再是 0
        }
    }
}

/// 全局权重单例 (线程安全)
static GLOBAL_WEIGHTS: OnceLock<Mutex<MinGruWeights>> = OnceLock::new();

fn get_weights() -> &'static Mutex<MinGruWeights> {
    GLOBAL_WEIGHTS.get_or_init(|| Mutex::new(MinGruWeights::xavier_init()))
}

/// Sigmoid 激活函数
#[inline(always)]
fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

/// minGRU 前向推理
///
/// 输入: hidden (HIDDEN_DIM), input (HIDDEN_DIM, 已由 TS 侧投影)
/// 输出: 新的 hidden (HIDDEN_DIM)
///
/// 耗时: <2ms (纯 CPU, 无 GPU 依赖)
pub fn forward(hidden: &[f32], input: &[f32]) -> Vec<f32> {
    assert!(hidden.len() >= HIDDEN_DIM, "隐状态维度不足");
    assert!(input.len() >= HIDDEN_DIM, "输入维度不足");

    let weights = get_weights().lock().unwrap();

    let mut z = vec![0.0f32; HIDDEN_DIM];
    let mut h_candidate = vec![0.0f32; HIDDEN_DIM];
    let mut result = vec![0.0f32; HIDDEN_DIM];

    // 1. z_t = σ(W_z @ x_t + b_z) — 门控
    for i in 0..HIDDEN_DIM {
        let mut sum = weights.b_z[i];
        for j in 0..HIDDEN_DIM {
            sum += weights.w_z[i * HIDDEN_DIM + j] * input[j];
        }
        z[i] = sigmoid(sum);
    }

    // 2. h̃_t = W_h @ x_t + b_h — 候选状态
    for i in 0..HIDDEN_DIM {
        let mut sum = weights.b_h[i];
        for j in 0..HIDDEN_DIM {
            sum += weights.w_h[i * HIDDEN_DIM + j] * input[j];
        }
        h_candidate[i] = sum;
    }

    // 3. h_{t+1} = (1 - z_t) ⊙ h_t + z_t ⊙ h̃_t — 状态混合
    for i in 0..HIDDEN_DIM {
        result[i] = (1.0 - z[i]) * hidden[i] + z[i] * h_candidate[i];
    }

    result
}

/// 投影输入向量到隐状态空间
///
/// query_embedding: (input_dim,) — 原始 embedding (如 1536 维)
/// proj_matrix: (input_dim × HIDDEN_DIM) — 投影矩阵 W_in, 由 TS 侧管理
///
/// 输出: (HIDDEN_DIM,) — 投影后向量
pub fn project(query_embedding: &[f32], proj_matrix: &[f32]) -> Vec<f32> {
    let input_dim = query_embedding.len();
    let mut result = vec![0.0f32; HIDDEN_DIM];

    for j in 0..HIDDEN_DIM {
        let mut sum = 0.0f32;
        for i in 0..input_dim {
            sum += query_embedding[i] * proj_matrix[i * HIDDEN_DIM + j];
        }
        result[j] = sum;
    }

    result
}

/// 训练样本
pub struct TrainingSample {
    pub hidden_state: Vec<f32>,
    pub query_embedding: Vec<f32>,
    pub label: f32, // 1.0 = positive, 0.0 = negative
}

/// minGRU 在线训练 (SGD)
///
/// 简化策略:
/// 1. 前向: 用 query_embedding 的前 HIDDEN_DIM 维 (已投影) 做 GRU 更新
/// 2. 目标: 二分类交叉熵 L = -[y·log(p) + (1-y)·log(1-p)]
///    其中 p = σ(mean(h_{t+1}))
/// 3. 反向传播更新 W_z, b_z, W_h, b_h
///
/// 返回: 平均训练损失
pub fn train(samples: &[TrainingSample], learning_rate: f32) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    let mut weights = get_weights().lock().unwrap();

    let dim2 = HIDDEN_DIM * HIDDEN_DIM;
    let mut grad_w_z = vec![0.0f32; dim2];
    let mut grad_b_z = vec![0.0f32; HIDDEN_DIM];
    let mut grad_w_h = vec![0.0f32; dim2];
    let mut grad_b_h = vec![0.0f32; HIDDEN_DIM];

    let mut total_loss = 0.0f32;
    let n = samples.len() as f32;

    for sample in samples {
        let hidden = &sample.hidden_state;
        let input = &sample.query_embedding;
        let input_len = input.len().min(HIDDEN_DIM);

        // ── 前向 ──

        let mut z = vec![0.0f32; HIDDEN_DIM];
        let mut h_cand = vec![0.0f32; HIDDEN_DIM];

        // z_t = σ(W_z @ x + b_z)
        for i in 0..HIDDEN_DIM {
            let mut s = weights.b_z[i];
            for j in 0..input_len {
                s += weights.w_z[i * HIDDEN_DIM + j] * input[j];
            }
            z[i] = sigmoid(s);
        }

        // h̃ = W_h @ x + b_h
        for i in 0..HIDDEN_DIM {
            let mut s = weights.b_h[i];
            for j in 0..input_len {
                s += weights.w_h[i * HIDDEN_DIM + j] * input[j];
            }
            h_cand[i] = s;
        }

        // h_new = (1-z)⊙h + z⊙h̃
        let mut h_new = vec![0.0f32; HIDDEN_DIM];
        let h_len = hidden.len().min(HIDDEN_DIM);
        for i in 0..HIDDEN_DIM {
            let h_i = if i < h_len { hidden[i] } else { 0.0 };
            h_new[i] = (1.0 - z[i]) * h_i + z[i] * h_cand[i];
        }

        // p = σ(mean(h_new))
        let h_mean: f32 = h_new.iter().sum::<f32>() / HIDDEN_DIM as f32;
        let p = sigmoid(h_mean);

        // 交叉熵损失
        let y = sample.label;
        let eps = 1e-7f32;
        let loss = -(y * (p + eps).ln() + (1.0 - y) * (1.0 - p + eps).ln());
        total_loss += loss;

        // ── 反向传播 ──

        let dp = -y / (p + eps) + (1.0 - y) / (1.0 - p + eps);
        let dh_mean = dp * p * (1.0 - p);
        let dh_scale = dh_mean / HIDDEN_DIM as f32;

        for i in 0..HIDDEN_DIM {
            let h_i = if i < h_len { hidden[i] } else { 0.0 };

            // dL/dz_i = dh_scale * (h̃_i - h_i)
            let dz = dh_scale * (h_cand[i] - h_i);
            // dz/dz_pre = z*(1-z) (sigmoid导数)
            let dz_pre = dz * z[i] * (1.0 - z[i]);

            // dL/dh̃_i = dh_scale * z_i
            let dh_cand = dh_scale * z[i];

            // 累积梯度
            for j in 0..input_len {
                grad_w_z[i * HIDDEN_DIM + j] += dz_pre * input[j];
                grad_w_h[i * HIDDEN_DIM + j] += dh_cand * input[j];
            }
            grad_b_z[i] += dz_pre;
            grad_b_h[i] += dh_cand;
        }
    }

    // ── SGD 更新 ──
    let lr = learning_rate / n;
    for i in 0..dim2 {
        weights.w_z[i] -= lr * grad_w_z[i];
        weights.w_h[i] -= lr * grad_w_h[i];
    }
    for i in 0..HIDDEN_DIM {
        weights.b_z[i] -= lr * grad_b_z[i];
        weights.b_h[i] -= lr * grad_b_h[i];
    }

    total_loss / n
}

// ─────────────────────────────────────────────
// 带外部权重的 API（AIOS 第八阶段新增）
// ─────────────────────────────────────────────

/// minGRU 权重包（外部传入，避免依赖全局单例）
///
/// 字段布局与 MinGruWeights 一致，但用于 napi 跨边界传递。
/// forward 用 `&` 不可变借用，train 用 `&mut` 可变借用。
pub struct ExternalWeights<'a> {
    pub w_z: &'a [f32],
    pub b_z: &'a [f32],
    pub w_h: &'a [f32],
    pub b_h: &'a [f32],
}

/// 带外部权重的 minGRU 前向推理
///
/// AIOS 第八阶段：权重由 TS 侧管理并持久化，不再依赖全局单例。
/// 数学公式与 forward() 完全一致，只是权重来源不同。
///
/// 耗时: <2ms (纯 CPU, 无 GPU 依赖)
pub fn forward_with_weights(hidden: &[f32], input: &[f32], weights: &ExternalWeights) -> Vec<f32> {
    assert!(hidden.len() >= HIDDEN_DIM, "隐状态维度不足");
    assert!(input.len() >= HIDDEN_DIM, "输入维度不足");
    assert!(weights.w_z.len() >= HIDDEN_DIM * HIDDEN_DIM, "W_z 维度不足");
    assert!(weights.b_z.len() >= HIDDEN_DIM, "b_z 维度不足");
    assert!(weights.w_h.len() >= HIDDEN_DIM * HIDDEN_DIM, "W_h 维度不足");
    assert!(weights.b_h.len() >= HIDDEN_DIM, "b_h 维度不足");

    let mut z = vec![0.0f32; HIDDEN_DIM];
    let mut h_candidate = vec![0.0f32; HIDDEN_DIM];
    let mut result = vec![0.0f32; HIDDEN_DIM];

    // 1. z_t = σ(W_z @ x_t + b_z) — 门控
    for i in 0..HIDDEN_DIM {
        let mut sum = weights.b_z[i];
        for j in 0..HIDDEN_DIM {
            sum += weights.w_z[i * HIDDEN_DIM + j] * input[j];
        }
        z[i] = sigmoid(sum);
    }

    // 2. h̃_t = W_h @ x_t + b_h — 候选状态
    for i in 0..HIDDEN_DIM {
        let mut sum = weights.b_h[i];
        for j in 0..HIDDEN_DIM {
            sum += weights.w_h[i * HIDDEN_DIM + j] * input[j];
        }
        h_candidate[i] = sum;
    }

    // 3. h_{t+1} = (1 - z_t) ⊙ h_t + z_t ⊙ h̃_t — 状态混合
    for i in 0..HIDDEN_DIM {
        result[i] = (1.0 - z[i]) * hidden[i] + z[i] * h_candidate[i];
    }

    result
}

/// 带外部权重的 minGRU 单步 SGD 训练
///
/// AIOS 第八阶段：权重由 TS 侧管理并持久化，训练时原地更新传入的权重数组。
/// 数学逻辑与 train() 的单步一致，但：
/// - 只处理单个样本（不批量平均）
/// - 权重原地更新（不通过全局单例）
/// - 增加梯度裁剪（防止早期大梯度）
///
/// 返回: 单步训练损失
pub fn train_step(
    hidden: &[f32],
    input: &[f32],
    w_z: &mut [f32],
    b_z: &mut [f32],
    w_h: &mut [f32],
    b_h: &mut [f32],
    label: f32,
    learning_rate: f32,
) -> f32 {
    assert!(hidden.len() >= HIDDEN_DIM, "隐状态维度不足");
    assert!(input.len() >= HIDDEN_DIM, "输入维度不足");
    assert!(w_z.len() >= HIDDEN_DIM * HIDDEN_DIM, "W_z 维度不足");
    assert!(b_z.len() >= HIDDEN_DIM, "b_z 维度不足");
    assert!(w_h.len() >= HIDDEN_DIM * HIDDEN_DIM, "W_h 维度不足");
    assert!(b_h.len() >= HIDDEN_DIM, "b_h 维度不足");

    let mut z = vec![0.0f32; HIDDEN_DIM];
    let mut h_cand = vec![0.0f32; HIDDEN_DIM];
    let mut h_new = vec![0.0f32; HIDDEN_DIM];

    // ── 前向传播 ──

    // z_t = σ(W_z @ x + b_z)
    for i in 0..HIDDEN_DIM {
        let mut s = b_z[i];
        for j in 0..HIDDEN_DIM {
            s += w_z[i * HIDDEN_DIM + j] * input[j];
        }
        z[i] = sigmoid(s);
    }

    // h̃ = W_h @ x + b_h
    for i in 0..HIDDEN_DIM {
        let mut s = b_h[i];
        for j in 0..HIDDEN_DIM {
            s += w_h[i * HIDDEN_DIM + j] * input[j];
        }
        h_cand[i] = s;
    }

    // h_new = (1-z)⊙h + z⊙h̃
    for i in 0..HIDDEN_DIM {
        h_new[i] = (1.0 - z[i]) * hidden[i] + z[i] * h_cand[i];
    }

    // p = σ(mean(h_new))
    let h_mean: f32 = h_new.iter().sum::<f32>() / HIDDEN_DIM as f32;
    let p = sigmoid(h_mean);

    // 交叉熵损失
    let eps = 1e-7f32;
    let loss = -(label * (p + eps).ln() + (1.0 - label) * (1.0 - p + eps).ln());

    // ── 反向传播 ──

    let dp = -label / (p + eps) + (1.0 - label) / (1.0 - p + eps);
    let dh_mean = dp * p * (1.0 - p);
    let dh_scale = dh_mean / HIDDEN_DIM as f32;

    for i in 0..HIDDEN_DIM {
        let dz = dh_scale * (h_cand[i] - hidden[i]);
        let dz_pre = dz * z[i] * (1.0 - z[i]);
        let dh_cand = dh_scale * z[i];

        // 梯度裁剪（防止早期大梯度，与 TS 侧一致）
        let clipped_dz_pre = dz_pre.max(-0.1).min(0.1);
        let clipped_dh_cand = dh_cand.max(-0.1).min(0.1);

        // 原地更新权重
        for j in 0..HIDDEN_DIM {
            w_z[i * HIDDEN_DIM + j] -= learning_rate * clipped_dz_pre * input[j];
            w_h[i * HIDDEN_DIM + j] -= learning_rate * clipped_dh_cand * input[j];
        }
        b_z[i] -= learning_rate * clipped_dz_pre;
        b_h[i] -= learning_rate * clipped_dh_cand;
    }

    loss
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_forward_output_dim() {
        let hidden = vec![0.0f32; HIDDEN_DIM];
        let input = vec![0.1f32; HIDDEN_DIM];
        let result = forward(&hidden, &input);
        assert_eq!(result.len(), HIDDEN_DIM);
    }

    #[test]
    fn test_forward_nonzero() {
        let hidden = vec![0.0f32; HIDDEN_DIM];
        let input = vec![0.5f32; HIDDEN_DIM];
        let result = forward(&hidden, &input);
        // 至少有一些非零值
        let sum: f32 = result.iter().map(|x| x.abs()).sum();
        assert!(sum > 0.0);
    }

    #[test]
    fn test_project_output_dim() {
        let query = vec![0.1f32; 1536];
        let proj = vec![0.01f32; 1536 * HIDDEN_DIM];
        let result = project(&query, &proj);
        assert_eq!(result.len(), HIDDEN_DIM);
    }

    #[test]
    fn test_train_returns_loss() {
        let samples = vec![
            TrainingSample {
                hidden_state: vec![0.0; HIDDEN_DIM],
                query_embedding: vec![0.1; HIDDEN_DIM],
                label: 1.0,
            },
            TrainingSample {
                hidden_state: vec![0.0; HIDDEN_DIM],
                query_embedding: vec![-0.1; HIDDEN_DIM],
                label: 0.0,
            },
        ];
        let loss = train(&samples, 0.001);
        assert!(loss > 0.0);
        assert!(loss.is_finite());
    }

    // ── AIOS 第八阶段：带外部权重的 API 测试 ──

    /// 辅助函数：构造测试用外部权重
    fn make_test_weights() -> (Vec<f32>, Vec<f32>, Vec<f32>, Vec<f32>) {
        let dim2 = HIDDEN_DIM * HIDDEN_DIM;
        let w_z: Vec<f32> = (0..dim2).map(|i| 0.01 * (i as f32 % 7.0 - 3.0)).collect();
        let b_z: Vec<f32> = vec![0.1; HIDDEN_DIM];
        let w_h: Vec<f32> = (0..dim2).map(|i| 0.01 * (i as f32 % 5.0 - 2.0)).collect();
        let b_h: Vec<f32> = vec![0.1; HIDDEN_DIM];
        (w_z, b_z, w_h, b_h)
    }

    #[test]
    fn test_forward_with_weights_output_dim() {
        let hidden = vec![0.0f32; HIDDEN_DIM];
        let input = vec![0.1f32; HIDDEN_DIM];
        let (w_z, b_z, w_h, b_h) = make_test_weights();
        let weights = ExternalWeights { w_z: &w_z, b_z: &b_z, w_h: &w_h, b_h: &b_h };
        let result = forward_with_weights(&hidden, &input, &weights);
        assert_eq!(result.len(), HIDDEN_DIM);
    }

    #[test]
    fn test_forward_with_weights_nonzero() {
        let hidden = vec![0.0f32; HIDDEN_DIM];
        let input = vec![0.5f32; HIDDEN_DIM];
        let (w_z, b_z, w_h, b_h) = make_test_weights();
        let weights = ExternalWeights { w_z: &w_z, b_z: &b_z, w_h: &w_h, b_h: &b_h };
        let result = forward_with_weights(&hidden, &input, &weights);
        let sum: f32 = result.iter().map(|x| x.abs()).sum();
        assert!(sum > 0.0, "前向传播应产生非零输出");
    }

    #[test]
    fn test_forward_with_weights_bias_effect() {
        // 验证偏置确实起作用：相同权重，不同偏置应产生不同结果
        let hidden = vec![0.0f32; HIDDEN_DIM];
        let input = vec![0.0f32; HIDDEN_DIM]; // 全零输入，只看偏置效果
        let dim2 = HIDDEN_DIM * HIDDEN_DIM;
        let w_z = vec![0.0f32; dim2];
        let w_h = vec![0.0f32; dim2];

        let b_zero = vec![0.0f32; HIDDEN_DIM];
        let b_nonzero = vec![0.5f32; HIDDEN_DIM];

        let weights_zero = ExternalWeights { w_z: &w_z, b_z: &b_zero, w_h: &w_h, b_h: &b_zero };
        let weights_nonzero = ExternalWeights { w_z: &w_z, b_z: &b_nonzero, w_h: &w_h, b_h: &b_nonzero };

        let result_zero = forward_with_weights(&hidden, &input, &weights_zero);
        let result_nonzero = forward_with_weights(&hidden, &input, &weights_nonzero);

        // 全零偏置 + 全零输入 → σ(0)=0.5，h_new = 0.5*0 + 0.5*0 = 0
        let sum_zero: f32 = result_zero.iter().map(|x| x.abs()).sum();
        assert!(sum_zero < 1e-6, "全零偏置+全零输入应产生零输出");

        // 非零偏置 + 全零输入 → h̃ = 0.5（非零），h_new = z*0.5 ≠ 0
        let sum_nonzero: f32 = result_nonzero.iter().map(|x| x.abs()).sum();
        assert!(sum_nonzero > 0.1, "非零偏置应产生非零输出");
    }

    #[test]
    fn test_train_step_returns_loss() {
        let hidden = vec![0.0f32; HIDDEN_DIM];
        let input = vec![0.1f32; HIDDEN_DIM];
        let (mut w_z, mut b_z, mut w_h, mut b_h) = make_test_weights();

        let loss = train_step(&hidden, &input, &mut w_z, &mut b_z, &mut w_h, &mut b_h, 1.0, 0.001);
        assert!(loss > 0.0, "损失应为正");
        assert!(loss.is_finite(), "损失应有限");
    }

    #[test]
    fn test_train_step_updates_weights() {
        // 验证训练确实更新了权重
        let hidden = vec![0.0f32; HIDDEN_DIM];
        let input = vec![0.5f32; HIDDEN_DIM];
        let (mut w_z, mut b_z, mut w_h, mut b_h) = make_test_weights();

        // 保存原始权重用于比较
        let w_z_orig = w_z.clone();
        let b_z_orig = b_z.clone();

        let _ = train_step(&hidden, &input, &mut w_z, &mut b_z, &mut w_h, &mut b_h, 1.0, 0.01);

        // 权重应该发生变化
        let w_z_changed = w_z.iter().zip(w_z_orig.iter()).any(|(a, b)| (a - b).abs() > 1e-10);
        let b_z_changed = b_z.iter().zip(b_z_orig.iter()).any(|(a, b)| (a - b).abs() > 1e-10);
        assert!(w_z_changed, "W_z 应被训练更新");
        assert!(b_z_changed, "b_z 应被训练更新");
    }
}
