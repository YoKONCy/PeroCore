import { BrowserWindow, ipcMain } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs-extra'
import { getDiagnostics } from './diagnostics'

let backendProcess: ChildProcess | null = null
const logHistory: string[] = []
const MAX_LOGS = 2000

export function getBackendLogs() {
    return [...logHistory]
}

export async function startBackend(window: BrowserWindow, enableSocialMode: boolean) {
    // 1. Diagnostics
    // 1. 诊断
    const diag = await getDiagnostics()
    if (diag.errors.length > 0) {
        throw new Error(`启动失败！诊断错误：\n${diag.errors.join('\n')}`)
    }

    if (backendProcess) {
        return
    }

    const pythonPath = diag.python_path
    const scriptPath = diag.script_path
    const dataDir = diag.data_dir
    const backendRoot = path.dirname(scriptPath)
    
    // Config paths
    // 配置路径
    const dbPath = path.join(dataDir, 'perocore.db')
    const configPath = path.join(dataDir, 'config.json')

    // Initial config copy if needed
    // 如果需要，初始配置复制
    if (!(await fs.pathExists(configPath))) {
        // ... resource copy logic similar to Rust
        // Simplified for now
        // ... 类似于 Rust 的资源复制逻辑
        // 暂时简化
    }

    // Env setup
    // 环境变量设置
    const pythonPathEnv = process.env.PYTHONPATH 
        ? `${backendRoot};${process.env.PYTHONPATH}` 
        : backendRoot

    const env = {
        ...process.env,
        PYTHONPATH: pythonPathEnv,
        PYTHONHOME: undefined,
        PYTHONSTARTUP: undefined,
        PIP_CONFIG_FILE: undefined,
        PYTHONNOUSERSITE: '1',
        PYTHONUNBUFFERED: '1',
        PORT: '9120',
        ENABLE_SOCIAL_MODE: enableSocialMode.toString(),
        PERO_DATA_DIR: dataDir,
        PERO_DATABASE_PATH: dbPath,
        PERO_CONFIG_PATH: configPath,
    }

    // Spawn
    // 启动子进程
    const child = spawn(pythonPath, ['-u', scriptPath], {
        cwd: backendRoot,
        env: env as any,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false, // Ensure it dies with parent // 确保随父进程退出
        windowsHide: true
    })

    child.stdout?.on('data', (data) => {
        const line = data.toString().trim()
        console.log(`[后端] ${line}`)
        try {
            if (window && !window.isDestroyed()) {
                window.webContents.send('backend-log', line)
            }
        } catch (e) {
            // Ignore send error
        }
        
        if (logHistory.length >= MAX_LOGS) logHistory.shift()
        logHistory.push(line)
    })

    child.stderr?.on('data', (data) => {
        const line = data.toString().trim()
        console.error(`[后端错误] ${line}`)
        try {
            if (window && !window.isDestroyed()) {
                window.webContents.send('backend-log', `[错误] ${line}`)
            }
        } catch (e) {
            // Ignore
        }
        
        if (logHistory.length >= MAX_LOGS) logHistory.shift()
        logHistory.push(`[错误] ${line}`)
        
        if (line.includes('Error') || line.includes('Exception') || line.includes('Traceback')) {
            try {
                if (window && !window.isDestroyed()) {
                    window.webContents.send('system-error', `后端错误: ${line}`)
                }
            } catch (e) {
                // Ignore
            }
        }
    })

    child.on('close', (code) => {
        console.log(`后端已退出，退出码: ${code}`)
        backendProcess = null
    })

    backendProcess = child
}

import treeKill from 'tree-kill'

export function stopBackend() {
    if (backendProcess) {
        console.log('Stopping Backend...')
        if (backendProcess.pid) {
             treeKill(backendProcess.pid, 'SIGKILL', (err) => {
                if (err) console.error('Error killing backend process tree:', err)
             })
        } else {
             backendProcess.kill()
        }
        backendProcess = null
    }
}
