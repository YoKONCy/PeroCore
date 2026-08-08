/**
 * CapabilityGate 共享持有器
 *
 * 第六阶段 #7: run_script 等需要在 ToolExecutor 之外访问 CapabilityGate
 * 的工具（如校验 cwd 落在 ResourceScope 内）通过此持有器获取实例。
 *
 * container.ts 启动时调用 setCapabilityGate 注入实例，
 * 各工具通过 getCapabilityGate 获取（未注入时返回 null，工具应优雅降级）。
 *
 * @module packages/backend/src/tools/capabilityGateHolder
 */

import type { CapabilityGate } from '../capabilities/capabilityGate'
import { createLogger } from '../lib/logger'

const logger = createLogger('CapabilityGateHolder')

/** CapabilityGate 实例（由 container.ts 通过 setCapabilityGate 注入） */
let capabilityGate: CapabilityGate | null = null

/**
 * 注入 CapabilityGate
 *
 * 在 container.ts 启动时调用一次。
 */
export function setCapabilityGate(gate: CapabilityGate): void {
  capabilityGate = gate
  logger.info('CapabilityGate 已注入 (共享持有器)')
}

/** 获取 CapabilityGate，未注入时返回 null */
export function getCapabilityGate(): CapabilityGate | null {
  return capabilityGate
}
