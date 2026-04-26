/**
 * State Enricher — Agent 状态 + 时间 + 环境信息注入
 *
 * 读取 PetState + 时间信息 + 系统环境注入 EnrichedContext。
 *
 * 统一宠物状态 + 时间感知增强。
 * 支持跨平台环境信息注入 (OS/hostname/arch/runtime)。
 *
 * @module packages/backend/src/services/pipeline/enrichers/stateEnricher
 */

import { hostname, platform, arch, release, uptime, totalmem } from 'node:os'
import type { Enricher, EnrichmentInput, EnrichedContext } from '../types'
import type { ConfigRepository } from '../../../repositories/config.repo'

// ─────────────────────────────────────────────
// 环境信息 (启动时采集一次，不随请求变化)
// ─────────────────────────────────────────────

/** 平台名称映射 (更可读) */
const PLATFORM_NAMES: Record<string, string> = {
  win32: 'Windows',
  linux: 'Linux',
  darwin: 'macOS',
  freebsd: 'FreeBSD',
}

/** 运行时检测 */
function detectRuntime(): string {
  // 安全检测 Bun 运行时 (避免 TS 类型错误)
  const g = globalThis as Record<string, unknown>
  if (g.Bun && typeof g.Bun === 'object' && 'version' in (g.Bun as object)) {
    return `Bun ${(g.Bun as { version: string }).version}`
  }
  return `Node.js ${process.version}`
}

/** 内存格式化 */
function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024)
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

/** 运行模式检测 */
function detectDeployMode(): string {
  if (process.env.PERO_DOCKER) return 'Docker 容器'
  if (process.env.ELECTRON_RUN_AS_NODE || process.versions.electron) return 'Electron 桌面'
  return '独立进程'
}

/** 采集静态环境信息 (仅在模块加载时执行一次) */
function collectEnvironmentInfo(): string {
  const os = PLATFORM_NAMES[platform()] ?? platform()
  const osVersion = release()
  const cpuArch = arch()
  const runtime = detectRuntime()
  const totalMemory = formatBytes(totalmem())
  const deployMode = detectDeployMode()

  const parts = [
    `操作系统: ${os} ${osVersion} (${cpuArch})`,
    `主机名: ${hostname()}`,
    `运行时: ${runtime}`,
    `总内存: ${totalMemory}`,
    `部署模式: ${deployMode}`,
  ]

  return parts.join('\n')
}

/** 缓存的静态环境信息 */
const STATIC_ENV_INFO = collectEnvironmentInfo()

// ─────────────────────────────────────────────
// Enricher
// ─────────────────────────────────────────────

export class StateEnricher implements Enricher {
  readonly name = 'StateEnricher'

  constructor(private configRepo: ConfigRepository) {}

  async enrich(input: EnrichmentInput): Promise<Partial<EnrichedContext>> {
    const { agentId } = input

    // 当前时间 (中文友好格式)
    const now = new Date()
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    const weekday = weekdays[now.getDay()] ?? '?'
    const currentTime =
      `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ` +
      `星期${weekday} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`

    // 从 ConfigRepo 读取 Agent 状态 (PetState)
    const mood = (await this.configRepo.get(`agent.${agentId}.mood`)) ?? 'happy'
    const vibe = (await this.configRepo.get(`agent.${agentId}.vibe`)) ?? 'active'
    const mind = (await this.configRepo.get(`agent.${agentId}.mind`)) ?? '...'
    const ownerName = (await this.configRepo.get('owner.name')) ?? '主人'
    const userPersona = (await this.configRepo.get('owner.persona')) ?? ''

    // 环境信息 = 静态部分 + 动态运行时长
    const uptimeHours = (uptime() / 3600).toFixed(1)
    const environmentInfo = `${STATIC_ENV_INFO}\n系统运行时长: ${uptimeHours} 小时`

    return {
      currentTime,
      mood,
      vibe,
      mind,
      ownerName,
      userPersona,
      environmentInfo,
    }
  }
}
