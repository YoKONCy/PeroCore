import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 仅供双方兼容层使用；凭据不得进入页面、业务任务结果或日志。 */
export function arcaHostKey(directory: string): string {
  mkdirSync(directory, { recursive: true })
  const file = path.join(directory, 'host-bridge.key')
  try {
    writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const key = readFileSync(file, 'utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Arca 宿主桥接凭据损坏')
  return key
}

export function arcaHostAuthorized(value: unknown, key: string): boolean {
  return (
    typeof value === 'string' &&
    Buffer.byteLength(value) === Buffer.byteLength(key) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(key))
  )
}
