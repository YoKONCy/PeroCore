import type { VectorSyncRepository } from '../../../repositories/vectorSync.repo'
import type { BackgroundScheduler } from '../../scheduler/backgroundScheduler'
import type { MemoryService } from '../memoryService'

interface MaintenanceServiceDeps {
  scheduler: BackgroundScheduler
  memoryService: MemoryService
  vectorSyncRepo: VectorSyncRepository
}

interface MaintenanceTaskDto {
  name: string
  running: boolean
  lastRunAt: string
  intervalDesc: string
  stats: unknown
}

interface MaintenanceStatusDto {
  schedulerRunning: boolean
  tasks: MaintenanceTaskDto[]
  memory: {
    totalMemories: number
    pendingSyncCount: number
  }
}

interface ReindexResultDto {
  agentId: string
  pendingCount: number
}

export class MaintenanceService {
  constructor(private deps: MaintenanceServiceDeps) {}

  async getStatus(): Promise<MaintenanceStatusDto> {
    const schedulerTasks = this.deps.scheduler.getStatus()
    const maintenanceTasks = schedulerTasks.filter(
      (t) => t.name.includes('scorer') || t.name.includes('diary') || t.name.includes('reflection'),
    )

    return {
      schedulerRunning: this.deps.scheduler.isStarted,
      tasks: maintenanceTasks.map((t) => ({
        name: t.name,
        running: t.running,
        lastRunAt: new Date(t.lastRunAt).toISOString(),
        intervalDesc: this.formatInterval(t.intervalMs),
        stats: t.stats,
      })),
      memory: {
        totalMemories: await this.getTotalMemories(),
        pendingSyncCount: await this.getPendingSyncCount(),
      },
    }
  }

  async getReindexStatus(agentId: string): Promise<ReindexResultDto> {
    return {
      agentId,
      pendingCount: await this.getPendingSyncCount(),
    }
  }

  private async getTotalMemories(): Promise<number> {
    try {
      const result = await this.deps.memoryService.list({ agentId: 'pero', page: 1, pageSize: 1 })
      return result.total
    } catch {
      return 0
    }
  }

  private async getPendingSyncCount(): Promise<number> {
    try {
      const pending = await this.deps.vectorSyncRepo.getPending(1)
      return pending.length
    } catch {
      return 0
    }
  }

  private formatInterval(ms: number): string {
    if (ms < 60_000) return `${Math.round(ms / 1000)}秒`
    if (ms < 3600_000) return `${Math.round(ms / 60_000)}分钟`
    return `${(ms / 3600_000).toFixed(1)}小时`
  }
}
