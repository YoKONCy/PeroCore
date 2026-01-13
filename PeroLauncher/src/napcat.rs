use std::path::{Path, PathBuf};
use std::process::{Command, Child, Stdio};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::{Arc, Mutex};
use std::fs;
use std::io::{self, BufRead, BufReader};
use std::thread;
use tauri::{AppHandle, Emitter};
use winreg::enums::*;
use winreg::RegKey;
use zip::ZipArchive;
use reqwest::blocking::Client; // Using blocking for simplicity in spawned threads

use tauri::Manager;

pub struct NapCatState {
    pub child: Arc<Mutex<Option<Child>>>,
    pub stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
}

impl NapCatState {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
        }
    }
}

pub fn get_napcat_dir(app: &AppHandle) -> PathBuf {
    // 1. 优先探测开发环境
    let dev_root = crate::get_workspace_root();
    let dev_path = dev_root.join("backend/nit_core/plugins/social_adapter/NapCat");
    if dev_path.exists() {
        return dev_path;
    }

    // 2. 释放环境 (Release)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let trials = [
            resource_dir.join("backend/nit_core/plugins/social_adapter/NapCat"),
            resource_dir.join("nit_core/plugins/social_adapter/NapCat"),
            resource_dir.join("_up_/backend/nit_core/plugins/social_adapter/NapCat"),
            resource_dir.join("_up_/nit_core/plugins/social_adapter/NapCat"),
        ];

        for trial in trials {
            if trial.exists() {
                return trial;
            }
        }
    }

    dev_path
}

fn is_social_enabled(app: &AppHandle) -> bool {
    // 优先从配置目录读取 (打包后的配置通常在 app_data_dir)
    let config_path = if let Ok(data_dir) = app.path().app_data_dir() {
        data_dir.join("data/config.json")
    } else {
        crate::get_workspace_root().join("backend/config.json")
    };

    if !config_path.exists() {
        // 回退到源码目录
        let dev_config = crate::get_workspace_root().join("backend/config.json");
        if !dev_config.exists() {
             return true; 
        }
        if let Ok(content) = fs::read_to_string(dev_config) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                return v["enable_social_mode"].as_bool().unwrap_or(true);
            }
        }
        return true;
    }

    if let Ok(content) = fs::read_to_string(config_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            return v["enable_social_mode"].as_bool().unwrap_or(true);
        }
    }
    true
}

pub fn emit_log(app: &AppHandle, msg: String) {
    let _ = app.emit("napcat-log", msg);
}

pub fn check_napcat_installed(app: &AppHandle) -> bool {
    let dir = get_napcat_dir(app);
    let exe = dir.join("NapCat.Shell.exe");
    let mjs = dir.join("napcat.mjs");
    exe.exists() || mjs.exists()
}

pub fn install_napcat(app: AppHandle) -> Result<(), String> {
    if !is_social_enabled(&app) {
        return Ok(());
    }
    let dir = get_napcat_dir(&app);
    emit_log(&app, format!("Checking NapCat in: {:?}", dir));

    if check_napcat_installed(&app) {
        emit_log(&app, "NapCat already installed.".to_string());
        return Ok(());
    }

    emit_log(&app, "NapCat not found. Starting download...".to_string());
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let url = "https://github.com/NapNeko/NapCatQQ/releases/download/v4.10.10/NapCat.Shell.Windows.Node.zip";
    let temp_zip = std::env::temp_dir().join("NapCat.Shell.Windows.Node.zip");

    // Download
    let client = Client::new();
    let mut response = client.get(url).send().map_err(|e| e.to_string())?;
    
    if !response.status().is_success() {
         // Try mirror
         let mirror = "https://mirror.ghproxy.com/https://github.com/NapNeko/NapCatQQ/releases/download/v4.10.10/NapCat.Shell.Windows.Node.zip";
         emit_log(&app, format!("Download failed. Trying mirror: {}", mirror));
         response = client.get(mirror).send().map_err(|e| e.to_string())?;
         if !response.status().is_success() {
             return Err("Download failed from all mirrors.".to_string());
         }
    }

    let mut file = fs::File::create(&temp_zip).map_err(|e| e.to_string())?;
    let _ = response.copy_to(&mut file).map_err(|e| e.to_string())?;
    
    emit_log(&app, "Download complete. Extracting...".to_string());

    // Extract
    extract_zip(&temp_zip, &dir).map_err(|e| e.to_string())?;
    
    emit_log(&app, "Installation complete.".to_string());
    Ok(())
}

fn extract_zip(archive_path: &Path, dest: &Path) -> io::Result<()> {
    let file = fs::File::open(archive_path)?;
    let mut archive = ZipArchive::new(file)?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let outpath = match file.enclosed_name() {
            Some(path) => path.to_owned(),
            None => continue,
        };
        let outpath = dest.join(outpath);

        if (*file.name()).ends_with('/') {
            fs::create_dir_all(&outpath)?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)?;
                }
            }
            let mut outfile = fs::File::create(&outpath)?;
            io::copy(&mut file, &mut outfile)?;
        }
    }
    
    // Check nested folder logic (robust port from PeroLauncher)
    let shell_exe = dest.join("NapCat.Shell.exe");
    let node_mjs = dest.join("napcat.mjs");

    if !shell_exe.exists() && !node_mjs.exists() {
        // Look for nested dir
        for entry in fs::read_dir(dest)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                let nested_shell = path.join("NapCat.Shell.exe");
                let nested_node = path.join("napcat.mjs");
                
                if nested_shell.exists() || nested_node.exists() {
                    // Move content of `path` to `dest`
                    for sub_entry in fs::read_dir(&path)? {
                        let sub_entry = sub_entry?;
                        let sub_path = sub_entry.path();
                        let file_name = sub_path.file_name().unwrap();
                        let target_path = dest.join(file_name);
                        
                        if target_path.exists() {
                            if target_path.is_dir() {
                                fs::remove_dir_all(&target_path)?;
                            } else {
                                fs::remove_file(&target_path)?;
                            }
                        }
                        fs::rename(&sub_path, &target_path)?;
                    }
                    let _ = fs::remove_dir(path);
                    break;
                }
            }
        }
    }
    
    Ok(())
}

pub fn detect_qq_path() -> Option<String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    
    let subkey_path_wow64 = r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\QQ";
    let subkey_path_normal = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QQ";

    let mut uninstall_string: String = String::new();

    if let Ok(key) = hklm.open_subkey(subkey_path_wow64) {
        uninstall_string = key.get_value("UninstallString").unwrap_or_default();
    }
    
    if uninstall_string.is_empty() {
        if let Ok(key) = hklm.open_subkey(subkey_path_normal) {
            uninstall_string = key.get_value("UninstallString").unwrap_or_default();
        }
    }

    if !uninstall_string.is_empty() {
        // "C:\Path\To\QQ\Bin\Uninstall.exe" -> "C:\Path\To\QQ\QQ.exe"
        let path = Path::new(&uninstall_string);
        let parent = path.parent().unwrap_or(Path::new("")); // Bin
        let grand_parent = parent.parent().unwrap_or(Path::new("")); // QQ Root
        
        // Case 1: UninstallString is inside Bin (Standard)
        // Check GrandParent/QQ.exe (e.g. QQ/Bin/../QQ.exe) - wait, structure is usually QQ/Bin/QQ.exe
        // Let's look at PeroLauncher logic again:
        // PeroLauncher: 
        // Case 1: grand_parent.join("QQ.exe") -> implies uninstall is in Bin, and QQ.exe is in Root.
        // Wait, standard install is C:\Program Files (x86)\Tencent\QQ\Bin\QQ.exe
        // Uninstall is C:\Program Files (x86)\Tencent\QQ\Bin\QQUninst.exe
        // So parent is Bin. QQ.exe is in Bin.
        
        // Let's stick to checking both locations to be safe
        let qq_in_bin = parent.join("QQ.exe");
        if qq_in_bin.exists() { return Some(qq_in_bin.to_string_lossy().to_string()); }

        let qq_in_root = grand_parent.join("QQ.exe");
        if qq_in_root.exists() { return Some(qq_in_root.to_string_lossy().to_string()); }
    }

    // Fallback: Default install path
    let default_path = r"C:\Program Files (x86)\Tencent\QQ\Bin\QQ.exe";
    if Path::new(default_path).exists() {
        return Some(default_path.to_string());
    }

    None
}

pub fn start_napcat_process(app: AppHandle, state: tauri::State<NapCatState>) -> Result<(), String> {
    if !is_social_enabled(&app) {
        return Err("Social mode is disabled in settings.".to_string());
    }
    let mut child_guard = state.child.lock().map_err(|e| e.to_string())?;
    if child_guard.is_some() {
        return Ok(());
    }

    let dir = get_napcat_dir(&app);
    let shell_exe = dir.join("NapCat.Shell.exe");
    let napcat_bat = dir.join("napcat.bat"); // User reported
    let index_js = dir.join("index.js");
    let napcat_mjs = dir.join("napcat.mjs");
    
    // Check if installed
    if !shell_exe.exists() && !napcat_bat.exists() && !index_js.exists() && !napcat_mjs.exists() {
        return Err("NapCat not installed.".to_string());
    }

    let qq_path = detect_qq_path().ok_or("QQ not found in registry. Please install QQ or config manually.".to_string())?;
    emit_log(&app, format!("Found QQ at: {}", qq_path));

    // --- 自动同步 Token 逻辑 ---
    if let Ok(config_val) = crate::get_config(app.clone()) {
        if let Some(token) = config_val["frontend_access_token"].as_str() {
            let config_dir = dir.join("config");
            if config_dir.exists() {
                if let Ok(entries) = fs::read_dir(config_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if let Some(filename) = path.file_name().and_then(|f| f.to_str()) {
                            if filename.starts_with("onebot11_") && filename.ends_with(".json") {
                                emit_log(&app, format!("Updating token in NapCat config: {}", filename));
                                if let Ok(content) = fs::read_to_string(&path) {
                                    if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                                        // 更新所有 websocketClients 的 token
                                        if let Some(clients) = json["websocketClients"].as_array_mut() {
                                            for client in clients {
                                                client["token"] = serde_json::Value::String(token.to_string());
                                            }
                                        }
                                        if let Ok(new_content) = serde_json::to_string_pretty(&json) {
                                            let _ = fs::write(&path, new_content);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    // --- 结束同步逻辑 ---

    let mut cmd;

    if napcat_bat.exists() {
        emit_log(&app, "Launching via napcat.bat...".to_string());
        // napcat.bat likely expects no arguments or specific envs, but let's try standard invocation
        // Note: napcat.bat usually launches node index.js
        cmd = Command::new("cmd");
        cmd.args(&["/C", "napcat.bat", "-q", &qq_path])
           .current_dir(&dir);
    } else if shell_exe.exists() {
        emit_log(&app, "Launching via NapCat.Shell.exe...".to_string());
        cmd = Command::new(&shell_exe);
        cmd.arg("-q")
           .arg(&qq_path)
           .current_dir(&dir);
    } else {
        // Node fallback (index.js or napcat.mjs)
        // Need to find node
        let node_exe = if let Ok(path) = which::which("node") {
             path
        } else {
             // Try bundled node
             let bundled = dir.join("node.exe");
             if bundled.exists() { bundled } else { PathBuf::from("node") }
        };

        cmd = Command::new(node_exe);
        if index_js.exists() {
             emit_log(&app, "Launching via node index.js...".to_string());
             cmd.arg("index.js");
        } else {
             emit_log(&app, "Launching via node napcat.mjs...".to_string());
             cmd.arg("napcat.mjs");
        }
        // Modern NapCat Node versions might not need -q if configured via config file, 
        // but passing it is usually safe for headless mode if supported.
        // However, PeroLauncher removed -q for Node versions. Let's follow that.
        // But we need to ensure it knows where QQ is.
        // If config is missing, it might ask interactively, which is bad for headless.
        // Let's assume config exists or it auto-detects.
        cmd.current_dir(&dir);
    }

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::piped())
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| format!("Failed to start NapCat: {}", e))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let stdin = child.stdin.take().unwrap();

    // Store stdin for interaction
    let mut stdin_guard = state.stdin.lock().map_err(|e| e.to_string())?;
    *stdin_guard = Some(stdin);
    
    // Store child
    *child_guard = Some(child);

    let app_clone = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
                emit_log(&app_clone, l);
            }
        }
    });

    let app_clone_err = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(l) = line {
                emit_log(&app_clone_err, format!("[ERR] {}", l));
            }
        }
    });

    emit_log(&app, "NapCat started.".to_string());
    Ok(())
}

#[tauri::command]
pub fn send_napcat_command(state: tauri::State<NapCatState>, command: String) -> Result<(), String> {
    use std::io::Write;
    let mut stdin_guard = state.stdin.lock().map_err(|e| e.to_string())?;
    if let Some(stdin) = stdin_guard.as_mut() {
        writeln!(stdin, "{}", command).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("NapCat stdin not available".to_string())
    }
}

#[tauri::command]
pub fn stop_napcat_process(state: tauri::State<NapCatState>) -> Result<(), String> {
    let mut child_guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(child) = child_guard.take() {
        let pid = child.id();
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(&["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(0x08000000)
                .output();
            println!("NapCat killed via taskkill.");
        }
        #[cfg(not(windows))]
        {
            let mut c = child;
            let _ = c.kill();
        }
    }
    let mut stdin_guard = state.stdin.lock().map_err(|e| e.to_string())?;
    *stdin_guard = None;
    Ok(())
}
