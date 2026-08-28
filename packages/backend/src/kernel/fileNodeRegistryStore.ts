import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { KernelNodeDescriptor, KernelNodeId } from '@infos/shared'

interface NodeRegistryFile {
  version: 1
  nodes: KernelNodeDescriptor[]
  generations: Record<string, number>
}

/** 持久Node身份与连接Generation；Session/Lease绝不跨重启伪装在线。 */
export class FileNodeRegistryStore {
  constructor(private readonly filePath: string) {}

  load(): { nodes: KernelNodeDescriptor[]; generations: Map<KernelNodeId, number> } {
    if (!existsSync(this.filePath)) return { nodes: [], generations: new Map() }
    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as NodeRegistryFile
    if (parsed.version !== 1 || !Array.isArray(parsed.nodes))
      throw new Error('NODE_REGISTRY_FILE_INVALID')
    return {
      nodes: parsed.nodes,
      generations: new Map(
        Object.entries(parsed.generations ?? {}).map(([nodeId, generation]) => [
          nodeId as KernelNodeId,
          generation,
        ]),
      ),
    }
  }

  save(nodes: KernelNodeDescriptor[], generations: Map<KernelNodeId, number>): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true })
    const value: NodeRegistryFile = {
      version: 1,
      nodes,
      generations: Object.fromEntries(generations),
    }
    writeFileSync(this.filePath, JSON.stringify(value, null, 2), { mode: 0o600 })
  }
}
