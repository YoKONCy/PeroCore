# PeroLauncher 开发与构建技术备忘录

本文档记录了项目在开发和构建过程中遇到的重大坑点及其解决方案，旨在防止后续维护中再次掉入同样的陷阱。

## 1. 编译死锁与 OS Error 5 (重点)

### 坑点描述
在运行 `npm run tauri dev` 时，Cargo 经常卡死或报错 `os error 5 (Access is denied)`，尤其是在 `backend` 目录下存在大量模型文件、数据库或 `.git` 文件夹时。

### 原因分析
Tauri 的默认构建逻辑（由 `tauri-build` 触发）会扫描 `tauri.conf.json` 中 `bundle > resources` 列表里的所有文件。
- 如果资源路径包含通配符（如 `../backend/**/*`），Cargo 会深度扫描整个后端目录。
- 扫描大型二进制文件或包含数万个小文件的 `.git` 目录会导致文件句柄占用或扫描超时，从而触发 OS Error 5。

### 解决方案：双配置文件架构
我们引入了**开发环境与打包环境分离**的策略：
- **`tauri.conf.json` (本地开发专用)**:
    - `resources` 数组设为空 `[]`。
    - **优点**: Cargo 不再扫描外部资源，编译速度提升 10 倍以上，彻底杜绝 OS Error 5。
- **`tauri.conf.pkg.json` (正式打包专用)**:
    - 包含完整的、精准过滤后的资源列表。
    - 仅在发布版本时通过 `npm run pkg:tauri` 调用。

---

## 2. 构建命令规范

为了适配双配置架构，请统一使用以下命令：

| 环境 | 命令 | 配置文件 | 备注 |
| :--- | :--- | :--- | :--- |
| **本地开发** | `npm run tauri` | `tauri.conf.json` | 极速启动，不包含后端资源 |
| **本地模拟打包** | `npm run pkg:tauri` | `tauri.conf.pkg.json` | 完整打包，包含后端资源 |
| **GitHub CI** | 自动触发 | `tauri.conf.pkg.json` | 已在 `release.yml` 中配置 |

---

## 3. Rust Core (pero-memory-core) 打包优化

### 坑点：aarch64 编译失败
`backend/rust_core` 引入了 `tract-onnx` 和 `image` 等视觉处理库，这些库在 aarch64 (ARM) 架构的云端构建环境下极易因依赖缺失或性能问题报错。

### 优化方案：Feature 隔离
我们对 `rust_core` 进行了功能解耦：
- **`vision` feature**: 包含所有重型依赖。
- **默认配置**: 本地开发默认开启 `vision`。
- **云端构建**: 在 `.github/workflows/pypi-publish.yml` 中使用 `--no-default-features`。
    - 这使得云端发布的 PyPI 包仅包含轻量级的核心内存算法（向量检索、扩散、图谱），确保了 100% 的构建成功率和极小的包体积。

---

## 4. 其它注意事项

### Workspace Profile 警告
**现象**: `warning: profiles for the non root package will be ignored`。
**要求**: Rust 规定所有的编译优化配置（如 `opt-level = 3`, `lto = "fat"`）必须写在项目根目录的 `Cargo.toml` 中，写在子模块（如 `rust_core`）中会被忽略。后续若需调整性能，请前往根目录操作。

### 资源路径过滤
在 `tauri.conf.pkg.json` 中添加新资源时，务必使用 `!` 前缀剔除不需要的文件（如 `**/*.exe`, `**/*.db`, `.git/**/*`），以减小安装包体积。
