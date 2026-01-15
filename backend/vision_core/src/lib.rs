use pyo3::prelude::*;

pub mod aura_vision;
pub mod vision_intent_memory;

#[pymodule]
fn pero_vision_core(_py: Python, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<vision_intent_memory::VisionIntentMemoryManager>()?;
    m.add_class::<vision_intent_memory::VisionProcessResult>()?;
    Ok(())
}
