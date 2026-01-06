# Pero 项目全量打包技术指南

本指南详细说明了如何构建一个“零依赖、开箱即用”的 Pero 应用安装包。

## 1. 核心打包策略
项目采用 **“便携式运行时集成”** 方案，而非传统的单文件编译：
- **Python**: 集成 Python 3.10 嵌入式版本 (python-embed)，并预装所有依赖到 `site-packages`。
- **Node.js**: 集成便携式 `node.exe` 用于驱动 NapCat 等功能。
- **资源**: 所有提示词 (MDP)、核心代码和配置文件均作为 Tauri 资源打包。

## 2. 自动化构建工具 (推荐)
我们提供了一键打包工具，位于 `.\PeroCore\build_tools\pack.ps1`。

### **使用方法**：
1. 打开 PowerShell。
2. 进入项目根目录：`cd Perofamily\PeroCore\build_tools`。
3. 执行打包脚本：`.\pack.ps1`。

### **该脚本会自动完成以下工作**：
- **前端构建**：运行 `npm run build`。
- **环境配置**：
    - 检查并下载便携式 Python。
    - 自动安装 `backend/requirements.txt` 中的所有依赖。
    - 检查并下载便携式 `node.exe`。
- **Tauri 构建**：运行 `cargo tauri build` 生成 MSI 安装包。

## 3. 手动构建要点 (如果需要)
如果你需要手动微调打包流程，请注意以下关键配置：

### **Tauri 资源配置** ([tauri.conf.json](file:///c:/Users/Administrator/Desktop/Perofamily/PeroCore/PeroLauncher/tauri.conf.json))
确保 `bundle.resources` 包含了以下路径：
- `../backend/core/**/*`, `../backend/services/**/*`, `../backend/prompts/**/*` (业务逻辑与资源)
- `src-tauri/bin/node.exe` (Node 运行时)
- `src-tauri/python/**/*` (Python 运行时与依赖库)

### **后端启动逻辑** ([lib.rs](file:///c:/Users/Administrator/Desktop/Perofamily/PeroCore/PeroLauncher/src/lib.rs))
- 程序启动时会通过 `app.path().resource_dir()` 自动检测是否处于安装模式。
- 若检测到内置 Python，将优先使用 `python/python.exe` 运行 `backend/main.py`。

## 4. 产物位置
构建完成后，你可以在以下目录找到安装包：
- **MSI 安装包**: `target\release\bundle\msi\PeroLauncher_x.x.x_x64.msi`
- **绿色版 EXE**: `target\release\pero_launcher.exe`

## 5. 故障排除 (如果朋友运行没反应)
如果发给别人的安装包启动后没反应，通常是以下原因：

### **1. 缺少 WebView2 运行时 (最常见)**
- **症状**：双击图标后没有任何窗口弹出，任务管理器里也没有进程。
- **解决**：强烈建议让朋友运行 **MSI 安装包** 而不是直接发 EXE。MSI 会检测并自动引导用户下载安装 WebView2。

### **2. 路径包含中文/特殊字符**
- **症状**：虽然我们做了路径适配，但 Python 嵌入版对某些非 ASCII 路径可能依然敏感。
- **解决**：尝试安装在纯英文路径下（如 `C:\PeroCore`）。

### **3. 缺少 VC++ 运行库**
- **解决**：安装 [Visual C++ Redistributable 2015-2022](https://aka.ms/vs/17/release/vc_redist.x64.exe)。

### **4. 查看错误日志**
- 如果程序能启动但功能异常，可以在控制台运行 `pero_launcher.exe` 查看 Rust 输出的详细错误路径。

## 6. 注意事项
- **第一次构建**：由于需要下载 Python 环境并安装庞大的第三方库 (如 Torch)，第一次运行 `pack.ps1` 会比较慢。
- **依赖更新**：如果你修改了 `backend/requirements.txt`，再次运行 `pack.ps1` 会自动更新内置环境。
