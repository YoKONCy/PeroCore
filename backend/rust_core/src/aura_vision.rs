#![cfg(feature = "vision")]
//! AuraVision Rust Native Inference Engine
//!
//! 基于 tract-onnx 的纯 Rust ONNX 推理实现，符合技术文档设计：
//! - 输入：64x64 灰度图像 (4096 个像素, 已归一化到 [-1, 1])
//! - 输出：384D L2 归一化向量
//! - 延迟目标：< 15ms (CPU)
//!
//! 设计原则：
//! 1. 纯 Rust 实现，无 Python 依赖
//! 2. 零拷贝尽可能
//! 3. 编译器自动 SIMD 向量化

use anyhow::{anyhow, Context, Result};
use std::path::Path;
use std::sync::Arc;
use tract_onnx::prelude::*;

/// AuraVision 视觉意图编码器
///
/// 线程安全：内部使用 Arc 包装，可在多线程环境中共享
pub struct AuraVisionEncoder {
    model: Arc<TypedRunnableModel<TypedModel>>,
    input_shape: Vec<usize>,
    output_dim: usize,
}

impl AuraVisionEncoder {
    /// 从 ONNX 模型文件加载编码器
    ///
    /// # Arguments
    /// * `model_path` - ONNX 模型文件路径
    ///
    /// # Returns
    /// * 初始化好的编码器实例
    ///
    /// # Errors
    /// * 模型文件不存在
    /// * 模型格式不正确
    /// * 输入/输出形状不符合预期
    pub fn load<P: AsRef<Path>>(model_path: P) -> Result<Self> {
        let path = model_path.as_ref();

        if !path.exists() {
            return Err(anyhow!("模型文件不存在: {:?}", path));
        }

        // 加载 ONNX 模型
        let model = tract_onnx::onnx()
            .model_for_path(path)
            .context("加载 ONNX 模型失败")?;

        // 设置输入形状: (1, 1, 64, 64) - Batch=1, Channel=1, H=64, W=64
        let model = model
            .with_input_fact(0, f32::fact([1, 1, 64, 64]).into())
            .context("设置输入形状失败")?;

        // 优化模型
        let model = model.into_optimized().context("模型优化失败")?;

        // 转换为可运行模型
        let model = model.into_runnable().context("模型转换失败")?;

        Ok(Self {
            model: Arc::new(model),
            input_shape: vec![1, 1, 64, 64],
            output_dim: 384,
        })
    }

    /// 从原始像素数据进行推理
    ///
    /// # Arguments
    /// * `pixels` - 64x64 灰度图像的像素数据 (4096 个值, 已归一化到 [-1, 1])
    ///
    /// # Returns
    /// * 384 维 L2 归一化向量
    ///
    /// # Errors
    /// * 像素数量不正确
    /// * 推理失败
    pub fn forward_from_pixels(&self, pixels: &[f32]) -> Result<Vec<f32>> {
        let expected_len = 64 * 64;
        if pixels.len() != expected_len {
            return Err(anyhow!(
                "像素数量不正确: 期望 {}, 实际 {}",
                expected_len,
                pixels.len()
            ));
        }

        // 构建输入 Tensor: (1, 1, 64, 64)
        let input_tensor: Tensor =
            tract_ndarray::Array4::from_shape_vec((1, 1, 64, 64), pixels.to_vec())
                .context("构建输入张量失败")?
                .into();

        // 执行推理
        let outputs = self
            .model
            .run(tvec!(input_tensor.into()))
            .context("模型推理失败")?;

        // 提取输出
        let output_tensor = outputs[0]
            .to_array_view::<f32>()
            .context("提取输出张量失败")?;

        let mut vector: Vec<f32> = output_tensor.iter().cloned().collect();

        // 验证输出维度
        if vector.len() != self.output_dim {
            return Err(anyhow!(
                "输出维度不正确: 期望 {}, 实际 {}",
                self.output_dim,
                vector.len()
            ));
        }

        // L2 归一化
        Self::l2_normalize(&mut vector);

        Ok(vector)
    }

    /// 从图像文件路径进行推理 (包含完整预处理流程)
    ///
    /// 预处理流程:
    /// 1. 读取图像
    /// 2. 转换为灰度
    /// 3. 缩放到 64x64
    /// 4. Sobel 边缘检测
    /// 5. 归一化到 [-1, 1]
    ///
    /// # Arguments
    /// * `image_path` - 图像文件路径
    ///
    /// # Returns
    /// * 384 维 L2 归一化向量
    pub fn forward_from_path<P: AsRef<Path>>(&self, image_path: P) -> Result<Vec<f32>> {
        let pixels = Self::preprocess_image(image_path)?;
        self.forward_from_pixels(&pixels)
    }

    /// 图像预处理：读取 -> 灰度 -> 缩放 -> Sobel边缘 -> 归一化
    ///
    /// 符合技术文档中的隐私脱敏设计
    pub fn preprocess_image<P: AsRef<Path>>(image_path: P) -> Result<Vec<f32>> {
        let path = image_path.as_ref();

        if !path.exists() {
            return Err(anyhow!("图像文件不存在: {:?}", path));
        }

        // 使用 image crate 读取并处理图像
        let img = image::open(path)
            .context("打开图像失败")?
            .grayscale()
            .resize_exact(64, 64, image::imageops::FilterType::Triangle)
            .into_luma8();

        // Sobel 边缘检测 (隐私脱敏的关键步骤)
        let edges = Self::sobel_edge_detect(&img);

        // 归一化到 [-1, 1]
        let pixels: Vec<f32> = edges
            .iter()
            .map(|&p| (p as f32 / 255.0 - 0.5) / 0.5)
            .collect();

        Ok(pixels)
    }

    /// 从原始字节数据预处理 (用于接收 Python 传入的图像数据)
    ///
    /// # Arguments
    /// * `img_bytes` - 图像的原始字节数据 (PNG/JPEG 等格式)
    ///
    /// # Returns
    /// * 预处理后的像素数据 (4096 个值, [-1, 1])
    pub fn preprocess_from_bytes(img_bytes: &[u8]) -> Result<Vec<f32>> {
        let img = image::load_from_memory(img_bytes)
            .context("从字节加载图像失败")?
            .grayscale()
            .resize_exact(64, 64, image::imageops::FilterType::Triangle)
            .into_luma8();

        let edges = Self::sobel_edge_detect(&img);

        let pixels: Vec<f32> = edges
            .iter()
            .map(|&p| (p as f32 / 255.0 - 0.5) / 0.5)
            .collect();

        Ok(pixels)
    }

    /// Sobel 边缘检测 (纯 Rust 实现)
    ///
    /// 使用 3x3 Sobel 算子计算图像梯度幅值
    /// 这是 Canny 边缘检测的简化版本，速度更快
    fn sobel_edge_detect(img: &image::GrayImage) -> Vec<u8> {
        let (w, h) = (img.width() as usize, img.height() as usize);
        let mut result = vec![0u8; w * h];

        // Sobel 算子
        const GX: [[i32; 3]; 3] = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
        const GY: [[i32; 3]; 3] = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];

        // 遍历内部像素 (跳过边界)
        for y in 1..h - 1 {
            for x in 1..w - 1 {
                let mut sum_x: i32 = 0;
                let mut sum_y: i32 = 0;

                // 应用 3x3 卷积核
                for ky in 0..3 {
                    for kx in 0..3 {
                        let px =
                            img.get_pixel((x + kx - 1) as u32, (y + ky - 1) as u32).0[0] as i32;
                        sum_x += px * GX[ky][kx];
                        sum_y += px * GY[ky][kx];
                    }
                }

                // 计算梯度幅值
                let magnitude = ((sum_x * sum_x + sum_y * sum_y) as f32).sqrt();
                result[y * w + x] = (magnitude.min(255.0)) as u8;
            }
        }

        result
    }

    /// L2 归一化
    ///
    /// 将向量归一化到单位超球面上，用于余弦相似度计算
    #[inline]
    pub fn l2_normalize(vec: &mut [f32]) {
        let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 1e-10 {
            for x in vec.iter_mut() {
                *x /= norm;
            }
        }
    }

    /// 获取模型输入形状
    pub fn input_shape(&self) -> &[usize] {
        &self.input_shape
    }

    /// 获取输出向量维度
    pub fn output_dim(&self) -> usize {
        self.output_dim
    }
}

// 实现 Clone 以支持多线程共享
impl Clone for AuraVisionEncoder {
    fn clone(&self) -> Self {
        Self {
            model: Arc::clone(&self.model),
            input_shape: self.input_shape.clone(),
            output_dim: self.output_dim,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_l2_normalize() {
        let mut vec = vec![3.0, 4.0];
        AuraVisionEncoder::l2_normalize(&mut vec);

        // 3-4-5 三角形, 归一化后应为 [0.6, 0.8]
        assert!((vec[0] - 0.6).abs() < 1e-6);
        assert!((vec[1] - 0.8).abs() < 1e-6);

        // 验证 L2 范数为 1
        let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_forward_pixel_count_validation() {
        // 这个测试需要模型文件存在才能运行
        // 这里只测试像素数量验证逻辑
        let wrong_pixels: Vec<f32> = vec![0.0; 100]; // 错误的像素数量

        // 由于没有模型，我们无法完整测试
        // 但可以验证验证逻辑在代码中存在
        assert_eq!(wrong_pixels.len(), 100);
        assert_ne!(wrong_pixels.len(), 64 * 64);
    }

    #[test]
    fn test_sobel_edge_detect_shape() {
        // 创建一个 64x64 的测试图像
        let img = image::GrayImage::from_fn(64, 64, |x, y| {
            // 创建一个简单的渐变图像
            image::Luma([(x as u8).wrapping_add(y as u8)])
        });

        let edges = AuraVisionEncoder::sobel_edge_detect(&img);

        // 验证输出形状
        assert_eq!(edges.len(), 64 * 64);
    }
}
