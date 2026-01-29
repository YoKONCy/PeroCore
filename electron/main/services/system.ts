import { ipcMain, app } from 'electron'
import si from 'systeminformation'
import fs from 'fs-extra'
import path from 'path'

export interface SystemStats {
    cpu_usage: number
    memory_used: number
    memory_total: number
}

// 缓存上一次的 CPU 负载，因为 systeminformation 获取 CPU 需要时间计算
let lastCpuLoad = 0

// 定期更新 CPU 负载 (每 2 秒)
setInterval(async () => {
    try {
        const load = await si.currentLoad()
        lastCpuLoad = load.currentLoad
    } catch (e) {
        // ignore
        // 忽略
    }
}, 2000)

export async function getSystemStats(): Promise<SystemStats> {
    try {
        const mem = await si.mem()
        return {
            cpu_usage: parseFloat(lastCpuLoad.toFixed(1)),
            memory_used: mem.active,
            memory_total: mem.total
        }
    } catch (e) {
        return { cpu_usage: 0, memory_used: 0, memory_total: 0 }
    }
}

export function getBackendLogs(): string[] {
    // Return empty for now (todo: implement log store)
    // 目前返回空 (待办: 实现日志存储)
    return []
}

export function getConfig(): any {
    const configPath = path.join(app.getPath('userData'), 'data/config.json')
    if (fs.existsSync(configPath)) {
        try {
            return fs.readJsonSync(configPath)
        } catch (e) { return {} }
    }
    return {}
}

export function saveConfig(config: any) {
    // Save configuration to file
    // 将配置保存到文件
    const dataDir = path.join(app.getPath('userData'), 'data')
    fs.ensureDirSync(dataDir)
    fs.writeJsonSync(path.join(dataDir, 'config.json'), config, { spaces: 2 })
}
