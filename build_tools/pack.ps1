# PeroCore 自动化打包脚本
# 用途：全自动构建前端、配置便携式 Python 环境并打包 Tauri 应用

$ErrorActionPreference = "Stop"

# 1. 配置路径
$P_ROOT = Resolve-Path ".."
$P_BACKEND = Join-Path $P_ROOT "backend"
$P_LAUNCHER = Join-Path $P_ROOT "PeroLauncher"
$P_PYTHON_TARGET = Join-Path $P_LAUNCHER "src-tauri/python"
$P_NODE_BIN = Join-Path $P_LAUNCHER "src-tauri/bin/node.exe"

Write-Host ">>> 开始自动化打包流程..." -ForegroundColor Cyan

# 2. 前端构建
Write-Host ">>> [1/4] 正在构建前端项目..." -ForegroundColor Yellow
Set-Location $P_ROOT
npm run build

# 3. 准备便携式 Python 环境
Write-Host ">>> [2/4] 正在配置便携式 Python 环境..." -ForegroundColor Yellow
if (-not (Test-Path $P_PYTHON_TARGET)) {
    New-Item -ItemType Directory -Path $P_PYTHON_TARGET -Force
}

Set-Location $P_LAUNCHER
$PYTHON_ZIP = "python-embed.zip"
$PYTHON_URL = "https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip"

if (-not (Test-Path (Join-Path $P_PYTHON_TARGET "python.exe"))) {
    Write-Host "    正在下载 Python 嵌入式版本..."
    curl.exe -L -o $PYTHON_ZIP $PYTHON_URL
    Expand-Archive -Path $PYTHON_ZIP -DestinationPath $P_PYTHON_TARGET -Force
    Remove-Item $PYTHON_ZIP
}

# 配置 _pth 文件
$PTH_FILE = Join-Path $P_PYTHON_TARGET "python310._pth"
$PTH_CONTENT = @"
python310.zip
.
site-packages
import site
"@
$PTH_CONTENT | Out-File -FilePath $PTH_FILE -Encoding ascii -Force

# 创建 site-packages 并安装依赖
$P_SITE_PACKAGES = Join-Path $P_PYTHON_TARGET "site-packages"
if (-not (Test-Path $P_SITE_PACKAGES)) {
    New-Item -ItemType Directory -Path $P_SITE_PACKAGES -Force
}

Write-Host "    正在安装后端依赖 (这可能需要较长时间)..."
pip install -r (Join-Path $P_BACKEND "requirements.txt") --target $P_SITE_PACKAGES --upgrade

# 4. 准备 Node.exe (如果不存在)
if (-not (Test-Path $P_NODE_BIN)) {
    Write-Host ">>> [3/4] 正在准备便携式 Node.exe..." -ForegroundColor Yellow
    $NODE_URL = "https://nodejs.org/dist/v20.11.0/win-x64/node.exe"
    if (-not (Test-Path (Join-Path $P_LAUNCHER "src-tauri/bin"))) {
        New-Item -ItemType Directory -Path (Join-Path $P_LAUNCHER "src-tauri/bin") -Force
    }
    curl.exe -L -o $P_NODE_BIN $NODE_URL
}

# 5. 执行 Tauri 构建
Write-Host ">>> [4/4] 正在执行 Tauri 构建打包..." -ForegroundColor Yellow
Set-Location $P_LAUNCHER
cargo tauri build

Write-Host ">>> 打包完成！" -ForegroundColor Green
Write-Host "安装包位置: $P_ROOT\target\release\bundle\msi\" -ForegroundColor Gray
