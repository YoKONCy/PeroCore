/**
 * programmableSurfaceSandbox — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import type { ProgrammableIslandSurfaceProps } from '@infos/shared'

export type ProgrammableSurfaceMessage =
  | { protocol: 'infos.surface.v1'; sandboxId: string; type: 'ready' }
  | {
      protocol: 'infos.surface.v1'
      sandboxId: string
      type: 'render'
      payload: { html?: string; text?: string; height?: number }
    }
  | {
      protocol: 'infos.surface.v1'
      sandboxId: string
      type: 'input'
      payload: { action: string; value?: unknown }
    }
  | {
      protocol: 'infos.surface.v1'
      sandboxId: string
      type: 'error'
      payload: { message: string }
    }

export interface PreparedProgrammableSandbox {
  sandboxId: string
  srcdoc: string
  permissions: readonly string[]
}

export type ProgrammableSurfaceSourceResolver = (sourceBlobId: string) => Promise<Uint8Array>

/** Host受控源码Resolver注册表；Package脚本不能自行提供Resolver。 */
export class ProgrammableSurfaceSourceRegistry {
  private resolver?: ProgrammableSurfaceSourceResolver

  register(resolver: ProgrammableSurfaceSourceResolver): () => void {
    if (this.resolver) throw new Error('PROGRAMMABLE_SURFACE_RESOLVER_DUPLICATE')
    this.resolver = resolver
    return () => {
      if (this.resolver === resolver) this.resolver = undefined
    }
  }

  async resolve(sourceBlobId: string): Promise<Uint8Array> {
    if (!this.resolver) throw new Error('PROGRAMMABLE_SURFACE_SOURCE_UNAVAILABLE')
    return this.resolver(sourceBlobId)
  }
}

export const programmableSurfaceSources = new ProgrammableSurfaceSourceRegistry()

export async function prepareProgrammableSandbox(
  props: ProgrammableIslandSurfaceProps,
  source: Uint8Array,
): Promise<PreparedProgrammableSandbox> {
  validateDescriptor(props)
  const actualHash = await sha256(source)
  const blobHash = props.sourceBlobId.slice('sha256:'.length).toLowerCase()
  if (actualHash !== props.sourceHash.toLowerCase() || actualHash !== blobHash) {
    throw new Error('PROGRAMMABLE_SURFACE_INTEGRITY_FAILED')
  }
  const code = new TextDecoder('utf-8', { fatal: true }).decode(source)
  if (code.length > 2_000_000) throw new Error('PROGRAMMABLE_SURFACE_SOURCE_TOO_LARGE')
  return {
    sandboxId: props.sandboxId,
    permissions: Object.freeze([...props.permissions]),
    srcdoc: sandboxDocument(props, code),
  }
}

export function parseProgrammableSurfaceMessage(
  value: unknown,
  sandboxId: string,
): ProgrammableSurfaceMessage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const message = value as Record<string, unknown>
  if (message.protocol !== 'infos.surface.v1' || message.sandboxId !== sandboxId) return undefined
  if (!['ready', 'render', 'input', 'error'].includes(String(message.type))) return undefined
  const serialized = JSON.stringify(value)
  if (serialized.length > 256_000) return undefined
  return value as ProgrammableSurfaceMessage
}

function validateDescriptor(props: ProgrammableIslandSurfaceProps): void {
  if (!['iframe', 'worker', 'wasm'].includes(props.runtime)) {
    throw new Error('PROGRAMMABLE_SURFACE_RUNTIME_INVALID')
  }
  if (!props.sourceBlobId.startsWith('sha256:') || !/^[a-f0-9]{64}$/i.test(props.sourceHash)) {
    throw new Error('PROGRAMMABLE_SURFACE_SOURCE_INVALID')
  }
  if (props.sourceBlobId.slice(7).toLowerCase() !== props.sourceHash.toLowerCase()) {
    throw new Error('PROGRAMMABLE_SURFACE_SOURCE_MISMATCH')
  }
  if (props.network !== 'none') throw new Error('PROGRAMMABLE_SURFACE_NETWORK_DENIED')
  const allowed = new Set(['render', 'input', 'storage'])
  if (props.permissions.some((permission) => !allowed.has(permission))) {
    throw new Error('PROGRAMMABLE_SURFACE_PERMISSION_DENIED')
  }
  if (!props.sandboxId.trim() || !props.entrypoint.trim()) {
    throw new Error('PROGRAMMABLE_SURFACE_DESCRIPTOR_INVALID')
  }
}

function sandboxDocument(props: ProgrammableIslandSurfaceProps, code: string): string {
  const safeCode = code.replaceAll('</script', '<\\/script')
  const config = JSON.stringify({
    protocol: 'infos.surface.v1',
    sandboxId: props.sandboxId,
    permissions: props.permissions,
    entrypoint: props.entrypoint,
  }).replaceAll('<', '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; media-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; navigate-to 'none'"><style>html,body,#surface-root{margin:0;min-height:1px;overflow:hidden}</style></head><body><div id="surface-root"></div><script>"use strict";const __INFOS__=${config};const __send=(type,payload)=>parent.postMessage({protocol:__INFOS__.protocol,sandboxId:__INFOS__.sandboxId,type,payload},"*");Object.freeze(__INFOS__);Object.defineProperty(globalThis,"infosSurface",{value:Object.freeze({config:__INFOS__,send:__send,root:document.getElementById("surface-root")}),writable:false,configurable:false});try{${safeCode}\n;__send("ready")}catch(error){__send("error",{message:String(error&&error.message||error)})}</script></body></html>`
}

async function sha256(value: Uint8Array): Promise<string> {
  const isolated = new Uint8Array(value.byteLength)
  isolated.set(value)
  const digest = await crypto.subtle.digest('SHA-256', isolated.buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
