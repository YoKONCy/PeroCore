use std::path::PathBuf;
use std::fs;
use std::io::{self, Cursor};
use tauri::{AppHandle, Emitter};
use zip::ZipArchive;
use reqwest::blocking::Client;

use tauri::Manager;

pub fn get_es_dir(app: &AppHandle) -> PathBuf {
    // 1. 优先探测开发环境
    let dev_root = crate::get_workspace_root();
    let dev_path = dev_root.join("backend/nit_core/tools/core/FileSearch");
    if dev_path.exists() {
        return dev_path;
    }

    // 2. 释放环境 (Release)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let pkg_path = resource_dir.join("backend/nit_core/tools/core/FileSearch");
        if pkg_path.exists() {
            return pkg_path;
        }
        
        let flat_path = resource_dir.join("nit_core/tools/core/FileSearch");
        if flat_path.exists() {
            return flat_path;
        }
    }

    dev_path
}

pub fn emit_log(app: &AppHandle, msg: String) {
    let _ = app.emit("es-log", msg);
}

pub fn check_es_installed(app: &AppHandle) -> bool {
    let dir = get_es_dir(app);
    let exe = dir.join("es.exe");
    exe.exists()
}

pub fn install_es(app: AppHandle) -> Result<(), String> {
    let dir = get_es_dir(&app);
    emit_log(&app, format!("Checking ES tool in: {:?}", dir));

    if check_es_installed(&app) {
        emit_log(&app, "ES tool already installed.".to_string());
        return Ok(());
    }

    emit_log(&app, "ES tool not found. Starting download...".to_string());
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // URL for ES command line tool (x64)
    let url = "https://www.voidtools.com/ES-1.1.0.27.x64.zip";
    
    let client = Client::new();
    let response = client.get(url).send().map_err(|e| format!("Download failed: {}", e))?;
    
    if !response.status().is_success() {
         return Err(format!("Download failed with status: {}", response.status()));
    }

    // Read bytes
    let bytes = response.bytes().map_err(|e| e.to_string())?;
    let reader = Cursor::new(bytes);
    let mut archive = ZipArchive::new(reader).map_err(|e| e.to_string())?;

    // Extract only es.exe
    let mut found = false;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        if file.name() == "es.exe" {
            let outpath = dir.join("es.exe");
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            found = true;
            break;
        }
    }

    if !found {
        return Err("es.exe not found in downloaded zip".to_string());
    }
    
    emit_log(&app, "ES tool installation complete.".to_string());
    Ok(())
}
