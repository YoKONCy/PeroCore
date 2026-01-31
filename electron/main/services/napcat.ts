import { app, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs-extra'
import { spawn, ChildProcess } from 'child_process'
import winreg from 'winreg'
import AdmZip from 'adm-zip'
import axios from 'axios'

let napcatProcess: ChildProcess | null = null
const napcatLogs: string[] = []

const isDev = !app.isPackaged

function getRootPath() {
    if (isDev) {
        return path.resolve(__dirname, '../../..')
    } else {
        return process.resourcesPath
    }
}

function getNapCatDir() {
    const root = getRootPath()
    // Try multiple locations similar to Rust logic (PeroLauncher/src/napcat.rs)
    // 尝试多个位置，类似于 Rust 逻辑 (PeroLauncher/src/napcat.rs)
    const trials = [
        path.join(root, 'backend/nit_core/plugins/social_adapter/NapCat'),
        path.join(root, 'nit_core/plugins/social_adapter/NapCat'),
        path.join(root, '_up_/backend/nit_core/plugins/social_adapter/NapCat'),
        path.join(root, '_up_/nit_core/plugins/social_adapter/NapCat')
    ]
    
    for (const trial of trials) {
        if (fs.existsSync(trial)) {
            console.log(`[NapCat] 发现安装路径: ${trial}`)
            return trial
        }
    }
    
    console.log(`[NapCat] 未找到安装，默认使用: ${trials[0]}`)
    return trials[0]
}

async function getQQPath(): Promise<string> {
    const regKeys = [
        '\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ',
        '\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ'
    ]

    for (const keyPath of regKeys) {
        try {
            const key = new winreg({
                hive: winreg.HKLM,
                key: keyPath
            })

            const item = await new Promise<winreg.RegistryItem | null>((resolve) => {
                key.get('UninstallString', (err, item) => {
                    if (err) resolve(null)
                    else resolve(item)
                })
            })

            if (item) {
                const uninstallPath = item.value.replace(/"/g, '') // Remove quotes // 移除引号
                const binDir = path.dirname(uninstallPath)
                const qqInBin = path.join(binDir, 'QQ.exe')
                const qqInRoot = path.join(binDir, '..', 'QQ.exe')

                if (await fs.pathExists(qqInBin)) return qqInBin
                if (await fs.pathExists(qqInRoot)) return path.normalize(qqInRoot)
            }
        } catch (e) {
            // Ignore registry errors
            // 忽略注册表错误
        }
    }

    // Default paths fallback
    // 默认路径后备
    const possiblePaths = [
        "C:\\Program Files (x86)\\Tencent\\QQ\\Bin\\QQ.exe",
        "C:\\Program Files\\Tencent\\QQ\\Bin\\QQ.exe"
    ]
    
    for (const p of possiblePaths) {
        if (await fs.pathExists(p)) return p
    }
    
    return ""
}

export async function startNapCat(window: BrowserWindow) {
    if (napcatProcess) return

    const napcatDir = getNapCatDir()
    const qqPath = await getQQPath()
    
    if (!await fs.pathExists(napcatDir)) {
        throw new Error(`NapCat 目录未找到: ${napcatDir}`)
    }

    if (qqPath) {
        try { if (!window.isDestroyed()) window.webContents.send('napcat-log', `[系统] 在以下位置找到 QQ: ${qqPath}`) } catch(e){}
        console.log(`[NapCat] 在以下位置找到 QQ: ${qqPath}`)
    } else {
        try { if (!window.isDestroyed()) window.webContents.send('system-error', '未找到 QQ。NapCat 需要安装 QQ。') } catch(e){}
        throw new Error('默认路径或注册表中未找到 QQ。')
    }

    // Try NapCat.Shell.exe first
    // 首先尝试 NapCat.Shell.exe
    const shellExe = path.join(napcatDir, 'NapCat.Shell.exe')
    const napcatBat = path.join(napcatDir, 'napcat.bat')
    const indexJs = path.join(napcatDir, 'index.js')
    const napcatMjs = path.join(napcatDir, 'napcat.mjs')
    
    console.log(`[NapCat] 正在检查入口点 ${napcatDir}`)
    console.log(`[NapCat] Shell 存在: ${fs.existsSync(shellExe)}`)
    console.log(`[NapCat] MJS 存在: ${fs.existsSync(napcatMjs)}`)
    console.log(`[NapCat] Bat 存在: ${fs.existsSync(napcatBat)}`)
    console.log(`[NapCat] Index 存在: ${fs.existsSync(indexJs)}`)

    let cmd = ''
    let args: string[] = []
    let env = { ...process.env }
    
    if (fs.existsSync(shellExe)) {
        cmd = shellExe
        args = ['-q', qqPath]
    } else if (fs.existsSync(napcatMjs)) {
        // Prefer direct node execution for napcat.mjs (fixes index.js CJS/ESM conflict)
        // 优先直接用 node 执行 napcat.mjs (修复 index.js CJS/ESM 冲突)
        cmd = 'node'
        // [Fix] Remove -q args to match Rust behavior and fix auto-login issue
        // Rust PeroLauncher does not pass -q for Node versions, allowing NapCat to use its own config/session.
        // Passing -q forces quick login which might fail if local QQ client state is invalid, ignoring saved session.
        args = ['napcat.mjs']
        
        // Replicate environment variables from index.js
        // 复制 index.js 中的环境变量
        env.NAPCAT_WRAPPER_PATH = path.join(napcatDir, 'wrapper.node')
        env.NAPCAT_QQ_PACKAGE_INFO_PATH = path.join(napcatDir, 'package.json')
        env.NAPCAT_QQ_VERSION_CONFIG_PATH = path.join(napcatDir, 'config.json')
        env.NAPCAT_DISABLE_PIPE = '1'
    } else if (fs.existsSync(napcatBat)) {
        // If bat exists but mjs was not found by specific name, try to find any mjs or fallback
        // But since napcat.bat is known broken for v4.12.8, we should avoid it if possible.
        // Let's check if we can force node execution of index.js as CJS? No, package.json prevents it.
        // Maybe we can try to run napcat.mjs even if existsSync failed? (Unlikely)
        // 如果 bat 存在但未找到特定名称的 mjs，尝试查找任何 mjs 或回退
        // 但由于 napcat.bat 在 v4.12.8+ 中已知已损坏，如果可能应避免使用。
        // 让我们检查是否可以强制作为 CJS 执行 index.js？不，package.json 阻止了它。
        // 也许我们可以尝试运行 napcat.mjs 即使 existsSync 失败？(不太可能)
        
        console.warn("[NapCat] 正在回退到 napcat.bat，但这可能会在 v4.12.8+ 上失败")
        cmd = 'cmd.exe'
        args = ['/c', 'napcat.bat', '-q', qqPath]
    } else if (fs.existsSync(indexJs)) {
        cmd = 'node'
        // [Fix] Remove -q args to match Rust behavior
        args = ['index.js']
    } else {
         throw new Error('未找到有效的 NapCat 入口点。')
    }

    console.log(`[NapCat] 正在启动: ${cmd} ${args.join(' ')} 在 ${napcatDir}`)
    try { if (!window.isDestroyed()) window.webContents.send('napcat-log', `[系统] 正在启动 NapCat...`) } catch(e){}

    napcatProcess = spawn(cmd, args, {
        cwd: napcatDir,
        env: env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
    })

    napcatProcess.stdout?.on('data', (data) => {
        const line = data.toString().trim()
        if (!line) return
        napcatLogs.push(line)
        if (napcatLogs.length > 2000) napcatLogs.shift()
        try { if (!window.isDestroyed()) window.webContents.send('napcat-log', line) } catch(e){}
    })

    napcatProcess.stderr?.on('data', (data) => {
        const line = data.toString().trim()
        if (!line) return
        console.error(`[NapCat 错误] ${line}`)
        try { if (!window.isDestroyed()) window.webContents.send('napcat-log', `[错误] ${line}`) } catch(e){}
    })

    napcatProcess.on('close', (code) => {
        console.log(`[NapCat] 已退出，代码 ${code}`)
        napcatProcess = null
        try { if (!window.isDestroyed()) window.webContents.send('napcat-log', `[系统] NapCat 已退出 (代码: ${code})`) } catch(e){}
    })
}

export function stopNapCat() {
    if (napcatProcess) {
        napcatProcess.kill()
        napcatProcess = null
    }
}

export function getNapCatLogs() {
    return napcatLogs
}

export function sendNapCatCommand(command: string) {
    if (napcatProcess && napcatProcess.stdin) {
        napcatProcess.stdin.write(command + '\n')
    } else {
        throw new Error('NapCat 未运行')
    }
}

export function checkNapCatInstalled() {
    const dir = getNapCatDir()
    const shellExe = path.join(dir, 'NapCat.Shell.exe')
    const mjs = path.join(dir, 'napcat.mjs')
    const indexJs = path.join(dir, 'index.js')
    return fs.existsSync(shellExe) || fs.existsSync(mjs) || fs.existsSync(indexJs)
}

export async function installNapCat(window: BrowserWindow) {
    const dir = getNapCatDir()
    const emit = (msg: string) => {
        console.log(`[NapCat 安装程序] ${msg}`)
        try { if (!window.isDestroyed()) window.webContents.send('napcat-log', msg) } catch(e){}
    }

    emit(`正在检查 NapCat: ${dir}`)

    if (checkNapCatInstalled()) {
        emit("NapCat 已安装。")
        return true
    }

    emit("未找到 NapCat。开始下载...")
    await fs.ensureDir(dir)

    const version = "v4.12.8"
    const assetName = "NapCat.Shell.Windows.Node.zip"
    
    // List of mirrors to try
    const mirrors = [
        `https://mirror.ghproxy.com/https://github.com/NapNeko/NapCatQQ/releases/download/${version}/${assetName}`,
        `https://gh-proxy.com/https://github.com/NapNeko/NapCatQQ/releases/download/${version}/${assetName}`,
        `https://github.moeyy.xyz/https://github.com/NapNeko/NapCatQQ/releases/download/${version}/${assetName}`,
        `https://hub.gitmirror.com/https://github.com/NapNeko/NapCatQQ/releases/download/${version}/${assetName}`,
        `https://github.com/NapNeko/NapCatQQ/releases/download/${version}/${assetName}`
    ]
    
    const download = async (downloadUrl: string) => {
        const response = await axios({
            method: 'get',
            url: downloadUrl,
            responseType: 'arraybuffer',
            timeout: 60000, // Increased timeout to 60s // 增加超时至 60s
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        })
        return response.data
    }

    let zipBuffer: Buffer | null = null
    
    for (const url of mirrors) {
        try {
            emit(`尝试下载: ${url}`)
            zipBuffer = await download(url)
            if (zipBuffer) break
        } catch (e: any) {
            emit(`失败: ${e.message}`)
            continue
        }
    }

    if (!zipBuffer) {
        emit("所有镜像下载失败。")
        throw new Error("所有镜像下载失败。")
    }

    emit("下载完成。正在解压...")
    
    try {
        const zip = new AdmZip(zipBuffer)
        zip.extractAllTo(dir, true)

        // Handle nested folder logic
        // 处理嵌套文件夹逻辑
        const shellExe = path.join(dir, "NapCat.Shell.exe")
        const nodeMjs = path.join(dir, "napcat.mjs")
        
        if (!await fs.pathExists(shellExe) && !await fs.pathExists(nodeMjs)) {
             const entries = await fs.readdir(dir, { withFileTypes: true })
             for (const entry of entries) {
                 if (entry.isDirectory()) {
                     const nestedPath = path.join(dir, entry.name)
                     const nestedShell = path.join(nestedPath, "NapCat.Shell.exe")
                     const nestedNode = path.join(nestedPath, "napcat.mjs")
                     
                     if (await fs.pathExists(nestedShell) || await fs.pathExists(nestedNode)) {
                         // Move content up
                         // 将内容向上移动
                         await fs.copy(nestedPath, dir, { overwrite: true })
                         await fs.remove(nestedPath)
                         break
                     }
                 }
             }
        }

        emit("安装完成。")
        return true
    } catch (e: any) {
        emit(`安装失败: ${e.message}`)
        return false
    }
}
