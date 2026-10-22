import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  acquireDaemonLease,
  DaemonAlreadyRunningError,
  retryStartupIo,
  verifyDataDirectory,
} from '@infos/backend/lib/startupStorage'

let root = ''
beforeEach(() => {
  root = mkdtempSync(path.join(process.env.INFOS_TEST_TEMP_ROOT!, 'startup-storage-'))
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

describe('后端启动存储保护', () => {
  it('同一数据目录只允许一个后端，关闭连接后可以重新取得实例锁', async () => {
    const data = path.join(root, 'data')
    const first = await acquireDaemonLease(data)
    try {
      await expect(acquireDaemonLease(path.join(data, '..', 'data'))).rejects.toBeInstanceOf(
        DaemonAlreadyRunningError,
      )
    } finally {
      first.release()
    }
    const next = await acquireDaemonLease(data)
    next.release()
    next.release()
  })

  it('不同数据目录不会互相争用实例锁', async () => {
    const first = await acquireDaemonLease(path.join(root, 'first'))
    try {
      const second = await acquireDaemonLease(path.join(root, 'second'))
      second.release()
    } finally {
      first.release()
    }
  })

  it('权限检查只使用独占临时目录并保留已有用户文件', async () => {
    const data = path.join(root, 'data')
    mkdirSync(data)
    writeFileSync(path.join(data, '用户文件.txt'), '保留用户内容')
    await verifyDataDirectory(data)
    expect(readFileSync(path.join(data, '用户文件.txt'), 'utf8')).toBe('保留用户内容')
    expect(readdirSync(data)).toEqual(['用户文件.txt'])
  })

  it('短暂占用可恢复，超过次数后保留原始错误', async () => {
    vi.useFakeTimers()
    const busy = Object.assign(new Error('模拟文件短暂占用'), { code: 'EBUSY' })
    const operation = vi.fn().mockRejectedValueOnce(busy).mockResolvedValue('已恢复')
    const pending = retryStartupIo(operation)
    await vi.runAllTimersAsync()
    expect(await pending).toBe('已恢复')
    expect(operation).toHaveBeenCalledTimes(2)

    const denied = Object.assign(new Error('模拟持续权限错误'), { code: 'EACCES' })
    const failing = vi.fn().mockRejectedValue(denied)
    const assertion = expect(retryStartupIo(failing)).rejects.toBe(denied)
    await vi.runAllTimersAsync()
    await assertion
    expect(failing).toHaveBeenCalledTimes(5)
  })

  it('磁盘满不重复写入，不把永久错误当成临时占用', async () => {
    const full = Object.assign(new Error('模拟磁盘已满'), { code: 'ENOSPC' })
    const operation = vi.fn().mockRejectedValue(full)
    await expect(retryStartupIo(operation)).rejects.toBe(full)
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
