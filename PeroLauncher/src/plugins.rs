use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginCommand {
    #[serde(alias = "commandIdentifier")]
    pub command_identifier: String,
    pub description: String,
    pub parameters: Option<std::collections::HashMap<String, String>>,
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

pub fn get_plugins_dir() -> PathBuf {
    let current_dir = std::env::current_dir().unwrap();
    // Logic adapted from napcat.rs
    let root = if current_dir.ends_with("src-tauri") || current_dir.ends_with("PeroLauncher") {
        current_dir.parent().unwrap().to_path_buf()
    } else if current_dir.join("backend").exists() {
        current_dir.clone()
    } else {
        current_dir.clone()
    };
    root.join("backend/nit_core/plugins")
}

#[tauri::command]
pub fn get_plugins() -> Vec<Plugin> {
    let plugins_dir = get_plugins_dir();
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
                                    let invalid_plugin = Plugin {
                                        name: path.file_name().unwrap().to_string_lossy().to_string(),
                                        display_name: Some(format!("Invalid: {}", path.file_name().unwrap().to_string_lossy())),
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
