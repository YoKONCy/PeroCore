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
        // Development: ../PeroLink/gateway(.exe)
        // process.cwd() is usually the project root (PeroCore-Electron)
        gatewayPath = path.join(process.cwd(), '../PeroLink', execName)
    }

    // Check if gateway exists
    if (!(await fs.pathExists(gatewayPath))) {
        // Fallback for dev: try to find it in case cwd is different
        const altPath = path.join(__dirname, '../../../../PeroLink', execName)
        if (await fs.pathExists(altPath)) {
            gatewayPath = altPath
        } else {
            const error = `Gateway executable not found at: ${gatewayPath}`
            console.error(error)
            window.webContents.send('system-error', error)
            throw new Error(error)
        }
    }

    console.log(`Starting Gateway from: ${gatewayPath}`)

    // Spawn Gateway
    gatewayProcess = spawn(gatewayPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        windowsHide: true
    })

    gatewayProcess.stdout?.on('data', (data) => {
        const line = data.toString().trim()
        console.log(`[Gateway] ${line}`)
        // Optional: send to frontend if needed
        // window.webContents.send('gateway-log', line)
        
        if (logHistory.length >= MAX_LOGS) logHistory.shift()
        logHistory.push(line)
    })

    gatewayProcess.stderr?.on('data', (data) => {
        const line = data.toString().trim()
        console.error(`[Gateway Error] ${line}`)
        
        if (logHistory.length >= MAX_LOGS) logHistory.shift()
        logHistory.push(`[Error] ${line}`)
    })

    gatewayProcess.on('close', (code) => {
        console.log(`Gateway exited with code: ${code}`)
        gatewayProcess = null
    })
    
    // Give it a moment to start
    return new Promise((resolve) => setTimeout(resolve, 500))
}

export function stopGateway() {
    if (gatewayProcess) {
        console.log('Stopping Gateway...')
        gatewayProcess.kill()
        gatewayProcess = null
    }
}


