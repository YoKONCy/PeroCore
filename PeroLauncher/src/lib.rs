use serde::Serialize;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;
/*
 * Copyright (c) 2026 YoKONCy. All rights reserved.
 * This software is licensed under the GNU General Public License v3.0.
 * Any unauthorized commercial use or closed-source redistribution is a direct violation of the GPL-3.0 license.
 * Original Repository: https://github.com/YoKONCy/PeroCore
 */

use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindowLongA, SetWindowLongA, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
};

mod napcat;
use napcat::NapCatState;

mod everything;
mod plugins;

#[derive(Clone, Serialize)]
struct MousePos {
    x: i32,
    y: i32,
}

#[derive(Serialize)]
struct DiagnosticReport {
    python_exists: bool,
    python_path: String,
    python_version: String,
    script_exists: bool,
    script_path: String,
    port_9120_free: bool,
    data_dir_writable: bool,
    data_dir: String,
    core_available: bool,
    errors: Vec<String>,
}

#[tauri::command]
async fn get_diagnostics(app: tauri::AppHandle) -> Result<DiagnosticReport, String> {
    let mut errors = Vec::new();
    
    // 1. 获取资源目录
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;

    // 2. 确定 Python 路径
    let mut dev_venv_python_exists = false;
    let python_path = {
        let dev_venv_python = get_workspace_root().join("backend/venv/Scripts/python.exe");
        if dev_venv_python.exists() {
            dev_venv_python_exists = true;
            dev_venv_python
        } else {
            // 优先检查标准资源目录
            let mut p = resource_dir.join("python/python.exe");
            if !p.exists() {
                // 尝试各种可能的 Release 组织结构
                let trials = [
                    resource_dir.join("_up_/src-tauri/python/python.exe"),
                    resource_dir.join("_up_/python/python.exe"),
                    // 适配 ./ces/PeroCore/src-tauri/python 这种结构
                    app.path().resource_dir().unwrap_or(resource_dir.clone()).join("src-tauri/python/python.exe"),
                ];
                
                for trial in trials {
                    if trial.exists() {
                        p = trial;
                        break;
                    }
                }
            }
            p
        }
    };
    let python_path = fix_path(python_path);
    let python_exists = python_path.exists();
    
    let mut python_version = String::from("Unknown");
    let mut core_available = false;

    if python_exists {
        // 尝试运行 python --version
        let output = std::process::Command::new(&python_path)
            .arg("--version")
            .creation_flags(0x08000000) // 隐藏窗口
            .output();
        
        if let Ok(out) = output {
            python_version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if python_version.is_empty() {
                python_version = String::from_utf8_lossy(&out.stderr).trim().to_string();
            }
        } else {
            errors.push("Python 解释器无法运行，可能缺少系统组件 (如 VCRUNTIME140.dll)".to_string());
        }

        // 尝试检查 pero_memory_core
        let core_check = std::process::Command::new(&python_path)
            .args(&["-c", "import pero_memory_core; print('OK')"])
            .creation_flags(0x08000000)
            .output();
        if let Ok(out) = core_check {
            if String::from_utf8_lossy(&out.stdout).trim() == "OK" {
                core_available = true;
            } else {
                errors.push("关键核心组件 pero_memory_core 未找到，记忆功能将受限".to_string());
            }
        }
    } else {
        errors.push(format!("Python 解释器未找到。探测路径: {:?}", python_path));
    }

    // 3. 确定脚本路径
    let script_path = {
        let trials = [
            resource_dir.join("backend/main.py"),
            resource_dir.join("main.py"),
            resource_dir.join("_up_/backend/main.py"),
            resource_dir.join("_up_/main.py"),
            get_workspace_root().join("backend/main.py"),
        ];
        
        let mut p = trials[0].clone();
        for trial in trials {
            if trial.exists() {
                p = trial;
                break;
            }
        }
        p
    };
    let script_path = fix_path(script_path);
    let script_exists = script_path.exists();
    if !script_exists {
        errors.push(format!("后端主脚本未找到: {:?}", script_path));
    }

    // 4. 检查端口 9120
    let port_9120_free = std::net::TcpListener::bind("127.0.0.1:9120").is_ok();
    if !port_9120_free {
        errors.push("端口 9120 已被占用，请检查是否有其他 PeroCore 实例在运行".to_string());
    }

    // 5. 数据目录检查
    let data_dir = if !dev_venv_python_exists {
        app.path().app_data_dir().map_err(|e| e.to_string())?.join("data")
    } else {
        get_workspace_root().join("backend/data")
    };
    let data_dir = fix_path(data_dir);
    if !data_dir.exists() {
        let _ = std::fs::create_dir_all(&data_dir);
    }
    let data_dir_writable = std::fs::write(data_dir.join(".write_test"), "").is_ok();
    if data_dir_writable {
        let _ = std::fs::remove_file(data_dir.join(".write_test"));
    } else {
        errors.push(format!("数据目录不可写: {:?}", data_dir));
    }

    Ok(DiagnosticReport {
        python_exists,
        python_path: python_path.to_string_lossy().to_string(),
        python_version,
        script_exists,
        script_path: script_path.to_string_lossy().to_string(),
        port_9120_free,
        data_dir_writable,
        data_dir: data_dir.to_string_lossy().to_string(),
        core_available,
        errors,
    })
}

#[tauri::command]
fn set_ignore_mouse(window: tauri::Window, ignore: bool) {
    // 1. Tauri standard call
    let _ = window.set_ignore_cursor_events(ignore);

    // 2. Win32 advanced call for perfect penetration
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        if let Ok(hwnd_ptr) = window.hwnd() {
            let hwnd = HWND(hwnd_ptr.0 as isize);
            unsafe {
                let ex_style = GetWindowLongA(hwnd, GWL_EXSTYLE);
                if ignore {
                    let _ = SetWindowLongA(
                        hwnd,
                        GWL_EXSTYLE,
                        ex_style | (WS_EX_TRANSPARENT.0 as i32) | (WS_EX_LAYERED.0 as i32),
                    );
                } else {
                    let _ =
                        SetWindowLongA(hwnd, GWL_EXSTYLE, ex_style & !(WS_EX_TRANSPARENT.0 as i32));
                }
            }
        }
    }
}



#[tauri::command]
async fn open_dashboard(app: tauri::AppHandle) {
    println!("Rust: open_dashboard command received");
    if let Some(window) = app.get_webview_window("dashboard") {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let _ = WebviewWindowBuilder::new(
            &app,
            "dashboard",
            WebviewUrl::App("/#/dashboard".into()), // Hash mode router
        )
        .title("Pero Dashboard")
        .inner_size(1200.0, 800.0)
        .resizable(true)
        .fullscreen(false)
        .visible(true)
        .build();
    }
}

#[tauri::command]
async fn open_pet_window(app: tauri::AppHandle) {
    println!("Rust: Attempting to open pet window...");
    if let Some(window) = app.get_webview_window("pet") {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let _ = WebviewWindowBuilder::new(
            &app,
            "pet",
            WebviewUrl::App("/#/pet".into())
        )
        .title("PeroCore")
        .inner_size(700.0, 700.0)
        .resizable(false)
        .fullscreen(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .build();
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

pub fn get_workspace_root() -> std::path::PathBuf {
    let current_dir = std::env::current_dir().unwrap();
    // println!("Rust: Current working directory: {:?}", current_dir);

    // 1. 检查当前目录是否就是 PeroCore
    if current_dir.join("backend").exists() && current_dir.join("PeroLauncher").exists() {
        return current_dir;
    }

    // 2. 检查当前目录的子目录 PeroCore
    let perocore_dir = current_dir.join("PeroCore");
    if perocore_dir.exists() && perocore_dir.join("backend").exists() {
        return perocore_dir;
    }

    // 3. 向上查找，直到找到包含 backend 的目录
    let mut search_dir = current_dir.clone();
    for _ in 0..5 {
        if search_dir.join("backend").exists() {
            return search_dir;
        }
        if let Some(parent) = search_dir.parent() {
            search_dir = parent.to_path_buf();
        } else {
            break;
        }
    }

    // 4. 回退到原始逻辑
    if current_dir.ends_with("src-tauri") {
        current_dir
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    } else if current_dir.ends_with("PeroLauncher") {
        current_dir.parent().unwrap().to_path_buf()
    } else {
        current_dir
    }
}

pub fn fix_path(path: std::path::PathBuf) -> std::path::PathBuf {
    let p = path
        .canonicalize()
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();
    std::path::PathBuf::from(p.trim_start_matches(r"\\?\"))
}

#[tauri::command]
async fn start_backend(
    app: tauri::AppHandle,
    state: tauri::State<'_, BackendState>,
) -> Result<(), String> {
    // 1. 先运行诊断（无需锁，且包含异步操作）
    let diag = get_diagnostics(app.clone()).await?;
    if !diag.errors.is_empty() {
        return Err(format!("启动失败！诊断错误：\n{}", diag.errors.join("\n")));
    }

    // 2. 获取锁（同步操作）
    let mut backend_guard = state.0.lock().map_err(|e| e.to_string())?;

    // 3. 检查是否已启动
    if backend_guard.is_some() {
        return Ok(());
    }

    use tauri::Manager;
    use rand::{distributions::Alphanumeric, Rng};

    // 1. 生成并保存动态令牌
    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    // 更新 config.json 中的 token
    if let Ok(mut config) = get_config(app.clone()) {
        config["frontend_access_token"] = serde_json::Value::String(token.clone());
        let _ = save_config(app.clone(), config);
    }

    let python_path = std::path::PathBuf::from(&diag.python_path);
    let script_path = std::path::PathBuf::from(&diag.script_path);
    let data_dir = std::path::PathBuf::from(&diag.data_dir);
    let backend_root = fix_path(script_path.parent().unwrap_or(&script_path).to_path_buf());
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;

    println!("Rust: Python path: {:?}", python_path);
    println!("Rust: Script path: {:?}", script_path);
    println!("Rust: Backend root: {:?}", backend_root);
    
    let db_path = fix_path(data_dir.join("perocore.db"));
    let config_path = fix_path(data_dir.join("config.json"));

    // 如果 AppData 中没有配置文件，尝试从资源目录拷贝一个初始化的
    if !config_path.exists() {
        let initial_config = {
            let mut p = resource_dir.join("backend/config.json");
            if !p.exists() {
                p = resource_dir.join("_up_/backend/config.json");
            }
            p
        };
        if initial_config.exists() {
            let _ = std::fs::copy(initial_config, &config_path);
        }
    }

    println!("Rust: Force DB path: {:?}", db_path);
    println!("Rust: Force Config path: {:?}", config_path);

    let mut cmd = std::process::Command::new(&python_path);
    
    // 构造 PYTHONPATH
    let mut python_path_env = backend_root.to_string_lossy().to_string();
    let site_packages = python_path.parent().unwrap_or(&python_path).join("Lib/site-packages");
    if site_packages.exists() {
        python_path_env = format!("{};{}", python_path_env, site_packages.to_string_lossy());
    }

    // 设置日志文件路径
    let logs_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("logs");
    if !logs_dir.exists() {
        let _ = std::fs::create_dir_all(&logs_dir);
    }
    let backend_log_path = logs_dir.join("backend.log");

    cmd.args(&["-u", &script_path.to_string_lossy()])
        .current_dir(&backend_root)
        .env("PYTHONPATH", python_path_env)
        .env("PORT", "9120")
        .env("PERO_ACCESS_TOKEN", token)
        .env("PERO_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("PERO_DATABASE_PATH", db_path.to_string_lossy().to_string())
        .env("PERO_CONFIG_PATH", config_path.to_string_lossy().to_string())
        .env("PERO_LOG_FILE", backend_log_path.to_string_lossy().to_string())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags(0x08000000); // 隐藏窗口

    let mut child = cmd.spawn().map_err(|e| format!("Spawn error: {}", e))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let app_stdout = app.clone();
    tauri::async_runtime::spawn(async move {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
                log::info!("[Backend] {}", l); // 同时记录到 Rust 日志系统
                let _ = app_stdout.emit("backend-log", l);
            }
        }
    });

    let app_stderr = app.clone();
    tauri::async_runtime::spawn(async move {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(l) = line {
                log::error!("[Backend] {}", l); // 同时记录到 Rust 日志系统
                let _ = app_stderr.emit("backend-log", format!("[ERR] {}", l));
            }
        }
    });

    *backend_guard = Some(child);
    Ok(())
}

#[tauri::command]
fn stop_backend(state: tauri::State<BackendState>) -> Result<(), String> {
    let mut backend_guard = state.0.lock().map_err(|e| e.to_string())?;

    if let Some(child) = backend_guard.take() {
        let pid = child.id();
        let _ = Command::new("taskkill")
            .args(&["/F", "/T", "/PID", &pid.to_string()])
            .output();
        println!("Backend killed via taskkill.");
    }
    Ok(())
}

#[tauri::command]
fn get_config(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    
    // 1. 优先从 AppData 目录读取（用户持久化配置）
    let config_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("data/config.json");
    if config_path.exists() {
        let content = std::fs::read_to_string(config_path).map_err(|e| e.to_string())?;
        let config: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        return Ok(config);
    }

    // 2. 回退到资源目录（默认配置）
    if let Ok(resource_dir) = app.path().resource_dir() {
        let trials = [
            resource_dir.join("backend/config.json"),
            resource_dir.join("config.json"),
            resource_dir.join("_up_/backend/config.json"),
            resource_dir.join("_up_/config.json"),
        ];
        
        for trial in trials {
            if trial.exists() {
                let content = std::fs::read_to_string(trial).map_err(|e| e.to_string())?;
                let config: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
                return Ok(config);
            }
        }
    }
        
    // 3. 最后回退到源码目录（开发环境）
    let dev_config = get_workspace_root().join("backend/config.json");
    if dev_config.exists() {
        let content = std::fs::read_to_string(dev_config).map_err(|e| e.to_string())?;
        let config: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        return Ok(config);
    }

    Ok(serde_json::json!({}))
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: serde_json::Value) -> Result<(), String> {
    use tauri::Manager;
    
    // 始终保存到 AppData 目录
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("data");
    if !data_dir.exists() {
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }
    let config_path = data_dir.join("config.json");

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(config_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_root_folder() {
    let _ = Command::new("explorer").arg(".").spawn();
}

#[tauri::command]
fn check_napcat(app: tauri::AppHandle) -> bool {
    napcat::check_napcat_installed(&app)
}

#[tauri::command]
async fn install_napcat(app: tauri::AppHandle) -> Result<(), String> {
    let app_clone = app.clone();
    // Run in blocking thread to avoid blocking main thread (though reqwest blocking is used inside)
    tauri::async_runtime::spawn_blocking(move || napcat::install_napcat(app_clone))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn start_napcat(app: tauri::AppHandle, state: tauri::State<NapCatState>) -> Result<(), String> {
    napcat::start_napcat_process(app, state)
}

#[tauri::command]
fn stop_napcat_wrapper(state: tauri::State<NapCatState>) -> Result<(), String> {
    napcat::stop_napcat_process(state)
}

#[tauri::command]
fn send_napcat_command_wrapper(
    state: tauri::State<NapCatState>,
    command: String,
) -> Result<(), String> {
    napcat::send_napcat_command(state, command)
}

#[tauri::command]
fn check_es(app: tauri::AppHandle) -> bool {
    everything::check_es_installed(&app)
}

#[tauri::command]
async fn install_es(app: tauri::AppHandle) -> Result<(), String> {
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || everything::install_es(app_clone))
        .await
        .map_err(|e| e.to_string())?
}

struct BackendState(Arc<Mutex<Option<std::process::Child>>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 检测是否在 GitHub Actions 环境中运行，防止构建时挂起
    if std::env::var("GITHUB_ACTIONS").is_ok() {
        let args: Vec<String> = std::env::args().collect();
        if args.iter().any(|arg| arg == "build" || arg == "--version") {
            println!("CI environment detected with build/version arg, exiting to prevent hang.");
            return;
        }
    }

    // 保留对解决 Windows 代理和安全检查延迟最有效的环境变量
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", 
        "--no-proxy-server --proxy-server='direct://' --proxy-bypass-list='*' --disable-features=msSmartScreenProtection");

    let start_time = std::time::Instant::now();
    println!("[Perf] run() started at {:?}", start_time);

    let backend = Arc::new(Mutex::new(None::<std::process::Child>));
    let napcat_state = NapCatState::new();

    // 为不同的闭包准备专属克隆，避免所有权冲突
    let backend_for_setup = backend.clone();
    let napcat_for_setup = napcat_state.child.clone();
    let backend_for_run = backend.clone();
    let napcat_for_run = napcat_state.child.clone();

    println!("[Perf] Builder starting at {:?}", start_time.elapsed());
    let mut builder = tauri::Builder::default();

    builder = builder.plugin(
        tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .targets([
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                    file_name: Some("launcher".to_string()),
                }),
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
            ])
            .build(),
    );
    builder = builder.plugin(tauri_plugin_shell::init());

    builder
        .manage(BackendState(backend))
        .manage(napcat_state)
        .invoke_handler(tauri::generate_handler![
            open_dashboard,
            open_pet_window,
            set_ignore_mouse,
            quit_app,
            start_backend,
            stop_backend,
            open_root_folder,
            check_napcat,
            install_napcat,
            start_napcat,
            stop_napcat_wrapper,
            send_napcat_command_wrapper,
            check_es,
            install_es,
            plugins::get_plugins,
            get_config,
            save_config,
            get_diagnostics
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // 如果是主窗口被销毁，尝试清理资源
                let label = window.label();
                println!("Window {} destroyed", label);
            }
        })
        .setup(move |app| {
            // 在 setup 中捕获但故意不使用，确保这些克隆被 move 到这里而不是被 run 闭包捕获
            let _backend_setup = backend_for_setup;
            let _napcat_setup = napcat_for_setup;

            println!("[Perf] setup() entered at {:?}", start_time.elapsed());

            // 托盘初始化
            let handle = app.handle().clone();
            let quit_i =
                MenuItem::with_id(&handle, "quit", "退出 PeroCore", true, None::<&str>).unwrap();
            let open_dashboard_i =
                MenuItem::with_id(&handle, "open_dashboard", "打开控制台", true, None::<&str>)
                    .unwrap();
            let open_launcher_i =
                MenuItem::with_id(&handle, "open_launcher", "打开启动器", true, None::<&str>)
                    .unwrap();
            let menu =
                Menu::with_items(&handle, &[&open_launcher_i, &open_dashboard_i, &quit_i]).unwrap();

            let _tray = TrayIconBuilder::new()
                .icon(handle.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "open_launcher" => {
                        if let Some(window) = app.get_webview_window("launcher") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "open_dashboard" => {
                        if let Some(window) = app.get_webview_window("dashboard") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        } else {
                            let _ = WebviewWindowBuilder::new(
                                app,
                                "dashboard",
                                WebviewUrl::App("/#/dashboard".into()),
                            )
                            .title("Pero Dashboard")
                            .inner_size(1200.0, 800.0)
                            .resizable(true)
                            .fullscreen(false)
                            .visible(true)
                            .build();
                        }
                    }
                    _ => {}
                })
                .build(&handle)
                .unwrap();

            // --- Mouse Tracker (Windows) ---
            let handle_mouse = app.handle().clone();
            thread::spawn(move || {
                thread::sleep(std::time::Duration::from_secs(2));
                let mut last_x = 0;
                let mut last_y = 0;
                loop {
                    unsafe {
                        let mut point = POINT::default();
                        if GetCursorPos(&mut point).is_ok() {
                            if point.x != last_x || point.y != last_y {
                                last_x = point.x;
                                last_y = point.y;
                                let _ = handle_mouse.emit(
                                    "mouse-pos",
                                    MousePos {
                                        x: point.x,
                                        y: point.y,
                                    },
                                );
                            }
                        }
                    }
                    thread::sleep(std::time::Duration::from_millis(32));
                }
            });

            println!("[Perf] setup() finished at {:?}", start_time.elapsed());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "launcher" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(move |_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                println!("App exiting, cleaning up backends...");
                
                // 1. Kill Python Backend
                if let Ok(mut guard) = backend_for_run.lock() {
                    if let Some(child) = guard.take() {
                        let pid = child.id();
                        println!("Killing backend PID: {}", pid);
                        let _ = Command::new("taskkill")
                            .args(&["/F", "/T", "/PID", &pid.to_string()])
                            .creation_flags(0x08000000)
                            .output();
                    }
                }

                // 2. Kill NapCat Backend
                if let Ok(mut guard) = napcat_for_run.lock() {
                    if let Some(child) = guard.take() {
                        let pid = child.id();
                        println!("Killing NapCat PID: {}", pid);
                        let _ = Command::new("taskkill")
                            .args(&["/F", "/T", "/PID", &pid.to_string()])
                            .creation_flags(0x08000000)
                            .output();
                    }
                }
            }
        });
}
