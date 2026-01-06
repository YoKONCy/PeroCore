# Tauri + Vite 开发环境启动性能优化指南 (Windows 平台)

## 1. 现象描述
在 Windows 开发环境下，Tauri 应用在“冷启动”（即系统重启或清理资源后的第一次运行）时，会出现长达 **30-60 秒** 的白屏时间。
- **特征**：Rust 后端逻辑秒开（`setup` 钩子迅速执行完毕），但 WebView2 窗口持续白屏。
- **关键对比**：一旦 UI 成功加载过一次，后续的启动（热启动）几乎是瞬间完成的。
- **与 Electron 的区别**：Electron 内置 Chromium 网络栈，对 Loopback（127.0.0.1）的连接处理较为独立；Tauri 依赖系统 WebView2，受 Windows 安全策略和过滤驱动（WFP）影响极大。

## 2. 核心原因分析
经过深度排查，该延迟并非代码逻辑问题，而是由以下系统级因素共同导致的：

### A. Windows 网络环回（Loopback）审计延迟
当一个新的进程（如 `PeroLauncher.exe`）第一次尝试连接本地端口（如 `127.0.0.1:5173`）时，Windows 的过滤驱动或杀毒软件会对该“新连接”进行深度的安全扫描。
- **60秒超时**：这是一个典型的系统级 TCP 握手审计超时时间。
- **连接复用**：第一次成功后，系统会缓存该连接的安全上下文，因此后续启动不再触发审计。

### B. WebView2 自动代理探测 (WPAD)
WebView2 在冷启动时默认会尝试探测系统的代理设置。如果网络环境中有虚拟网卡、VPN 或复杂的代理配置，该探测过程会陷入挂起，直到超时回退。

### C. Vite 依赖预构建阻塞
Vite 在处理首次请求时，如果发现重型依赖（如 `ECharts`, `Element Plus`）未编译，会进行同步的预构建，这在 WebView2 已经处于等待状态时会加剧阻塞感。

## 3. 解决方案与优化建议

### 代码层面 (Rust)
在 `src-tauri/src/lib.rs` 中注入环境变量，强行关闭 WebView2 的网络嗅探：

```rust
pub fn run() {
    // 1. 强行关闭代理探测和安全检查
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", 
        "--no-proxy-server --proxy-server='direct://' --proxy-bypass-list='*' --disable-features=msSmartScreenProtection");

    tauri::Builder::default()
        // ... 其他配置
}
```

### 配置层面 (Vite)
在 `vite.config.js` 中强制开启依赖预热，减少首次加载时的模块扫描时间：

```javascript
export default defineConfig({
  server: {
    host: '127.0.0.1', // 强制使用 IPv4，避免 localhost 解析到 IPv6 的延迟
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    include: [
      'vue', 'vue-router', 'element-plus', 'echarts', // 显式包含大型库
      '@tauri-apps/api', '@tauri-apps/plugin-shell'
    ]
  }
})
```

### 开发工作流优化
- **常驻 Vite**：开发时保持一个独立的终端运行 `npm run dev`，不要依赖 Tauri 频繁启停前端服务。
- **生产验证**：由于生产环境使用 `tauri://` 协议加载内置资源，**不经过 TCP 网络栈**，因此不会存在上述 60 秒延迟。验证性能时应以 `npm run tauri build -- --debug` 的结果为准。

## 4. 总结
Tauri 的轻量化是以牺牲一部分开发环境的“黑盒自动化”为代价的。理解 WebView2 与 Windows 系统底层的交互逻辑，是解决此类“疑难杂症”的关键。
