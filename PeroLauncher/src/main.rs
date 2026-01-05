use std::env;
use std::fs;
use std::io::{self, Read, Write};
use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::Duration;

use anyhow::{Context, Result};
use colored::*;
use indicatif::{ProgressBar, ProgressStyle};
use reqwest::blocking::Client;
use sysinfo::System;
use winreg::enums::*;
use winreg::RegKey;
use zip::ZipArchive;

fn main() -> Result<()> {
    // Enable colored output on Windows
    #[cfg(windows)]
    let _ = colored::control::set_virtual_terminal(true);

    println!("{}", "============================================================".cyan());
    println!("{}", "           Pero Launcher - Rust Edition (v0.1.0)            ".cyan().bold());
    println!("{}", "============================================================".cyan());
    println!();

    let current_dir = env::current_dir().context("Failed to get current directory")?;
    
    // Detect root directory (PeroCore root)
    let pero_dir = if let Some(parent) = current_dir.parent() {
        if parent.join("package.json").exists() {
            parent.to_path_buf()
        } else {
            // Fallback: maybe we are not in the standard structure
            println!("[WARN] Could not find PeroCore root (parent/package.json missing). Defaulting to current.");
            current_dir.clone()
        }
    } else {
        current_dir.clone()
    };

    println!("[INFO] Working Directory (Root): {:?}", pero_dir);

    // 0. Cleanup and Base Check
    cleanup_processes();

    // 1. Check Dependencies
    check_dependencies()?;

    // 2. Check and Setup NapCat
    // Fix path separators for Windows to avoid "Invalid switch" errors in cmd
    let napcat_rel_path = "backend/nit_core/plugins/social_adapter/NapCat".replace("/", "\\");
    let napcat_dir = pero_dir.join(napcat_rel_path);
    setup_napcat(&napcat_dir)?;

    // 3. Detect QQ
    let qq_path = detect_qq_path()?;
    println!("[INFO] Found QQ Path: {:?}", qq_path);

    // 4. Launch NapCat
    launch_napcat(&napcat_dir, &qq_path)?;

    // 5. Launch PeroCore
    launch_perocore(&pero_dir)?;

    Ok(())
}

fn cleanup_processes() {
    println!("{}", "[0/3] Cleaning up old processes...".yellow());
    let mut system = System::new_all();
    system.refresh_all();

    // Kill port 3000
    let _kill_list = ["python.exe", "electron.exe", "PeroCore.exe", "node.exe"];
    
    for process in system.processes_by_name("python") {
        println!("[INFO] Killing python (PID: {})", process.pid());
        process.kill();
    }
    
    // Check processes listening on port 3000
    let output = Command::new("netstat")
        .args(&["-ano"])
        .output()
        .ok();
        
    if let Some(out) = output {
        let stdout = String::from_utf8_lossy(&out.stdout);
        for line in stdout.lines() {
            if line.contains(":3000") && line.contains("LISTENING") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if let Some(pid_str) = parts.last() {
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        println!("[INFO] Killing process on port 3000 (PID: {})", pid);
                        let _ = Command::new("taskkill")
                            .args(&["/F", "/PID", &pid.to_string()])
                            .output();
                    }
                }
            }
        }
    }
}

fn check_dependencies() -> Result<()> {
    println!("{}", "[1/3] Checking Environment...".yellow());

    // Check Node.js
    if let Ok(_) = which::which("node") {
        let out = Command::new("node").arg("-v").output()?;
        println!("[OK] Node.js found: {}", String::from_utf8_lossy(&out.stdout).trim());
    } else {
        // Smart check common paths
        let common_paths = [
            r"C:\nvm4w\nodejs\node.exe",
            r"C:\Program Files\nodejs\node.exe",
        ];
        
        let mut found = false;
        for path in common_paths {
            if Path::new(path).exists() {
                println!("[INFO] Found Node.js at: {}", path);
                let new_path = format!("{};{}", Path::new(path).parent().unwrap().to_str().unwrap(), env::var("PATH").unwrap_or_default());
                env::set_var("PATH", new_path);
                found = true;
                break;
            }
        }
        
        if !found {
            println!("{}", "[ERROR] Node.js not found.".red());
            println!("Please install Node.js: https://nodejs.org/");
            std::process::exit(1);
        }
    }

    // Check npm
    if which::which("npm").is_ok() {
        println!("[OK] npm found.");
    } else {
        println!("{}", "[ERROR] npm not found.".red());
        std::process::exit(1);
    }

    // Check Python
    if which::which("python").is_ok() {
        println!("[OK] Python found.");
    } else {
        println!("{}", "[ERROR] Python not found.".red());
        std::process::exit(1);
    }

    Ok(())
}

fn setup_napcat(napcat_dir: &Path) -> Result<()> {
    println!("{}", "[2/3] Checking NapCat...".yellow());
    
    let napcat_exe = napcat_dir.join("NapCat.Shell.exe");
    let napcat_mjs = napcat_dir.join("napcat.mjs");
    let index_js = napcat_dir.join("index.js");

    if napcat_exe.exists() || napcat_mjs.exists() || index_js.exists() {
        println!("[OK] NapCat found.");
        return Ok(());
    }

    println!("[INFO] NapCat Shell not found. Auto-downloading...");
    fs::create_dir_all(napcat_dir)?;

    let mirrors = [
        "https://ghproxy.net/https://github.com/NapNeko/NapCatQQ/releases/download/v4.10.10/NapCat.Shell.Windows.Node.zip",
        "https://mirror.ghproxy.com/https://github.com/NapNeko/NapCatQQ/releases/download/v4.10.10/NapCat.Shell.Windows.Node.zip",
        "https://github.com/NapNeko/NapCatQQ/releases/download/v4.10.10/NapCat.Shell.Windows.Node.zip",
    ];

    let client = Client::new();
    let mut downloaded = false;
    let temp_zip = env::temp_dir().join("NapCat.Shell.Windows.Node.zip");
    
    // Clean temp zip
    if temp_zip.exists() {
        let _ = fs::remove_file(&temp_zip);
    }

    for url in mirrors {
        println!("[INFO] Trying download from: {}", url);
        match download_file(&client, url, &temp_zip) {
            Ok(_) => {
                downloaded = true;
                println!("[INFO] Download successful.");
                break;
            }
            Err(e) => {
                println!("[WARN] Download failed: {}", e);
            }
        }
    }

    if !downloaded {
        println!("{}", "[ERROR] All download mirrors failed.".red());
        std::process::exit(1);
    }

    println!("[INFO] Extracting...");
    
    extract_zip(&temp_zip, napcat_dir)?;
    
    // Check again
    if napcat_exe.exists() || napcat_mjs.exists() {
        println!("[OK] NapCat installed.");
        return Ok(());
    }

    // It seems `NapCat.Shell.exe` is indeed missing from the zip.
    // However, `NapCatWinBootMain.exe` is present.
    
    let fallback_exe = napcat_dir.join("NapCatWinBootMain.exe");
    if fallback_exe.exists() {
        println!("[WARN] NapCat components missing, but NapCatWinBootMain.exe exists.");
        println!("[INFO] Using NapCatWinBootMain.exe as fallback.");
        return Ok(());
    }

    if !napcat_exe.exists() {
        println!("{}", "[ERROR] NapCat executable not found after extraction.".red());
        println!("Contents of {:?}:", napcat_dir);
        if let Ok(entries) = fs::read_dir(napcat_dir) {
            for entry in entries {
                if let Ok(entry) = entry {
                    println!("  {:?}", entry.file_name());
                }
            }
        }
        std::process::exit(1);
    }

    println!("[OK] NapCat installed.");
    Ok(())
}

fn download_file(client: &Client, url: &str, path: &Path) -> Result<()> {
    let mut response = client.get(url).send()?;
    if !response.status().is_success() {
        return Err(anyhow::anyhow!("HTTP {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let pb = ProgressBar::new(total_size);
    pb.set_style(ProgressStyle::default_bar()
        .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {bytes}/{total_bytes} ({eta})")?
        .progress_chars("#>-"));

    let mut file = fs::File::create(path)?;
    let mut downloaded: u64 = 0;
    let mut buffer = [0; 8192];

    while let Ok(n) = response.read(&mut buffer) {
        if n == 0 { break; }
        file.write_all(&buffer[..n])?;
        downloaded += n as u64;
        pb.set_position(downloaded);
    }

    pb.finish_with_message("Downloaded");
    Ok(())
}

fn extract_zip(archive_path: &Path, dest: &Path) -> Result<()> {
    let file = fs::File::open(archive_path)?;
    let mut archive = ZipArchive::new(file)?;
    
    // We want to extract EVERYTHING into `dest`.
    // The zip structure might be:
    // NapCat.Shell.zip
    //   ├── NapCat.Shell.exe
    //   ├── ...
    
    // OR
    // NapCat.Shell.zip
    //   └── NapCat.Shell/
    //       ├── NapCat.Shell.exe
    //       └── ...
    
    // Let's just extract all files. If they are in a top-level folder, we'll detect it later.
    // However, if we blindly extract `NapCat.Shell/foo.exe` to `dest`, it becomes `dest/NapCat.Shell/foo.exe`.
    // We want `dest/foo.exe`.
    
    // Check if ALL files share a common top-level directory.
    if archive.len() > 0 {
        // Simple heuristic: just extract. If `NapCat.Shell.exe` ends up in `dest/NapCat.Shell/NapCat.Shell.exe`,
        // our subsequent check `possible_nested` will catch it and move it up.
    }
    
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
    
    // Handle nested folder if it exists
    // Common case: NapCat.Shell.zip extracts to a folder named "NapCat.Shell" or similar.
    // We check for `NapCat.Shell.exe` or `napcat.mjs` recursively one level deep.
    
    let shell_exe = dest.join("NapCat.Shell.exe");
    let node_mjs = dest.join("napcat.mjs");

    if !shell_exe.exists() && !node_mjs.exists() {
        println!("[INFO] NapCat components not in root. Checking subdirectories...");
        for entry in fs::read_dir(dest)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                let nested_shell = path.join("NapCat.Shell.exe");
                let nested_node = path.join("napcat.mjs");
                
                if nested_shell.exists() || nested_node.exists() {
                    println!("[INFO] Found nested installation in {:?}. Moving files up...", path.file_name());
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
                    break; // Found and moved
                }
            }
        }
    }
    
    Ok(())
}

fn detect_qq_path() -> Result<String> {
    println!("[DEBUG] Detecting QQ Path from Registry...");
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

    if uninstall_string.is_empty() {
        println!("{}", "[ERROR] QQ not found in registry.".red());
        return Err(anyhow::anyhow!("QQ not found"));
    }

    // Uninstall string is usually like "C:\Path\To\QQ\Bin\Uninstall.exe"
    // We need "C:\Path\To\QQ\QQ.exe"
    let path = Path::new(&uninstall_string);
    let parent = path.parent().unwrap_or(Path::new("")); // Bin
    let grand_parent = parent.parent().unwrap_or(Path::new("")); // QQ Root
    
    // Heuristic: UninstallString usually points to executable inside Bin or root.
    // Let's try to construct QQ path.
    // Case 1: UninstallString is inside Bin
    let qq_exe = grand_parent.join("QQ.exe");
    if qq_exe.exists() {
        return Ok(qq_exe.to_string_lossy().to_string());
    }
    
    // Case 2: UninstallString is in root (less likely for QQ but possible)
    let qq_exe_alt = parent.join("QQ.exe");
    if qq_exe_alt.exists() {
        return Ok(qq_exe_alt.to_string_lossy().to_string());
    }

    println!("{}", "[WARN] Could not derive QQ.exe path from UninstallString.".yellow());
    println!("[DEBUG] UninstallString: {}", uninstall_string);
    
    // Fallback: Default install path
    let default_path = r"C:\Program Files (x86)\Tencent\QQ\Bin\QQ.exe";
    if Path::new(default_path).exists() {
        return Ok(default_path.to_string());
    }

    Err(anyhow::anyhow!("QQ.exe not found"))
}

fn launch_napcat(napcat_dir: &Path, qq_path: &str) -> Result<()> {
    println!("{}", "[INFO] Launching NapCat...".green());
    
    // Create a launcher batch file to ensure window stays open and environment is correct
    let batch_path = napcat_dir.join("run_napcat_gen.bat");
    let shell_exe = napcat_dir.join("NapCat.Shell.exe");
    let index_js = napcat_dir.join("index.js");
    let napcat_mjs = napcat_dir.join("napcat.mjs");
    let boot_exe = napcat_dir.join("NapCatWinBootMain.exe");
    let hook_dll = napcat_dir.join("NapCatWinBootHook.dll");

    let mut bat_content = String::new();
    bat_content.push_str("@echo off\r\n");
    bat_content.push_str("title NapCat Console\r\n");
    bat_content.push_str("echo [INFO] NapCat Launcher Wrapper\r\n");
    bat_content.push_str(&format!("echo [INFO] QQ Path: \"{}\"\r\n", qq_path));
    bat_content.push_str("echo [INFO] Starting...\r\n");
    
    if shell_exe.exists() {
        println!("[INFO] Using NapCat Shell (Headless)...");
        bat_content.push_str(&format!("\"{}\" -q \"{}\"\r\n", "NapCat.Shell.exe", qq_path));
    } else if index_js.exists() {
        println!("[INFO] Found index.js (NapCat Node Version). Using Node.js...");
        
        let bundled_node = napcat_dir.join("node.exe");
        let node_cmd = if bundled_node.exists() {
             println!("[INFO] Found bundled node.exe.");
             "node.exe".to_string() 
        } else {
             "node".to_string()
        };

        // NapCat.Shell.Windows.Node uses index.js as entry point
        // [FIX] Do NOT pass -q here, as it breaks session persistence (forces temp session or overrides config).
        // Matches napcat.bat behavior: node.exe ./index.js
        bat_content.push_str(&format!("\"{}\" index.js\r\n", node_cmd));
    } else if napcat_mjs.exists() {
        println!("[INFO] NapCat.Shell.exe missing, but found napcat.mjs. Using Node.js (Headless)...");
        
        let bundled_node = napcat_dir.join("node.exe");
        let node_cmd = if bundled_node.exists() {
             println!("[INFO] Found bundled node.exe.");
             "node.exe".to_string() 
        } else {
             "node".to_string()
        };

        // [FIX] Remove -q here as well
        bat_content.push_str(&format!("\"{}\" napcat.mjs\r\n", node_cmd));
    } else if boot_exe.exists() && hook_dll.exists() {
        println!("[WARN] Headless components missing. Falling back to GUI Boot mode (QQ window will appear).");
        bat_content.push_str(&format!("\"{}\" \"{}\" \"{}\"\r\n", "NapCatWinBootMain.exe", qq_path, "NapCatWinBootHook.dll"));
    } else {
        // Last resort: try to run via node if user has compatible node (unlikely but possible) or just launcher.bat
        bat_content.push_str("if exist launcher.bat (\r\n");
        bat_content.push_str("    call launcher.bat\r\n");
        bat_content.push_str(") else (\r\n");
        bat_content.push_str("    echo [ERROR] No executable found.\r\n");
        bat_content.push_str(")\r\n");
    }
    
    bat_content.push_str("if %errorlevel% neq 0 echo [ERROR] Process exited with code %errorlevel%\r\n");
    bat_content.push_str("echo [INFO] Process exited.\r\n");
    bat_content.push_str("pause\r\n");

    fs::write(&batch_path, bat_content)?;

    // Launch the generated batch file in a new window
    Command::new("cmd")
        .args(&["/C", "start", "NapCat Console", "/D", napcat_dir.to_str().unwrap(), "run_napcat_gen.bat"])
        .spawn()?;
        
    Ok(())
}

fn launch_perocore(pero_dir: &Path) -> Result<()> {
    println!();
    println!("{}", "[3/3] Starting PeroCore...".green());
    
    // pero_dir is now the PeroCore root directory itself
    let backend_dir = pero_dir;
    
    if !backend_dir.join("package.json").exists() {
        println!("{}", "[ERROR] PeroCore package.json not found in root.".red());
        std::process::exit(1);
    }

    println!("[INFO] Starting background service (npm run electron:dev)...");
    
    // Start Electron in background using proper quoting
    println!("[INFO] Backend Dir: {:?}", backend_dir);
    
    Command::new("powershell")
        .args(&[
            "-NoProfile", "-ExecutionPolicy", "Bypass", 
            "-Command", 
            "Start-Process", "cmd", "-ArgumentList", 
            &format!("'/c npm run electron:dev'"), 
            "-WorkingDirectory", &format!("'{}'", backend_dir.to_str().unwrap()),
            "-WindowStyle", "Hidden"
        ])
        .spawn()?;

    println!("[INFO] PeroCore launched.");
    println!("[INFO] You can close this launcher window now.");
    
    // Keep window open for a bit
    thread::sleep(Duration::from_secs(5));
    
    Ok(())
}
