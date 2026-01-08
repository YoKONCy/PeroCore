# Pero 项目全量打包技术指南

本指南详细说明了如何构建一个"零依赖、开箱即用"的 Pero 应用安装包。

## 1. 核心打包策略
项目采用 **"便携式运行时集成"** 方案，而非传统的单文件编译：
- **Python**: 集成 Python 3.10 嵌入式版本 (python-embed)，并预装所有依赖到 `site-packages`。
- **Rust Core**: 使用 `tract-onnx` (纯 Rust ONNX 推理引擎) 提供高性能视觉意图推理，无需外部 ONNX Runtime 库。
- **Node.js**: 集成便携式 `node.exe` 用于驱动 NapCat 等功能（可选）。
- **资源**: 所有提示词 (MDP)、核心代码和配置文件均作为 Tauri 资源打包。

## 2. 自动化云打包 (推荐)

### **GitHub Actions 自动构建**
项目已配置 GitHub Actions 云打包工作流 (`.github/workflows/release.yml`)：

**触发方式**：
- 推送到 `tauri` 分支
- 手动触发 (workflow_dispatch)

**自动完成的工作**：
1. ✅ 安装 Node.js 20、Rust stable、Python 3.10
2. ✅ 下载并配置 Python 3.10 嵌入式版本到 `PeroLauncher/src-tauri/python`
3. ✅ 自动安装 `backend/requirements.txt` 所有依赖到嵌入式 Python
4. ✅ 构建前端 (`npm run build`)
5. ✅ 使用 Tauri v2 构建 MSI 安装包
6. ✅ 自动发布 Release 到 GitHub Releases

**优势**：
- 无需本地配置复杂环境
- 确保构建环境干净一致
- 自动生成版本号和 Release Notes

## 3. 本地构建指南

### **3.1 前置要求**
- **Node.js** 20+
- **Rust** 1.77.2+ (通过 `rustup` 安装)
- **Python** 3.10+ (用于开发和安装依赖，最终会被嵌入式版本替代)
- **WebView2** (Windows 用户通常已预装)

### **3.2 本地一键打包脚本**
我们提供了本地打包工具，位于 `.\PeroCore\build_tools\pack.ps1`（如果存在）。

**使用方法**：
```powershell
cd Perofamily\PeroCore\build_tools
.\pack.ps1
```

**该脚本会自动完成以下工作**：
- ✅ 前端构建：运行 `npm run build`
- ✅ 环境配置：
    - 检查并下载便携式 Python 到 `PeroLauncher/src-tauri/python`
    - 自动安装 `backend/requirements.txt` 中的所有依赖
    - （可选）检查并下载便携式 `node.exe`
- ✅ Tauri 构建：运行 `npm run tauri build` 生成安装包

### **3.3 手动构建步骤**
如果需要手动控制每一步：

```powershell
# 1. 安装前端依赖
npm install

# 2. 构建前端
npm run build

# 3. (可选) 准备嵌入式 Python
# 参考 .github/workflows/release.yml 中的 PowerShell 脚本

# 4. 构建 Tauri 应用
npm run tauri build
```

## 4. 关键配置说明

### **4.1 Tauri 资源配置** (`PeroLauncher/tauri.conf.json`)
确保 `bundle.resources` 包含了以下路径：
- `../backend/**/*` (Python 后端代码、配置、prompts)
- `src-tauri/python/**/*` (嵌入式 Python 运行时与依赖库)
- `src-tauri/bin/node.exe` (可选：Node.js 运行时)

### **4.2 后端启动逻辑** (`PeroLauncher/src/lib.rs`)
- 程序启动时会通过 `app.path().resource_dir()` 自动检测运行模式
- **开发模式**：使用 `backend/venv/Scripts/python.exe` (如果存在)
- **生产模式**：使用打包的 `python/python.exe`
- 自动处理路径（包括修复 Windows 长路径前缀 `\\?\` 的问题）

### **4.3 Rust Core 编译** (`backend/rust_core/Cargo.toml`)
- 使用 `tract-onnx` 进行 ONNX 推理（纯 Rust，无需外部库）
- Release 模式启用 LTO 完整优化、strip 调试符号
- PyO3 扩展模块支持 Python 调用 Rust 高性能函数

## 5. 产物位置

构建完成后，你可以在以下目录找到安装包：
- **MSI 安装包**: `PeroCore/target/release/bundle/msi/PeroLauncher_x.x.x_x64.msi`
- **绿色版 EXE**: `PeroCore/target/release/pero_launcher.exe`

## 6. 故障排除

### **6.1 缺少 WebView2 运行时 (最常见)**
- **症状**：双击图标后没有任何窗口弹出，任务管理器里也没有进程。
- **解决**：强烈建议让用户安装 **MSI 安装包**（会自动处理 WebView2 依赖）。
- **手动安装**：[下载 WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)

### **6.2 Rust 编译错误**
如果遇到 `ort` 或 ONNX Runtime 相关错误：
- ✅ 已修复：项目现在使用 `tract-onnx` (纯 Rust)，不再依赖外部 ONNX Runtime
- 确保 `backend/rust_core/Cargo.toml` 中没有 `ort` 依赖

### **6.3 Python 依赖问题**
- **开发环境**：确保已创建虚拟环境并安装依赖：
  ```powershell
  cd backend
  python -m venv venv
  .\venv\Scripts\activate
  pip install -r requirements.txt
  ```
- **打包环境**：确保嵌入式 Python 的 `site-packages` 目录正确安装了所有依赖

### **6.4 路径包含中文/特殊字符**
- **症状**：Python 嵌入版对某些非 ASCII 路径可能敏感。
- **解决**：尝试安装在纯英文路径下（如 `C:\PeroCore`）。

### **6.5 缺少 VC++ 运行库**
- **解决**：安装 [Visual C++ Redistributable 2015-2022](https://aka.ms/vs/17/release/vc_redist.x64.exe)

### **6.6 查看错误日志**
- 如果程序能启动但功能异常，可以从命令行运行查看详细日志：
  ```powershell
  .\pero_launcher.exe
  ```

## 7. 技术栈版本信息

| 组件 | 版本 | 说明 |
|------|------|------|
| Tauri | 2.9.5+ | 桌面应用框架 (v2) |
| tauri-action | v0.5+ | GitHub Actions 构建插件 (支持 Tauri v2) |
| Node.js | 20+ | 前端构建环境 |
| Rust | 1.77.2+ | 系统语言 |
| Python | 3.10.11 (embed) | 后端运行时 |
| tract-onnx | 0.21+ | ONNX 推理引擎 (纯 Rust) |
| Vue.js | 3.5+ | 前端框架 |
| Vite | 7.2+ (rolldown-vite) | 前端构建工具 |

## 8. 注意事项

- **首次构建**：由于需要下载 Python 环境并安装大量依赖库（如深度学习相关库），首次构建可能需要 10-30 分钟。
- **依赖更新**：修改 `backend/requirements.txt` 后，需要重新打包或重新运行安装脚本。
- **云打包推荐**：对于正式发布，建议使用 GitHub Actions 云打包，确保环境一致性。
- **tauri.conf.json 位置**：配置文件位于 `PeroLauncher/tauri.conf.json`（**不是** `PeroLauncher/src-tauri/`）
