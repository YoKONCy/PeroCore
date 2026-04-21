/**
 * 系统信息监控服务 (v2)
 *
 * 提供 CPU/内存使用率查询。
 * 使用 Node.js 内置 os 模块 (零依赖)。
 *
 * @platform ELECTRON
 * @module electron/main/services/system
 */

import os from 'node:os'
import { logger } from '../utils/logger'

export interface SystemStats {
  cpuUsage: number
  memoryUsed: number
  memoryTotal: number
  platform: string
  uptime: number
}

// ── CPU 使用率缓存 ──

let lastCpuInfo: os.CpuInfo[] = os.cpus()
let cachedCpuUsage = 0
let monitorTimer: ReturnType<typeof setInterval> | null = null

/** 计算 CPU 使用率 (两次采样之间的差值) */
function calculateCpuUsage(): number {
  const currentCpus = os.cpus()
  let totalIdle = 0
  let totalTick = 0

  for (let i = 0; i < currentCpus.length; i++) {
    const prev = lastCpuInfo[i]
    const curr = currentCpus[i]
    if (!prev || !curr) continue

    const prevTotal = Object.values(prev.times).reduce((a, b) => a + b, 0)
    const currTotal = Object.values(curr.times).reduce((a, b) => a + b, 0)

    totalIdle += curr.times.idle - prev.times.idle
    totalTick += currTotal - prevTotal
  }

  lastCpuInfo = currentCpus

  if (totalTick === 0) return 0
  return Math.round((1 - totalIdle / totalTick) * 1000) / 10
}

/** 启动 CPU 监控 (5 秒采样) */
export function startSystemMonitor(): void {
  if (monitorTimer) return
  monitorTimer = setInterval(() => {
    cachedCpuUsage = calculateCpuUsage()
  }, 5000)
  // 首次采样
  cachedCpuUsage = calculateCpuUsage()
  logger.info('System', '系统监控已启动')
}

/** 停止系统监控 */
export function stopSystemMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = null
  }
}

/** 获取当前系统状态 */
export function getSystemStats(): SystemStats {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()

  return {
    cpuUsage: cachedCpuUsage,
    memoryUsed: totalMem - freeMem,
    memoryTotal: totalMem,
    platform: process.platform,
    uptime: os.uptime(),
  }
}
