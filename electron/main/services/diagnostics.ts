import { app } from 'electron'
import path from 'path'
import fs from 'fs-extra'
import { spawn, execSync } from 'child_process'
import winreg from 'winreg'
import which from 'which'
import { checkNapCatInstalled } from './napcat.js'

export interface DiagnosticReport {
    python_exists: boolean
    python_path: string
    python_version: string
    script_exists: boolean
    script_path: string
    port_9120_free: boolean
    data_dir_writable: boolean
    data_dir: string
    core_available: boolean
    vc_redist_installed: boolean
    napcat_installed: boolean
    webview2_installed: boolean // Less relevant for Electron but kept for compatibility // 对 Electron 关联性较小，但为了兼容性保留
    node_exists: boolean
    node_path: string
    node_version: string
    errors: string[]
}

const isDev = !app.isPackaged
const workspaceRoot = isDev 
    ? path.resolve(__dirname, '../../..') // dist-electron/main -> electron -> root
    : path.dirname(app.getPath('exe'))

// Normalize path
// 规范化路径
function fixPath(p: string): string {
    return path.normalize(p)
}

function getResourceDir(): string {
    return isDev ? workspaceRoot : process.resourcesPath
}

export async function getDiagnostics(): Promise<DiagnosticReport> {
    const errors: string[] = []
    const resourceDir = getResourceDir()
    
    console.log(`[诊断] 工作区: ${workspaceRoot}`)
    console.log(`[诊断] 资源目录: ${resourceDir}`)

    // 1. Python Path
    // 1. Python 路径
    let pythonPath = ''
    let pythonExists = false
    let devVenvPythonExists = false
    
    // Check Dev Venv
    // 检查开发环境虚拟环境
    const devVenvPython = path.join(workspaceRoot, 'backend/venv/Scripts/python.exe')
    if (await fs.pathExists(devVenvPython)) {
        devVenvPythonExists = true
        pythonPath = devVenvPython
        pythonExists = true
    } else {
        // Check Release resources (multiple locations)
        // 检查发布资源（多个位置）
        const trials = [
            path.join(resourceDir, 'python/python.exe'),
            path.join(resourceDir, '_up_/python/python.exe'),
            path.join(resourceDir, 'src-tauri/python/python.exe'), // Legacy
        ]

        for (const trial of trials) {
            if (await fs.pathExists(trial)) {
                pythonPath = trial
                pythonExists = true
                break
            }
        }
    }

    // Fallback: System Python
    // 后备方案: 系统 Python
    if (!pythonExists) {
        try {
            const systemPython = await which('python')
            if (systemPython) {
                pythonPath = systemPython
                pythonExists = true
            }
        } catch (e) {
             try {
                const systemPython3 = await which('python3')
                if (systemPython3) {
                    pythonPath = systemPython3
                    pythonExists = true
                }
            } catch (e2) {}
        }
    }

    pythonPath = fixPath(pythonPath)

    // Check Python Version & Core
    // 检查 Python 版本和核心
    let pythonVersion = 'Unknown'
    let coreAvailable = false
    
    if (pythonExists) {
        console.log(`[Diagnostics] Python found at: ${pythonPath}`)
        try {
            const versionOutput = execSync(`"${pythonPath}" --version`, { encoding: 'utf8', stdio: 'pipe' }).trim()
            pythonVersion = versionOutput
            console.log(`[Diagnostics] Python Version: ${pythonVersion}`)
        } catch (e: any) {
            console.error(`[Diagnostics] Python version check failed: ${e.message}`)
            errors.push('Python 解释器无法运行，可能缺少系统组件 (如 VCRUNTIME140.dll)')
        }

        try {
            const coreCheck = execSync(`"${pythonPath}" -c "import pero_memory_core; print('OK')"`, { encoding: 'utf8', stdio: 'pipe' }).trim()
            if (coreCheck.includes('OK')) {
                coreAvailable = true
            } else {
                console.warn(`[Diagnostics] pero_memory_core import failed: output did not contain OK`)
                // errors.push('关键核心组件 pero_memory_core 未找到，记忆功能将受限') // Don't block startup // 不阻塞启动 // 不阻塞启动
            }
        } catch (e: any) {
             console.warn(`[Diagnostics] pero_memory_core check failed: ${e.message}`)
            // errors.push('关键核心组件 pero_memory_core 未找到，记忆功能将受限') // Don't block startup
        }
    } else {
        console.error(`[Diagnostics] No Python found.`)
        errors.push(`Python 解释器未找到。探测路径: ${pythonPath}`)
    }

    // 2. Script Path
    // 2. 脚本路径
    let scriptPath = ''
    const scriptTrials = [
        path.join(workspaceRoot, 'backend/main.py'),
        path.join(resourceDir, 'backend/main.py'),
        path.join(resourceDir, 'main.py'),
        path.join(resourceDir, '_up_/backend/main.py'),
    ]

    for (const trial of scriptTrials) {
        if (await fs.pathExists(trial)) {
            scriptPath = trial
            break
        }
    }
    scriptPath = fixPath(scriptPath)
    const scriptExists = await fs.pathExists(scriptPath)
    if (!scriptExists) {
        errors.push(`后端主脚本未找到: ${scriptPath}`)
    }

    // 3. Port 9120 Check
    // In Node, we can try to start a server or use net.connect. 
    // Simple check: try to connect, if successful then port is taken.
    // 3. 检查端口 9120
    // 在 Node 中，我们可以尝试启动服务器或使用 net.connect。
    // 简单检查：尝试连接，如果成功则端口被占用。
    const port9120Free = await checkPortFree(9120)
    if (!port9120Free) {
        errors.push('端口 9120 已被占用，请检查是否有其他 PeroCore 实例在运行')
    }

    // 4. Data Dir
    // 4. 数据目录
    let dataDir = ''
    if (!devVenvPythonExists) {
        dataDir = path.join(app.getPath('userData'), 'data')
    } else {
        dataDir = path.join(workspaceRoot, 'backend/data')
    }
    dataDir = fixPath(dataDir)
    await fs.ensureDir(dataDir)
    
    let dataDirWritable = false
    try {
        const testFile = path.join(dataDir, '.write_test')
        await fs.writeFile(testFile, '')
        await fs.remove(testFile)
        dataDirWritable = true
    } catch (e) {
        errors.push(`数据目录不可写: ${dataDir}`)
    }

    // 5. VC++ Redist
    // Check C:\Windows\System32\vcruntime140.dll
    // 5. VC++ Redist
    // 检查 C:\Windows\System32\vcruntime140.dll
    const systemRoot = process.env.SystemRoot || 'C:\\Windows'
    const vcRuntime = path.join(systemRoot, 'System32/vcruntime140.dll')
    const sysWow64 = path.join(systemRoot, 'SysWOW64/vcruntime140.dll')
    let vcRedistInstalled = (await fs.pathExists(vcRuntime)) || (await fs.pathExists(sysWow64))
    
    if (!vcRedistInstalled) {
        errors.push('关键系统组件缺失: VCRUNTIME140.dll (Visual C++ Redistributable)。这会导致 Python 无法启动。')
    }

    // 6. Node.js Check
    // 6. 检查 Node.js
    let nodePath = ''
    let nodeExists = false
    let nodeVersion = 'Unknown'

    // NapCat usually bundles node, or we look for system node
    // Note: NapCat logic will be separate, but here we check generic node availability
    // NapCat 通常捆绑了 node，或者我们查找系统 node
    // 注意：NapCat 逻辑将是分开的，但这里我们检查通用的 node 可用性
    const nodeTrials = [
        path.join(resourceDir, 'nodejs/node.exe'),
        path.join(resourceDir, 'bin/node.exe'),
        path.join(resourceDir, 'node.exe'),
    ]
    
    for (const trial of nodeTrials) {
        if (await fs.pathExists(trial)) {
            nodePath = trial
            nodeExists = true
            break
        }
    }

    if (!nodeExists) {
        try {
            nodePath = await which('node')
            nodeExists = true
        } catch (e) {
            // Not found in path
            // 在路径中未找到
        }
    }

    if (nodeExists) {
        try {
            nodeVersion = execSync(`"${nodePath}" --version`, { encoding: 'utf8' }).trim()
        } catch (e) {}
    }

    // Check NapCat
    // 检查 NapCat
    let napcatInstalled = false
    try {
        napcatInstalled = checkNapCatInstalled()
        console.log(`[Diagnostics] checkNapCatInstalled result: ${napcatInstalled}`)
    } catch (e) {
        console.error(`[Diagnostics] checkNapCatInstalled error: ${e}`)
    }

    return {
        python_exists: pythonExists,
        python_path: pythonPath,
        python_version: pythonVersion,
        script_exists: scriptExists,
        script_path: scriptPath,
        port_9120_free: port9120Free,
        data_dir_writable: dataDirWritable,
        data_dir: dataDir,
        core_available: coreAvailable,
        vc_redist_installed: vcRedistInstalled,
        napcat_installed: napcatInstalled,
        webview2_installed: true, // Electron bundles Chromium
        node_exists: nodeExists,
        node_path: nodePath,
        node_version: nodeVersion,
        errors
    }
}

import net from 'net'
function checkPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer()
        server.once('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
                resolve(false)
            } else {
                resolve(true) // Other errors considered free
            }
        })
        server.once('listening', () => {
            server.close()
            resolve(true)
        })
        server.listen(port)
    })
}
