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

fn get_workspace_root() -> std::path::PathBuf {
    let current_dir = std::env::current_dir().unwrap();
    println!("Rust: Current working directory: {:?}", current_dir);

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

fn fix_path(path: std::path::PathBuf) -> std::path::PathBuf {
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
    let mut backend_guard = state.0.lock().map_err(|e| e.to_string())?;

    if backend_guard.is_some() {
        return Ok(());
    }

    use tauri::Manager;

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
            let mut p = resource_dir.join("python/python.exe");
            if !p.exists() {
                p = resource_dir.join("_up_/src-tauri/python/python.exe");
            }
            p
        }
    };

    // 3. 确定脚本路径
    let script_path = {
        let mut p = resource_dir.join("backend/main.py");
        if !p.exists() {
            p = resource_dir.join("_up_/backend/main.py");
        }
        if p.exists() {
            p
        } else {
            get_workspace_root().join("backend/main.py")
        }
    };

    let python_path = fix_path(python_path);
    if !python_path.exists() {
        return Err(format!("Python executable not found at {:?}", python_path));
    }
    let script_path = fix_path(script_path);
    let backend_root = fix_path(script_path.parent().unwrap_or(&script_path).to_path_buf());

    println!("Rust: Python path: {:?}", python_path);
    println!("Rust: Script path: {:?}", script_path);
    println!("Rust: Backend root: {:?}", backend_root);
    
    // 强制指定数据库和配置文件路径，确保“记忆”不丢失
    // 对于打包后的版本，应该使用 AppData 目录，避免权限问题
    let data_dir = if !dev_venv_python_exists {
        let p = app.path().app_data_dir().map_err(|e| e.to_string())?.join("data");
        if !p.exists() {
            std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
        }
        p
    } else {
        get_workspace_root().join("backend/data")
    };

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
    
    // 构造 PYTHONPATH，包含 backend 根目录和 site-packages
    let mut python_path_env = backend_root.to_string_lossy().to_string();
    let site_packages = python_path.parent().unwrap_or(&python_path).join("Lib/site-packages");
    if site_packages.exists() {
        python_path_env = format!("{};{}", python_path_env, site_packages.to_string_lossy());
    }

    cmd.args(&["-u", &script_path.to_string_lossy()])
        .current_dir(&backend_root)
        .env("PYTHONPATH", python_path_env)
        .env("PERO_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("PERO_DATABASE_PATH", db_path.to_string_lossy().to_string())
        .env("PERO_CONFIG_PATH", config_path.to_string_lossy().to_string())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags(0x08000000); // 恢复隐藏窗口，减少干扰

    let mut child = cmd.spawn().map_err(|e| format!("Spawn error: {}", e))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let app_stdout = app.clone();
    tauri::async_runtime::spawn(async move {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
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
    
    // 优先从 AppData 目录读取
    let config_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("data/config.json");
    
    if !config_path.exists() {
        // 回退到资源目录
        let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
        let mut p = resource_dir.join("backend/config.json");
        if !p.exists() {
            p = resource_dir.join("_up_/backend/config.json");
        }
        
        if p.exists() {
            let content = std::fs::read_to_string(p).map_err(|e| e.to_string())?;
            let config: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
            return Ok(config);
        }
        
        // 最后回退到源码目录
        let dev_config = get_workspace_root().join("backend/config.json");
        if dev_config.exists() {
            let content = std::fs::read_to_string(dev_config).map_err(|e| e.to_string())?;
            let config: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
            return Ok(config);
        }

        return Ok(serde_json::json!({}));
    }

    let content = std::fs::read_to_string(config_path).map_err(|e| e.to_string())?;
    let config: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(config)
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
fn check_napcat() -> bool {
    napcat::check_napcat_installed()
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
fn check_es() -> bool {
    everything::check_es_installed()
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
            save_config
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
