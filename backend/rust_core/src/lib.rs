use pyo3::prelude::*;
use regex::Regex;

pub mod intent_engine;
// 暂时移除 Vision 相关模块，以保证 PyPI 版本的轻量和编译成功
// pub mod aura_vision;
// pub mod vision_intent_memory;

pub use intent_engine::{IntentAnchor, IntentEngine};
// pub use aura_vision::AuraVisionEncoder;
// pub use vision_intent_memory::{VisionIntentMemoryManager, VisionProcessResult};

mod cognitive_graph;
mod vector_index;

pub use cognitive_graph::CognitiveGraphEngine;
pub use vector_index::SemanticVectorIndex;

const MAX_INPUT_LENGTH: usize = 10000;

#[pyclass]
struct TextSanitizer;

#[pymethods]
impl TextSanitizer {
    #[new]
    fn new() -> Self {
        TextSanitizer
    }

    #[pyo3(text_signature = "($self, text)")]
    fn sanitize(&self, text: &str) -> String {
        sanitize_text_content(text)
    }
}

#[pyfunction]
fn sanitize_text_content(text: &str) -> String {
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

    let pattern_str = r"data:image/[^;]+;base64,[^" + "\"'\\s>]+";
    let base64_pattern = Regex::new(&pattern_str).unwrap();
    let text = base64_pattern.replace_all(text, "[IMAGE_DATA]");

    let result = text.into_owned();
    let truncated: String = result.chars().take(2000).collect();
    truncated.trim().to_string()
}

/// Pero Rust Core Python 模块入口
#[pymodule]
fn pero_rust_core(_py: Python, m: &Bound<'_, PyModule>) -> PyResult<()> {
    // 核心算法类
    m.add_class::<CognitiveGraphEngine>()?;
    m.add_class::<SemanticVectorIndex>()?;
    m.add_class::<TextSanitizer>()?;

    // 辅助函数
    m.add_function(wrap_pyfunction!(sanitize_text_content, m)?)?;

    Ok(())
}
