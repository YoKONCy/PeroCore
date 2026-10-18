import { describe, expect, it, vi } from 'vitest'
import { SocialAppRuntime } from '@infos/social/runtime'

describe('社交主人配置即时更新', () => {
  it('保存新主人时更新适配器并取消持有旧身份的会话，取消绑定同样生效', async () => {
    const runtime = new SocialAppRuntime()
    let ownerQq: string | undefined = '123456'
    const setOwnerQq = vi.fn()
    const closeSessionsExcept = vi.fn()
    Object.assign(runtime, {
      ownerQq: '654321',
      ctx: {
        configRepo: { get: vi.fn(async () => JSON.stringify({ ownerQq })) },
        logger: { info: vi.fn() },
      },
      napcatAdapter: { setOwnerQq },
      socialBridge: { closeSessionsExcept },
    })
    await runtime.onConfigChanged(['social'])
    expect(setOwnerQq).toHaveBeenLastCalledWith('123456')
    expect(closeSessionsExcept).toHaveBeenCalledOnce()
    expect(closeSessionsExcept.mock.calls[0]![0]({})).toBe(false)
    await runtime.onConfigChanged(['social'])
    expect(closeSessionsExcept).toHaveBeenCalledOnce()
    ownerQq = undefined
    await runtime.onConfigChanged(['social'])
    expect(setOwnerQq).toHaveBeenLastCalledWith(undefined)
    expect(closeSessionsExcept).toHaveBeenCalledTimes(2)
  })
})
