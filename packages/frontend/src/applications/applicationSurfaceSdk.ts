/**
 * applicationSurfaceSdk — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import type {
  ApplicationAdapterManifest,
  ApplicationSurfaceDeclaration,
  ApplicationSurfaceSlot,
} from '@infos/shared'

export interface ApplicationSurfaceRegistration {
  appId: string
  adapterVersion: string
  declaration: ApplicationSurfaceDeclaration
  load: () => Promise<unknown>
}

export class ApplicationSurfaceRegistry {
  private readonly surfaces = new Map<string, ApplicationSurfaceRegistration>()

  register(input: ApplicationSurfaceRegistration): () => void {
    const key = `${input.appId}:${input.declaration.surfaceId}`
    if (this.surfaces.has(key)) throw new Error(`APPLICATION_SURFACE_EXISTS: ${key}`)
    this.surfaces.set(key, Object.freeze(input))
    return () => this.surfaces.delete(key)
  }

  list(slot?: ApplicationSurfaceSlot): ApplicationSurfaceRegistration[] {
    return [...this.surfaces.values()].filter(
      (surface) => !slot || surface.declaration.slot === slot,
    )
  }
}

export function defineApplicationSurface(input: {
  manifest: ApplicationAdapterManifest
  surfaceId: string
  load: () => Promise<unknown>
}): ApplicationSurfaceRegistration {
  const declaration = input.manifest.frontend?.surfaces.find(
    (surface) => surface.surfaceId === input.surfaceId,
  )
  if (!declaration) throw new Error(`APPLICATION_SURFACE_UNDECLARED: ${input.surfaceId}`)
  return Object.freeze({
    appId: input.manifest.id,
    adapterVersion: input.manifest.adapterVersion,
    declaration,
    load: input.load,
  })
}

export const applicationSurfaceRegistry = new ApplicationSurfaceRegistry()
