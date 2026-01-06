# PeroCore Auto-Packaging Script (Strict Path Version)
$ErrorActionPreference = "Stop"

# 1. 严格路径定义 (基于脚本所在目录: PeroCore/build_tools)
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$P_PERO_CORE = Split-Path -Parent $SCRIPT_DIR  # 这应该是 PeroCore 目录

# 确保我们拿到的确实是 PeroCore 目录
if (-not $P_PERO_CORE.EndsWith("PeroCore")) {
    # 如果路径不对，尝试从当前工作目录强制纠正 (容错处理)
    $P_PERO_CORE = Get-Item "C:\Users\Administrator\Desktop\Perofamily\PeroCore"
}

$P_BACKEND = Join-Path $P_PERO_CORE "backend"
$P_LAUNCHER = Join-Path $P_PERO_CORE "PeroLauncher"
$P_PYTHON_TARGET = Join-Path $P_LAUNCHER "src-tauri/python"

Write-Host ">>> Starting Auto-Packaging Process..." -ForegroundColor Cyan
Write-Host ">>> Project Root: $P_PERO_CORE"
Write-Host ">>> Python Target: $P_PYTHON_TARGET"

# 2. 前端构建
Write-Host ">>> [1/3] Building Frontend Project..." -ForegroundColor Yellow
Set-Location $P_PERO_CORE
npm run build

# 3. 准备便携式 Python 环境
Write-Host ">>> [2/3] Configuring Portable Python Environment..." -ForegroundColor Yellow
if (-not (Test-Path $P_PYTHON_TARGET)) {
    New-Item -ItemType Directory -Path $P_PYTHON_TARGET -Force
}

$PYTHON_ZIP = Join-Path $P_LAUNCHER "python-embed.zip"
$PYTHON_URL = "https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip"
$GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py"
$GET_PIP_FILE = Join-Path $P_PYTHON_TARGET "get-pip.py"

if (-not (Test-Path (Join-Path $P_PYTHON_TARGET "python.exe"))) {
    Write-Host "    Downloading Python embeddable version..."
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

# 安装 pip
$P_SITE_PACKAGES = Join-Path $P_PYTHON_TARGET "site-packages"
if (-not (Test-Path $P_SITE_PACKAGES)) {
    New-Item -ItemType Directory -Path $P_SITE_PACKAGES -Force
}

if (-not (Test-Path (Join-Path $P_PYTHON_TARGET "Scripts/pip.exe"))) {
    Write-Host "    Installing pip..."
    curl.exe -L -o $GET_PIP_FILE $GET_PIP_URL
    & (Join-Path $P_PYTHON_TARGET "python.exe") $GET_PIP_FILE
    Remove-Item $GET_PIP_FILE
}

Write-Host "    Installing backend dependencies..."
& (Join-Path $P_PYTHON_TARGET "python.exe") -m pip install -r (Join-Path $P_BACKEND "requirements.txt") --target $P_SITE_PACKAGES --upgrade

# 4. 执行 Tauri 构建
Write-Host ">>> [3/3] Executing Tauri Build..." -ForegroundColor Yellow
Set-Location $P_PERO_CORE
npx tauri build --config (Join-Path $P_LAUNCHER "tauri.conf.json")

Write-Host ">>> Packaging Complete!" -ForegroundColor Green
$OUTPUT_DIR = Join-Path $P_PERO_CORE "target/release/bundle/msi/"
Write-Host "MSI Package Location: $OUTPUT_DIR"
