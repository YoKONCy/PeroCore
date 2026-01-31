import { BrowserWindow, app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs-extra'

let gatewayProcess: ChildProcess | null = null
const logHistory: string[] = []
const MAX_LOGS = 1000

export function getGatewayLogs() {
    return [...logHistory]
}

export async function startGateway(window: BrowserWindow) {
    if (gatewayProcess) {
        return
    }

    let gatewayPath = ''
    const isWin = process.platform === 'win32'
    const execName = isWin ? 'gateway.exe' : 'gateway'
    
    if (app.isPackaged) {
        // Production: resources/bin/gateway(.exe)
        gatewayPath = path.join(process.resourcesPath, 'bin', execName)
    } else {
        // Development: ../PeroLink/gateway(.exe) or ../../PeroLink/gateway(.exe) or ./gateway/gateway.exe
        // process.cwd() is usually the project root (PeroCore-Electron)
        
        // Priority 1: ../PeroLink/gateway.exe (Original dev structure)
        const path1 = path.join(process.cwd(), '../PeroLink', execName)
        // Priority 2: ./gateway/gateway.exe (New integrated structure)
        const path2 = path.join(process.cwd(), 'gateway', execName)
        
        if (await fs.pathExists(path1)) {
            gatewayPath = path1
        } else if (await fs.pathExists(path2)) {
            gatewayPath = path2
        } else {
             gatewayPath = path1 // Default to first logic if neither found, will fail in check below
        }
    }

    // Check if gateway exists
    if (!(await fs.pathExists(gatewayPath))) {
        // Fallback for dev: try to find it in case cwd is different
        // Try multiple locations
        const altPaths = [
            path.join(__dirname, '../../../../PeroLink', execName),
            path.join(__dirname, '../../../../PeroCore-Electron/gateway', execName),
             path.join(process.cwd(), 'gateway', execName)
        ]
        
        let found = false
        for (const p of altPaths) {
            if (await fs.pathExists(p)) {
                gatewayPath = p
                found = true
                break
            }
        }
        
        if (!found) {
            const error = `Gateway 可执行文件未找到: ${gatewayPath}`
            console.error(error)
            try { if (!window.isDestroyed()) window.webContents.send('system-error', error) } catch(e){}
            throw new Error(error)
        }
    }

    console.log(`正在从以下路径启动 Gateway: ${gatewayPath}`)

    // Spawn Gateway
    gatewayProcess = spawn(gatewayPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        windowsHide: true
    })

    gatewayProcess.stdout?.on('data', (data) => {
        const line = data.toString().trim()
        console.log(`[网关] ${line}`)
        // Optional: send to frontend if needed
        // window.webContents.send('gateway-log', line)
        
        if (logHistory.length >= MAX_LOGS) logHistory.shift()
        logHistory.push(line)
    })

    gatewayProcess.stderr?.on('data', (data) => {
        const line = data.toString().trim()
        console.error(`[网关错误] ${line}`)
        
        if (logHistory.length >= MAX_LOGS) logHistory.shift()
        logHistory.push(`[错误] ${line}`)
    })

    gatewayProcess.on('close', (code) => {
        console.log(`Gateway 已退出，退出码: ${code}`)
        gatewayProcess = null
    })
    
    // Give it a moment to start
    return new Promise((resolve) => setTimeout(resolve, 500))
}

import treeKill from 'tree-kill'

export function stopGateway() {
    if (gatewayProcess) {
        console.log('Stopping Gateway...')
        if (gatewayProcess.pid) {
             treeKill(gatewayProcess.pid, 'SIGKILL', (err) => {
                if (err) console.error('Error killing gateway process tree:', err)
             })
        } else {
             gatewayProcess.kill()
        }
        gatewayProcess = null
    }
}


