import type { KernelExecutionDescriptor } from '@infos/shared'
import type { KernelScheduler } from '../kernel/kernelScheduler'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { PackageStdioTransport } from './transports/packageStdioTransport'
import type { PackageProcessTransport } from './transports/packageProcessTransport'

export interface PackageProcessSpec {
  processId: string
  packageId: string
  entry: string
  cwd: string
  env?: Record<string, string>
  maxRestarts?: number
}

export type PackageProcessState = 'stopped' | 'starting' | 'running' | 'failed'

interface ManagedProcess {
  spec: PackageProcessSpec
  process: ChildProcess | null
  transport: PackageProcessTransport | null
  state: PackageProcessState
  restarts: number
  stopping: boolean
  restartTimer?: ReturnType<typeof setTimeout>
}

/** Package Service Process 的结构化生命周期与 stdio Kernel Call 承载器。 */
export class PackageProcessSupervisor {
  private readonly processes = new Map<string, ManagedProcess>()

  constructor(private readonly scheduler?: KernelScheduler) {}

  async start(spec: PackageProcessSpec): Promise<void> {
    const current = this.processes.get(spec.processId)
    if (current?.state === 'running' || current?.state === 'starting') return
    const managed: ManagedProcess = current ?? {
      spec,
      process: null,
      transport: null,
      state: 'stopped',
      restarts: 0,
      stopping: false,
    }
    managed.spec = spec
    managed.stopping = false
    managed.state = 'starting'
    this.processes.set(spec.processId, managed)
    await this.spawn(managed)
  }

  async call(
    processId: string,
    operation: string,
    payload: unknown,
    parentExecution?: KernelExecutionDescriptor,
  ): Promise<unknown> {
    const managed = this.processes.get(processId)
    if (!managed?.transport?.isAlive()) throw new Error(`Package Process 不可用: ${processId}`)
    if (parentExecution || !this.scheduler) {
      return managed.transport.call(operation, payload, undefined, {
        executionId: parentExecution?.executionId,
        processId: parentExecution?.processId,
        correlationId: parentExecution?.executionId,
      })
    }
    let output: unknown
    const terminal = await this.scheduler.submitAndWait({
      principalId: managed.spec.packageId,
      taskId: `package-call:${processId}:${operation}`,
      class: 'background',
      priority: 4,
      resourceKey: `package-process:${processId}`,
      budget: { maxDurationMs: 5 * 60_000, maxConcurrentIo: 4 },
      run: async ({ descriptor }) => {
        output = await managed.transport!.call(operation, payload, undefined, {
          executionId: descriptor.executionId,
          processId: descriptor.processId,
          correlationId: descriptor.executionId,
        })
      },
    })
    if (terminal.state !== 'completed') throw new Error(`PACKAGE_EXECUTION_${terminal.state}`)
    return output
  }

  async stop(processId: string): Promise<void> {
    const managed = this.processes.get(processId)
    if (!managed) return
    managed.stopping = true
    if (managed.restartTimer) clearTimeout(managed.restartTimer)
    try {
      if (managed.transport?.isAlive()) {
        await managed.transport.call('__lifecycle__', { action: 'stop' }).catch(() => undefined)
      }
    } finally {
      managed.process?.kill('SIGTERM')
      managed.process = null
      managed.transport = null
      managed.state = 'stopped'
      this.processes.delete(processId)
    }
  }

  getState(processId: string): PackageProcessState | undefined {
    return this.processes.get(processId)?.state
  }

  private async spawn(managed: ManagedProcess): Promise<void> {
    const entry = path.resolve(managed.spec.cwd, managed.spec.entry)
    const child = spawn(process.execPath, [entry], {
      cwd: managed.spec.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...managed.spec.env,
        INFOS_PACKAGE_ID: managed.spec.packageId,
        INFOS_PROCESS_ID: managed.spec.processId,
      },
    })
    managed.process = child
    managed.transport = new PackageStdioTransport(child.stdin!, child.stdout!)
    child.on('exit', (code) => this.onExit(managed, code))
    await managed.transport.call('__lifecycle__', { action: 'start' })
    managed.state = 'running'
    managed.restarts = 0
  }

  private onExit(managed: ManagedProcess, code: number | null): void {
    managed.process = null
    managed.transport = null
    if (managed.stopping) {
      managed.state = 'stopped'
      return
    }
    managed.state = code === 0 ? 'stopped' : 'failed'
    const maxRestarts = managed.spec.maxRestarts ?? 3
    if (code !== 0 && managed.restarts < maxRestarts) {
      managed.restarts += 1
      managed.restartTimer = setTimeout(
        () => void this.spawn(managed).catch(() => (managed.state = 'failed')),
        Math.min(1_000 * 2 ** managed.restarts, 30_000),
      )
      managed.restartTimer.unref?.()
    }
  }
}
