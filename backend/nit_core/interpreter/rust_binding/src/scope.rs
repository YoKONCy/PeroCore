use pyo3::prelude::*;
use std::collections::HashMap;
use pyo3::types::PyString;

/// 内存安全的变量容器
#[pyclass(module = "nit_rust_runtime")]
pub struct NITScope {
    variables: HashMap<String, PyObject>,
    max_count: usize,
    max_string_len: usize,
}

#[pymethods]
impl NITScope {
    #[new]
    #[pyo3(signature = (max_count=100, max_string_len=100000))]
    fn new(max_count: usize, max_string_len: usize) -> Self {
        NITScope {
            variables: HashMap::new(),
            max_count,
            max_string_len,
        }
    }

    /// 设置变量值 (带严格安全检查)
    fn set(&mut self, py: Python, key: String, value: PyObject) -> PyResult<()> {
        // 1. 检查变量数量限制
        if !self.variables.contains_key(&key) && self.variables.len() >= self.max_count {
            return Err(pyo3::exceptions::PyValueError::new_err(format!(
                "Security Alert: Variable limit reached ({})",
                self.max_count
            )));
        }

        // 2. 检查字符串长度限制
        // 如果值是字符串，我们需要检查其长度
        if let Ok(py_str) = value.downcast_bound::<PyString>(py) {
            let len = py_str.len()?;
            if len > self.max_string_len {
                // 截断逻辑
                // 注意: 我们无法直接修改 PyObject，只能创建一个新的截断后的字符串
                // 或者直接拒绝
                // 这里我们选择截断并警告 (模拟原 Python 逻辑，但在 Rust 层更高效)
                
                // 为了避免巨大的内存分配，我们只取前 N 个字符
                // 这里的 slice 可能会涉及 utf-8 边界，但在 Rust 中 String 处理较好
                // 不过 PyString slice 操作在 Rust 中可能需要提取为 Rust String
                
                // 优化: 只有当确实超长时才提取内容
                let content = py_str.to_string_lossy();
                // 简单的字符截断 (注意这可能不是最快的方法，但比 Python 快)
                let truncated: String = content.chars().take(self.max_string_len).collect();
                let new_value = truncated + "... [已被 NIT Rust Scope 截断]";
                
                self.variables.insert(key, new_value.into_py(py));
                return Ok(());
            }
        }

        self.variables.insert(key, value);
        Ok(())
    }

    fn get(&self, key: &str) -> Option<PyObject> {
        self.variables.get(key).cloned()
    }
    
    fn contains(&self, key: &str) -> bool {
        self.variables.contains_key(key)
    }
    
    fn clear(&mut self) {
        self.variables.clear();
    }
    
    fn len(&self) -> usize {
        self.variables.len()
    }
    
    fn keys(&self) -> Vec<String> {
        self.variables.keys().cloned().collect()
    }
}
