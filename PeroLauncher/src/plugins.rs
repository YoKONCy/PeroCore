use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginCommand {
    #[serde(alias = "commandIdentifier")]
    pub command_identifier: String,
    pub description: String,
    pub parameters: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginCapability {
    #[serde(alias = "invocationCommands")]
    pub invocation_commands: Vec<PluginCommand>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Plugin {
    pub name: String,
    #[serde(alias = "displayName")]
    pub display_name: Option<String>,
    pub version: String,
    pub description: String,
    pub author: Option<String>,
    #[serde(alias = "pluginType")]
    pub plugin_type: String,
    #[serde(alias = "entryPoint")]
    pub entry_point: String,
    pub capabilities: Option<PluginCapability>,
    
    // Runtime fields
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub valid: bool,
}

pub fn get_plugins_dir(app: &AppHandle) -> PathBuf {
    // 1. 优先探测开发环境：检查源码目录下的 backend/nit_core/plugins
    let dev_root = crate::get_workspace_root();
    let dev_plugins_path = dev_root.join("backend/nit_core/plugins");
    if dev_plugins_path.exists() {
        return dev_plugins_path;
    }

    // 2. 释放环境 (Release)：从 Tauri 资源目录寻址
    if let Ok(resource_dir) = app.path().resource_dir() {
        let trials = [
            resource_dir.join("backend/nit_core/plugins"),
            resource_dir.join("nit_core/plugins"),
            resource_dir.join("_up_/backend/nit_core/plugins"),
            resource_dir.join("_up_/nit_core/plugins"),
        ];

        for trial in trials {
            if trial.exists() {
                return trial;
            }
        }
    }

    // 3. 最后的保底逻辑
    dev_plugins_path
}

#[tauri::command]
pub fn get_plugins(app: AppHandle) -> Vec<Plugin> {
    let plugins_dir = get_plugins_dir(&app);
    let mut plugins = Vec::new();

    if let Ok(entries) = fs::read_dir(plugins_dir) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_dir() {
                    let desc_path = path.join("description.json");
                    if desc_path.exists() {
                        if let Ok(content) = fs::read_to_string(&desc_path) {
                            match serde_json::from_str::<Plugin>(&content) {
                                Ok(mut plugin) => {
                                    plugin.path = path.to_string_lossy().to_string();
                                    plugin.valid = true;
                                    
                                    // Default display name
                                    if plugin.display_name.is_none() {
                                        plugin.display_name = Some(plugin.name.clone());
                                    }
                                    
                                    plugins.push(plugin);
                                },
                                Err(e) => {
                                    println!("Failed to parse plugin at {:?}: {}", path, e);
                                    // Optionally return an invalid plugin entry so UI knows it failed
                                    let safe_name = path.file_name()
                                        .unwrap_or_else(|| std::ffi::OsStr::new("unknown"))
                                        .to_string_lossy();
                                        
                                    let invalid_plugin = Plugin {
                                        name: safe_name.to_string(),
                                        display_name: Some(format!("Invalid: {}", safe_name)),
                                        version: "0.0.0".to_string(),
                                        description: format!("Parse error: {}", e),
                                        author: None,
                                        plugin_type: "unknown".to_string(),
                                        entry_point: "".to_string(),
                                        capabilities: None,
                                        path: path.to_string_lossy().to_string(),
                                        valid: false,
                                    };
                                    plugins.push(invalid_plugin);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    plugins
}
