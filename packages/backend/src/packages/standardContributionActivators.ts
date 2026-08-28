import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PackageContributionKind } from '@infos/shared'
import type { KernelEventBus } from '../kernel/kernelOutboxPublisher'
import type { CapabilityDirectory, CapabilityProviderInvoke } from '../kernel/capabilityDirectory'
import type { SkillLoader } from '../capabilities/skillLoader'
import type { ToolRegistry, ToolHandler } from '../services/agent/toolRegistry'
import type { PackageRuntime } from './packageRuntime'
import type { PackageProcessSupervisor } from './packageProcessSupervisor'
import type { PackageHookBus } from './packageHookBus'
import type { PackageActivationContext } from './types'
import type { PackageInterceptEvent, PackageInterceptor } from './packageInterceptor'

interface ToolModule {
  definition: import('../services/pipeline/types').ToolDefinition
  execute?: ToolHandler
  default?: ToolModule
}

interface SubscriberModule {
  onEvent?: Parameters<KernelEventBus['subscribe']>[0]
  hooks?: Record<string, PackageInterceptor>
  default?: SubscriberModule
}

interface ProviderModule {
  definition?: import('@infos/shared').KernelCapabilityDefinition
  offer?: import('@infos/shared').KernelCapabilityOffer
  invoke?: CapabilityProviderInvoke
  default?: ProviderModule
}

/** 注册无需内核特权的标准 Package Contribution 激活器。 */
export function registerStandardContributionActivators(input: {
  runtime: PackageRuntime
  tools: ToolRegistry
  skills: SkillLoader
  events: KernelEventBus
  processes: PackageProcessSupervisor
  hooks?: PackageHookBus
  capabilities?: CapabilityDirectory
  activateBuiltinProvider?: import('./types').ContributionActivator
}): void {
  input.runtime.registerActivator('tool', async (context) => {
    if (!context.contribution.entry) return
    const module = await loadModule<ToolModule>(context)
    const value = module.default ?? module
    const definition = value.definition ?? context.contribution.metadata?.definition
    if (!definition || typeof value.execute !== 'function') {
      throw new Error(`Tool Contribution 无有效定义或入口: ${context.contribution.id}`)
    }
    const execute = value.execute
    input.tools.register(
      definition as import('../services/pipeline/types').ToolDefinition,
      async (args, toolContext) => {
        const result = await execute(args, toolContext)
        if (typeof result === 'string') return result
        if (result && typeof result === 'object' && 'success' in result) {
          const legacy = result as { success: boolean; data?: unknown; error?: string }
          return JSON.stringify(
            legacy.success
              ? { success: true, data: legacy.data }
              : { error: legacy.error ?? '工具执行失败' },
          )
        }
        return result
      },
    )
    return () => {
      input.tools.unregister((definition as { name: string }).name)
    }
  })

  input.runtime.registerActivator('skill', (context) => {
    if (!context.rootDir) throw new Error(`Skill Contribution 缺少 Package 根目录`)
    const dir = path.resolve(context.rootDir, context.contribution.entry ?? 'skills')
    if (context.contribution.metadata?.optional && !existsSync(dir)) return
    input.skills.addDirs([dir])
    return () => input.skills.removeDirs([dir])
  })

  input.runtime.registerActivator('event-subscriber', async (context) => {
    const module = await loadModule<SubscriberModule>(context)
    const value = module.default ?? module
    if (value.hooks && input.hooks) {
      const removers = Object.entries(value.hooks).map(([event, handler]) =>
        input.hooks!.register(context.manifest.packageId, event as PackageInterceptEvent, handler),
      )
      return () => removers.reverse().forEach((remove) => remove())
    }
    if (typeof value.onEvent !== 'function') {
      throw new Error(`Event Subscriber 无 onEvent: ${context.contribution.id}`)
    }
    const unsubscribe = input.events.subscribe(value.onEvent)
    return () => {
      unsubscribe()
    }
  })

  input.runtime.registerActivator('service', async (context) => {
    if (!context.contribution.entry) return
    if (!context.rootDir) throw new Error(`Service Contribution 缺少 Package 根目录`)
    const processId = `${context.manifest.packageId}/${context.contribution.id}`
    await input.processes.start({
      processId,
      packageId: context.manifest.packageId,
      entry: context.contribution.entry,
      cwd: context.rootDir,
    })
    return () => input.processes.stop(processId)
  })

  input.runtime.registerActivator('capability-provider', async (context) => {
    if (!context.contribution.entry) {
      return input.activateBuiltinProvider?.(context)
    }
    if (!input.capabilities) return
    const module = await loadModule<ProviderModule>(context)
    const value = module.default ?? module
    if (!value.definition || !value.offer || !value.invoke) {
      throw new Error(`Capability Provider 入口不完整: ${context.contribution.id}`)
    }
    const removeDefinition = input.capabilities.registerDefinition(value.definition)
    try {
      const removeProvider = input.capabilities.registerProvider(value.offer, value.invoke)
      return async () => {
        removeProvider()
        removeDefinition()
      }
    } catch (error) {
      removeDefinition()
      throw error
    }
  })

  input.runtime.registerActivator('runtime-adapter', (context) => {
    throw new Error(`PACKAGE_CONTRIBUTION_UNSUPPORTED: runtime-adapter/${context.contribution.id}`)
  })

  const unsupportedKinds: PackageContributionKind[] = [
    'asset',
    'presenter',
    'application',
    'policy',
  ]
  for (const kind of unsupportedKinds) {
    input.runtime.registerActivator(kind, (context) => {
      throw new Error(`PACKAGE_CONTRIBUTION_UNSUPPORTED: ${kind}/${context.contribution.id}`)
    })
  }
}

async function loadModule<T>(context: PackageActivationContext): Promise<T> {
  if (context.manifest.trust !== 'official') {
    throw new Error(`PACKAGE_IN_PROCESS_CODE_FORBIDDEN: ${context.manifest.packageId}`)
  }
  if (!context.rootDir || !context.contribution.entry) {
    throw new Error(`Contribution 缺少入口: ${context.contribution.id}`)
  }
  return import(
    pathToFileURL(path.resolve(context.rootDir, context.contribution.entry)).href
  ) as Promise<T>
}
