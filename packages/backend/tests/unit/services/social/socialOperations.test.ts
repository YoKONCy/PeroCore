import { describe, expect, it, vi } from 'vitest'
import {
  SocialOperations,
  unwrapNapcatResponse,
  type SocialOperationScope,
} from '@infos/social/runtime/socialOperations'
import type { NapcatAdapter } from '@infos/social/adapters/napcat'
import type { SocialStoragePort } from '@infos/shared'

const accountId = '123456789'
const scope: SocialOperationScope = {
  agentId: 'pero',
  accountId,
  channelId: '987654321',
  channelType: 'private',
  owner: true,
  callId: 'turn:call',
}
function fixture() {
  const values = new Map<string, string>()
  const callApi = vi.fn(async (action: string) => ({
    status: 'ok',
    retcode: 0,
    data:
      action === 'get_version_info'
        ? { app_version: '4.18.38' }
        : action === 'send_qzone_msg'
          ? { tid: 'post123' }
          : null,
  }))
  const adapter = {
    getConnectedAccountIds: () => [accountId, '234567890'],
    callApi,
    sendMessage: vi.fn(),
  } as unknown as NapcatAdapter
  const storage = { getByMsgId: vi.fn(async () => null) } as unknown as SocialStoragePort
  const service = new SocialOperations({
    adapter: () => adapter,
    active: () => true,
    config: {
      get: async (key) => values.get(key),
      set: async (key, value) => {
        values.set(key, value)
      },
    },
    storage,
    prepareImage: vi.fn(async () => 'base64://aW1hZ2U='),
  })
  return { service, callApi, values, storage }
}

describe('三个社交工具的账号与副作用边界', () => {
  it('未开启视觉时不展示读图操作，伪造调用也不会进入图片执行器', async () => {
    const { service } = fixture()
    const textOnly = { ...scope, enableVision: false }
    const definitions = await service.definitions(textOnly)
    expect(JSON.stringify(definitions)).not.toContain('image_read')
    const legacy = vi.fn()
    const result = JSON.parse(
      await service.execute(
        'social',
        {
          action: 'image_read',
          input: { message_ids: ['22'] },
        },
        textOnly,
        legacy,
      ),
    )
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('未开启视觉能力'),
    })
    expect(legacy).not.toHaveBeenCalled()
  })

  it('普通群友看不到账号写操作，也不能通过伪造参数执行', async () => {
    const { service, callApi } = fixture()
    const visitor = { ...scope, owner: false, channelType: 'group' as const }
    const definitions = await service.definitions(visitor)
    const account = definitions.find((tool) => tool.function.name === 'social_account')!
    expect(JSON.stringify(account)).not.toContain('qzone_publish')
    const result = JSON.parse(
      await service.execute(
        'social_account',
        { action: 'qzone_publish', input: { content: '测试', visibility: 'private' } },
        visitor,
      ),
    )
    expect(result.success).toBe(false)
    expect(callApi.mock.calls.some((call) => call[0] === 'send_qzone_msg')).toBe(false)
  })

  it('明确绑定所选账号，不借用默认连接', async () => {
    const { service, callApi } = fixture()
    await service.execute(
      'social',
      { action: 'contacts_list', account_id: '234567890', input: {} },
      scope,
    )
    expect(callApi).toHaveBeenCalledWith('get_friend_list', {}, 15000, '234567890', undefined)
  })

  it('拒绝未知字段和其他会话操作，不发送请求', async () => {
    const { service, callApi } = fixture()
    const visitor = { ...scope, owner: false, channelType: 'group' as const }
    expect(
      JSON.parse(
        await service.execute(
          'social_group',
          { action: 'info', input: { group_id: '111111111' } },
          visitor,
        ),
      ).success,
    ).toBe(false)
    expect(
      JSON.parse(
        await service.execute(
          'social_account',
          { action: 'profile_update', input: { nickname: '测试', arbitrary: true } },
          scope,
        ),
      ).success,
    ).toBe(false)
    expect(callApi).not.toHaveBeenCalled()
  })

  it('业务错误不能被正常的 OneBot 信封掩盖', () => {
    expect(() =>
      unwrapNapcatResponse({ status: 'ok', retcode: 0, data: { result: 7, errMsg: '没有权限' } }),
    ).toThrow('没有权限')
    expect(() =>
      unwrapNapcatResponse({
        status: 'ok',
        retcode: 0,
        data: { valid: false, message: '不是好友' },
      }),
    ).toThrow('不是好友')
    expect(() => unwrapNapcatResponse({ status: 'failed', retcode: 1400, data: null })).toThrow()
  })

  it('发布保存 tid 与可见范围，相同调用恢复时不会再发布', async () => {
    const { service, callApi } = fixture()
    const args = {
      action: 'qzone_publish',
      input: { content: '今天的创作', visibility: 'friends' },
    }
    const first = JSON.parse(await service.execute('social_account', args, scope))
    const again = JSON.parse(await service.execute('social_account', args, scope))
    expect(first).toMatchObject({ success: true, data: { tid: 'post123' } })
    expect(again.success).toBe(true)
    expect(callApi.mock.calls.filter((call) => call[0] === 'send_qzone_msg')).toHaveLength(1)
    expect(callApi).toHaveBeenCalledWith(
      'send_qzone_msg',
      { content: '今天的创作', images: [], ugc_right: 4 },
      120000,
      accountId,
      undefined,
    )
    const records = JSON.parse(
      await service.execute('social_account', { action: 'qzone_records', input: {} }, scope),
    )
    expect(records.data.posts[0]).toMatchObject({ tid: 'post123', visibility: 'friends' })
  })

  it('结果不明时阻止新调用重复提交，核验未发送后才允许再试', async () => {
    const { service, callApi } = fixture()
    callApi.mockImplementation(async (action) => {
      if (action === 'set_friend_remark') throw new Error('请求超时')
      return { status: 'ok', retcode: 0, data: null }
    })
    const args = { action: 'contact_remark', input: { user_id: '333333333', remark: '朋友' } }
    const first = JSON.parse(await service.execute('social', args, scope))
    const retry = JSON.parse(
      await service.execute('social', args, { ...scope, callId: 'another-call' }),
    )
    expect(first).toMatchObject({ success: false, uncertain: true })
    expect(retry.operation_id).toBe(first.operation_id)
    expect(callApi.mock.calls.filter((call) => call[0] === 'set_friend_remark')).toHaveLength(1)
    await service.execute(
      'social_account',
      {
        action: 'operation_resolve',
        input: { operation_id: first.operation_id, decision: 'not_sent' },
      },
      scope,
    )
    await service.execute('social', args, { ...scope, callId: 'confirmed-retry' })
    expect(callApi.mock.calls.filter((call) => call[0] === 'set_friend_remark')).toHaveLength(2)
  })

  it('关闭应用后拒绝继续操作', async () => {
    const { service, callApi } = fixture()
    service.close()
    expect(
      JSON.parse(await service.execute('social', { action: 'contacts_list', input: {} }, scope))
        .success,
    ).toBe(false)
    expect(callApi).not.toHaveBeenCalled()
  })
})
