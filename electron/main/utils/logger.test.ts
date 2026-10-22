import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createWriteStream: vi.fn() }))
vi.mock('node:fs', () => ({
  default: { existsSync: () => true, createWriteStream: mocks.createWriteStream },
}))
vi.mock('./env', () => ({ paths: { logs: '/隔离日志' } }))

afterEach(() => vi.restoreAllMocks())

describe('桌面日志降级', () => {
  it('异步权限错误不抛出未处理异常，后续日志继续输出到控制台', async () => {
    vi.resetModules()
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const stream = Object.assign(new EventEmitter(), {
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    })
    mocks.createWriteStream.mockReturnValue(stream)
    const { logger } = await import('./logger')
    logger.info('启动诊断', '第一次记录')
    expect(() =>
      stream.emit(
        'error',
        Object.assign(new Error('模拟日志权限不足'), {
          code: 'EACCES',
        }),
      ),
    ).not.toThrow()
    logger.info('启动诊断', '第二次记录')
    expect(stream.destroy).toHaveBeenCalledOnce()
    expect(stream.write).toHaveBeenCalledTimes(1)
    expect(output).toHaveBeenCalledTimes(2)
    logger.close()
  })
})
