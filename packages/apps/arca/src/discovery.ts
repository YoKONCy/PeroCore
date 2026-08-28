/**
 * discovery — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ApplicationDiscoveryRecord } from '@infos/shared'
import { validateApplicationDiscovery } from '@infos/node-sdk'

export type ArcaDiscoveryRecord = ApplicationDiscoveryRecord

export class ArcaDiscoveryStore {
  constructor(readonly filePath: string) {}

  read(): ArcaDiscoveryRecord | undefined {
    if (!existsSync(this.filePath)) return undefined
    return validateApplicationDiscovery(
      JSON.parse(readFileSync(this.filePath, 'utf8')) as ArcaDiscoveryRecord,
    )
  }

  publish(
    input: Omit<ArcaDiscoveryRecord, 'protocolVersion' | 'applicationProtocolVersion'>,
  ): ArcaDiscoveryRecord {
    const record = validateApplicationDiscovery({
      protocolVersion: 1,
      applicationProtocolVersion: 1,
      ...input,
    })
    mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 })
      renameSync(temporary, this.filePath)
    } finally {
      rmSync(temporary, { force: true })
    }
    return record
  }

  removeIfOwned(instanceId: string, generation: number): void {
    const current = this.read()
    if (current?.application.instanceId !== instanceId || current.generation !== generation) return
    rmSync(this.filePath, { force: true })
  }
}
