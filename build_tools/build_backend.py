import os
import subprocess
import sys
import shutil
import platform

def build_backend():
    print(">>> Starting Python backend packaging...")
    
    # 1. 确认路径
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    launcher_bin_dir = os.path.join(os.path.dirname(backend_dir), "PeroLauncher", "src-tauri", "bin")
    
    if not os.path.exists(launcher_bin_dir):
        os.makedirs(launcher_bin_dir)
        print(f"Created bin directory: {launcher_bin_dir}")

    # 2. 获取目标文件名 (Tauri Sidecar 命名规范: name-target.exe)
    # 对于 Windows 通常是 x86_64-pc-windows-msvc
    target_triple = "x86_64-pc-windows-msvc" 
    sidecar_name = f"pero-backend-{target_triple}.exe"
    target_path = os.path.join(launcher_bin_dir, sidecar_name)

    # 3. 执行 PyInstaller
    # --onedir: 推荐模式，启动快，易于调试资源路径
    # --noconsole: 不显示黑窗口
    # --hidden-import: 确保一些动态加载的库被包含
    cmd = [
        "pyinstaller",
        "--noconsole",
        "--onedir",
        "--name", "pero-backend",
        "--clean",
        "--workpath", "build",
        "--distpath", "dist",
        "main.py"
    ]
    
    print(f"Executing: {' '.join(cmd)}")
    subprocess.check_call(cmd, cwd=backend_dir)

    # 4. 移动并重命名到 Tauri 目录
    # 注意：PyInstaller --onedir 会生成一个文件夹，我们需要的是里面的 exe
    source_exe = os.path.join(backend_dir, "dist", "pero-backend", "pero-backend.exe")
    
    # 为了方便，我们先用 --onefile 测试，如果太慢再改回 onedir
    # 这里我们重新用 --onefile 打包以简化 Sidecar 部署
    print(">>> Re-packaging with --onefile for simpler Sidecar distribution...")
    cmd_onefile = [
        "pyinstaller",
        "--noconsole",
        "--onefile",
        "--name", "pero-backend",
        "main.py"
    ]
    subprocess.check_call(cmd_onefile, cwd=backend_dir)
    
    source_onefile_exe = os.path.join(backend_dir, "dist", "pero-backend.exe")
    shutil.copy2(source_onefile_exe, target_path)
    
    print(f"\n>>> Success! Sidecar created at: {target_path}")

if __name__ == "__main__":
    build_backend()
