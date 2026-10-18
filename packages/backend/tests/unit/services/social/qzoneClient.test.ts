import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseQzoneResponse, QzoneClient } from '@infos/social/adapters/napcat/qzoneClient'

describe('空间扩展的凭据和响应处理', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('只解析 JSON 或 JSONP 数据，不执行脚本', () => {
    expect(parseQzoneResponse('_preloadCallback({"code":0,"msglist":[]});')).toMatchObject({
      code: 0,
    })
    expect(() => parseQzoneResponse('_preloadCallback((globalThis.attacked=true));')).toThrow()
    expect(() => parseQzoneResponse('<html>请登录</html>')).toThrow()
  })

  it('账号不一致时不访问空间网络', async () => {
    const network = vi.fn()
    vi.stubGlobal('fetch', network)
    const client = new QzoneClient()
    await expect(
      client.execute('123456789', 'qzone_list', {}, async () => ({ user_id: '999999999' })),
    ).rejects.toThrow('不一致')
    expect(network).not.toHaveBeenCalled()
  })

  it('返回结构化内容和账号绑定的引用，凭据不进入结果', async () => {
    const network = vi.fn(
      async () =>
        new Response(
          '_preloadCallback({"code":0,"msglist":[{"tid":"post123","uin":"333333333","content":"朋友的近况"}]});',
        ),
    )
    vi.stubGlobal('fetch', network)
    const invoke = async (action: string) =>
      action === 'get_login_info'
        ? { user_id: '123456789' }
        : { cookies: 'p_uin=o123456789; p_skey=secret; skey=other' }
    const client = new QzoneClient()
    const output = (await client.execute('123456789', 'qzone_list', {}, invoke)) as {
      posts: Array<{ post_id: string }>
    }
    expect(output.posts[0]?.post_id).toMatch(/^qz_/)
    expect(JSON.stringify(output)).not.toContain('secret')
    await expect(
      client.execute('234567890', 'qzone_like', { post_id: output.posts[0]!.post_id }, invoke),
    ).rejects.toThrow('过期')
    expect(network).toHaveBeenCalledTimes(1)
  })

  it('空间业务错误不会被当作空列表', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"code":-3000,"message":"请重新登录"}')),
    )
    const invoke = async (action: string) =>
      action === 'get_login_info'
        ? { user_id: '123456789' }
        : { cookies: 'p_uin=o123456789; p_skey=secret' }
    await expect(new QzoneClient().execute('123456789', 'qzone_list', {}, invoke)).rejects.toThrow(
      '请重新登录',
    )
  })
})
