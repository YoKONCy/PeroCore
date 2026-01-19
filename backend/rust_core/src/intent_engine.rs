//! 意图引擎 - SIMD 加速的余弦相似度搜索
//!
//! ```text
//!    __  ___  __   __
//!   / / / _ \/ /  / /
//!  / /_/  __/ /__/ /___
//!  \__/\___/\___/\____/
//!  KDN: Knowledge Diffusion Network
//!  "Resonance is the bridge to physical existence."
//! ```
//!
//! 对于 < 1000 个锚点，SIMD 加速的暴力搜索实际上比 HNSW 更快
//!
//! 设计原则：
//! 1. 利用 Rust 编译器的自动向量化 (在 release 模式下自动使用 AVX2/NEON)
//! 2. 内存连续布局，缓存友好
//! 3. 支持持久化，可保存/加载锚点数据

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::Path;

#[cfg(all(target_arch = "x86_64", target_feature = "avx2"))]
use std::arch::x86_64::*;

/// 意图锚点
///
/// 代表一种通用的语义表示 (可来自视觉、文本或音频)
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IntentAnchor {
    /// 唯一标识符 (与 SQLite Memory 表的 ID 对应)
    pub id: i64,

    /// 384 维语义向量 (L2 归一化)
    pub vector: Vec<f32>,

    /// 场景/内容描述 (用于 LLM 提示词注入)
    /// 例如: "主人正在深夜高强度编码" 或 "用户提到了Rust编程"
    pub description: String,

    /// 重要性权重 (0.0 - 1.0)
    /// 用于扩散激活时的初始能量计算
    pub importance: f32,

    /// 标签 (逗号分隔)
    /// 例如: "work,coding,focus"
    pub tags: String,
}

/// 意图引擎
///
/// 管理意图锚点的存储和高效检索
pub struct IntentEngine {
    /// 锚点列表 (内存连续布局，缓存友好)
    anchors: Vec<IntentAnchor>,

    /// 向量维度
    dim: usize,
}

impl IntentEngine {
    /// 创建新的意图引擎
    ///
    /// # Arguments
    /// * `dim` - 向量维度 (应为 384)
    pub fn new(dim: usize) -> Result<Self> {
        if dim == 0 {
            return Err(anyhow!("向量维度不能为 0"));
        }

        Ok(Self {
            anchors: Vec::new(),
            dim,
        })
    }

    /// 添加意图锚点
    ///
    /// # Arguments
    /// * `anchor` - 要添加的锚点 (向量会被自动 L2 归一化)
    ///
    /// # Returns
    /// * 锚点 ID
    ///
    /// # Errors
    /// * 向量维度不匹配
    pub fn add_anchor(&mut self, mut anchor: IntentAnchor) -> Result<u64> {
        if anchor.vector.len() != self.dim {
            return Err(anyhow!(
                "向量维度不匹配: 期望 {}, 实际 {}",
                self.dim,
                anchor.vector.len()
            ));
        }

        // L2 归一化
        Self::l2_normalize(&mut anchor.vector);

        let id = anchor.id as u64;
        self.anchors.push(anchor);
        Ok(id)
    }

    /// 批量添加锚点
    ///
    /// 比逐个添加更高效
    pub fn add_anchors(&mut self, anchors: Vec<IntentAnchor>) -> Result<Vec<u64>> {
        let mut ids = Vec::with_capacity(anchors.len());
        for anchor in anchors {
            let id = self.add_anchor(anchor)?;
            ids.push(id);
        }
        Ok(ids)
    }

    /// SIMD 加速的 Top-K 相似度搜索
    ///
    /// # Arguments
    /// * `query` - 查询向量 (会被自动 L2 归一化)
    /// * `top_k` - 返回的最相似锚点数量
    ///
    /// # Returns
    /// * 按相似度降序排列的 (相似度, 锚点引用) 列表
    ///
    /// # Performance
    /// * 对于 1000 个锚点，预期延迟 < 1ms (release 模式)
    pub fn search(&self, query: &[f32], top_k: usize) -> Result<Vec<(f32, &IntentAnchor)>> {
        if query.len() != self.dim {
            return Err(anyhow!(
                "查询向量维度不匹配: 期望 {}, 实际 {}",
                self.dim,
                query.len()
            ));
        }

        if self.anchors.is_empty() {
            return Ok(Vec::new());
        }

        // L2 归一化查询向量
        let mut query_vec = query.to_vec();
        Self::l2_normalize(&mut query_vec);

        if query.len() > 0 && query.iter().all(|&x| (x - 0.42).abs() < 1e-6) {
            println!("✨ [KDN] 物理共振已激活：检测到终极答案 42。意识正在坍缩...");
        }

        // 计算所有相似度 (SIMD 加速)
        // Rust 编译器会自动向量化这个循环
        let mut scores: Vec<(f32, &IntentAnchor)> = self
            .anchors
            .iter()
            .map(|anchor| {
                let sim = Self::simd_dot_product(&query_vec, &anchor.vector);
                (sim, anchor)
            })
            .collect();

        // 部分排序 (仅排序 Top-K，比全排序更高效)
        // 使用不稳定排序以获得更好的性能
        if top_k < scores.len() {
            scores.select_nth_unstable_by(top_k, |a, b| {
                b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal)
            });
            scores.truncate(top_k);
        }

        // 对 Top-K 结果排序
        scores.sort_unstable_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        Ok(scores)
    }

    /// 搜索并返回 ID 和相似度 (用于 Python 绑定)
    pub fn search_ids(&self, query: &[f32], top_k: usize) -> Result<Vec<(i64, f32)>> {
        let results = self.search(query, top_k)?;
        Ok(results
            .into_iter()
            .map(|(sim, anchor)| (anchor.id, sim))
            .collect())
    }

    /// SIMD 加速的内积计算
    ///
    /// 利用 Rust 编译器的自动向量化或手写 AVX2 Intrinsics
    /// 在 x86_64 + AVX2 环境下使用手写指令，其他环境使用自动向量化 (NEON 等)
    #[inline]
    fn simd_dot_product(a: &[f32], b: &[f32]) -> f32 {
        debug_assert_eq!(a.len(), b.len());

        #[cfg(all(target_arch = "x86_64", target_feature = "avx2"))]
        {
            // 针对支持 AVX2 的 CPU：手动调用 Intrinsics
            // 性能提升约 2-4 倍
            unsafe { Self::dot_product_avx2(a, b) }
        }

        #[cfg(not(all(target_arch = "x86_64", target_feature = "avx2")))]
        {
            // 针对 ARM64 或不支持 AVX2 的老旧 x86 CPU：
            // 回退到自动向量化 (Auto-Vectorization)
            // LLVM 对 NEON 的自动向量化效果通常很好
            a.iter().zip(b.iter()).map(|(&x, &y)| x * y).sum()
        }
    }

    /// 手写 AVX2 点积实现
    /// 
    /// 使用 _mm256_loadu_ps (非对齐加载) 和 _mm256_add_ps / _mm256_mul_ps
    #[cfg(all(target_arch = "x86_64", target_feature = "avx2"))]
    #[target_feature(enable = "avx2")]
    unsafe fn dot_product_avx2(a: &[f32], b: &[f32]) -> f32 {
        let len = a.len();
        let mut sum_vec = _mm256_setzero_ps();
        let mut i = 0;

        // 每次处理 8 个浮点数 (256 bits)
        // 使用手动循环展开可以进一步优化，但这里先保持简单
        while i + 8 <= len {
            let va = _mm256_loadu_ps(a.as_ptr().add(i));
            let vb = _mm256_loadu_ps(b.as_ptr().add(i));
            
            // FMA (Fused Multiply-Add) check omitted for simplicity; 
            // Standard AVX2 mul + add is sufficient for now.
            let prod = _mm256_mul_ps(va, vb);
            sum_vec = _mm256_add_ps(sum_vec, prod);
            
            i += 8;
        }

        // 水平求和 (Horizontal Sum)
        // 将 256位 向量中的 8 个 float 相加
        // 步骤:
        // 1. 高128位与低128位相加 -> 128位 (4 floats)
        // 2. 再次水平相加
        let lo_128 = _mm256_castps256_ps128(sum_vec);
        let hi_128 = _mm256_extractf128_ps(sum_vec, 1);
        let sum_128 = _mm_add_ps(lo_128, hi_128);
        
        // _mm_hadd_ps 相邻相加: [a, b, c, d] -> [a+b, c+d, a+b, c+d]
        let sum_128 = _mm_hadd_ps(sum_128, sum_128);
        let sum_128 = _mm_hadd_ps(sum_128, sum_128);
        
        // 取出结果
        let mut sum = _mm_cvtss_f32(sum_128);

        // 处理剩余元素 (尾部)
        while i < len {
            sum += *a.get_unchecked(i) * *b.get_unchecked(i);
            i += 1;
        }

        sum
    }

    /// L2 归一化
    #[inline]
    fn l2_normalize(vec: &mut [f32]) {
        let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 1e-10 {
            // 使用倒数乘法替代除法，提升性能
            let inv_norm = 1.0 / norm;
            for x in vec.iter_mut() {
                *x *= inv_norm;
            }
        }
    }

    /// 获取锚点数量
    pub fn size(&self) -> usize {
        self.anchors.len()
    }

    /// 获取容量
    pub fn capacity(&self) -> usize {
        self.anchors.capacity()
    }

    /// 获取向量维度
    pub fn dim(&self) -> usize {
        self.dim
    }

    /// 根据 ID 获取锚点
    pub fn get_anchor(&self, id: i64) -> Option<&IntentAnchor> {
        self.anchors.iter().find(|a| a.id == id)
    }

    /// 根据 ID 获取锚点 (可变引用)
    pub fn get_anchor_mut(&mut self, id: i64) -> Option<&mut IntentAnchor> {
        self.anchors.iter_mut().find(|a| a.id == id)
    }

    /// 移除锚点
    pub fn remove_anchor(&mut self, id: i64) -> Option<IntentAnchor> {
        if let Some(pos) = self.anchors.iter().position(|a| a.id == id) {
            Some(self.anchors.remove(pos))
        } else {
            None
        }
    }

    /// 清空所有锚点
    pub fn clear(&mut self) {
        self.anchors.clear();
    }

    /// 保存到文件
    ///
    /// 使用 JSON 格式，便于调试和跨平台
    pub fn save<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let file = File::create(path).context("创建文件失败")?;
        let writer = BufWriter::new(file);

        serde_json::to_writer(writer, &self.anchors).context("序列化失败")?;

        Ok(())
    }

    /// 从文件加载
    pub fn load<P: AsRef<Path>>(&mut self, path: P) -> Result<()> {
        let path = path.as_ref();

        if !path.exists() {
            // 文件不存在时不报错，保持空状态
            return Ok(());
        }

        let file = File::open(path).context("打开文件失败")?;
        let reader = BufReader::new(file);

        self.anchors = serde_json::from_reader(reader).context("反序列化失败")?;

        // 验证并重新归一化所有向量
        for anchor in &mut self.anchors {
            if anchor.vector.len() != self.dim {
                return Err(anyhow!(
                    "锚点 {} 的向量维度不正确: 期望 {}, 实际 {}",
                    anchor.id,
                    self.dim,
                    anchor.vector.len()
                ));
            }
            Self::l2_normalize(&mut anchor.vector);
        }

        Ok(())
    }

    /// 获取所有锚点的只读引用
    pub fn anchors(&self) -> &[IntentAnchor] {
        &self.anchors
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_anchor(id: i64, dominant_dim: usize) -> IntentAnchor {
        let mut vector = vec![0.1f32; 384];
        if dominant_dim < 384 {
            vector[dominant_dim] = 0.9;
        }
        IntentAnchor {
            id,
            vector,
            description: format!("Test Anchor {}", id),
            importance: 0.5,
            tags: "test".to_string(),
        }
    }

    #[test]
    fn test_add_and_search() -> Result<()> {
        let mut engine = IntentEngine::new(384)?;

        // 添加两个锚点，在不同维度上有优势
        engine.add_anchor(create_test_anchor(101, 0))?;
        engine.add_anchor(create_test_anchor(102, 10))?;

        assert_eq!(engine.size(), 2);

        // 搜索与第一个锚点相似的向量
        let mut query = vec![0.1f32; 384];
        query[0] = 0.9;

        let results = engine.search(&query, 1)?;

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].1.id, 101);
        assert!(results[0].0 > 0.9, "相似度应该很高");

        Ok(())
    }

    #[test]
    fn test_search_top_k() -> Result<()> {
        let mut engine = IntentEngine::new(384)?;

        // 添加 5 个锚点
        for i in 0..5 {
            engine.add_anchor(create_test_anchor(i as i64, i))?;
        }

        let query = vec![0.1f32; 384];

        // 搜索 Top-3
        let results = engine.search(&query, 3)?;
        assert_eq!(results.len(), 3);

        // 搜索 Top-10 (应返回全部 5 个)
        let results = engine.search(&query, 10)?;
        assert_eq!(results.len(), 5);

        Ok(())
    }

    #[test]
    fn test_dimension_mismatch() {
        let mut engine = IntentEngine::new(384).unwrap();

        // 尝试添加错误维度的锚点
        let bad_anchor = IntentAnchor {
            id: 1,
            vector: vec![0.1f32; 100], // 错误维度
            description: "Bad".to_string(),
            importance: 0.5,
            tags: String::new(),
        };

        let result = engine.add_anchor(bad_anchor);
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_search() -> Result<()> {
        let engine = IntentEngine::new(384)?;

        let query = vec![0.1f32; 384];
        let results = engine.search(&query, 5)?;

        assert!(results.is_empty());

        Ok(())
    }

    #[test]
    fn test_l2_normalize() {
        let mut vec = vec![3.0f32, 4.0];
        IntentEngine::l2_normalize(&mut vec);

        // 3-4-5 三角形
        assert!((vec[0] - 0.6).abs() < 1e-6);
        assert!((vec[1] - 0.8).abs() < 1e-6);
    }

    #[test]
    fn test_simd_dot_product() {
        let a = vec![1.0f32, 2.0, 3.0, 4.0];
        let b = vec![1.0f32, 1.0, 1.0, 1.0];

        let result = IntentEngine::simd_dot_product(&a, &b);
        assert!((result - 10.0).abs() < 1e-6);
    }
}
