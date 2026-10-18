import { createHash } from 'node:crypto'

type Invoke = (action: string, input: Record<string, unknown>) => Promise<unknown>
interface PostReference {
  accountId: string
  userId: string
  tid: string
  curkey: string
  unikey: string
  expiresAt: number
}
const BASE = 'https://user.qzone.qq.com/proxy/domain/'
const ENDPOINTS = {
  list: 'taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6',
  detail: 'taotao.qq.com/cgi-bin/emotion_cgi_msgdetail_v6',
  feed: 'ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more',
  like: 'w.qzone.qq.com/cgi-bin/likes/internal_dolike_app',
  comment: 'taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds',
  repost: 'taotao.qzone.qq.com/cgi-bin/emotion_cgi_forward_v6',
} as const
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const cleanText = (value: unknown) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .slice(0, 10000)

/** 只剥除固定 JSONP 包装，绝不执行空间返回的 JavaScript。 */
export function parseQzoneResponse(raw: string): Record<string, unknown> {
  const text = raw.trim().replace(/^\uFEFF/, '')
  const json = text.startsWith('{') ? text : text.match(/^[\w.$]+\s*\(\s*([\s\S]*)\s*\)\s*;?$/)?.[1]
  if (!json) throw new Error('空间响应格式异常或登录已失效')
  try {
    return record(JSON.parse(json))
  } catch {
    throw new Error('空间响应不是有效的 JSON 数据')
  }
}

/** 空间扩展使用 NapCat 当前账号的临时凭据，凭据不落盘、不返回给模型。 */
export class QzoneClient {
  private references = new Map<string, PostReference>()

  clear(): void {
    this.references.clear()
  }

  private reference(
    accountId: string,
    userId: string,
    tid: string,
    extra: Partial<PostReference> = {},
  ) {
    if (!/^[1-9]\d{4,19}$/.test(userId) || !tid || tid.length > 200) return undefined
    for (const [key, item] of this.references)
      if (item.expiresAt < Date.now()) this.references.delete(key)
    while (this.references.size >= 1000)
      this.references.delete(this.references.keys().next().value!)
    const key = `qz_${createHash('sha256').update(`${accountId}:${userId}:${tid}`).digest('hex').slice(0, 24)}`
    const url = `http://user.qzone.qq.com/${userId}/mood/${tid}`
    this.references.set(key, {
      accountId,
      userId,
      tid,
      curkey: url,
      unikey: url,
      ...extra,
      expiresAt: Date.now() + 30 * 60_000,
    })
    return key
  }

  private resolve(accountId: string, key: string): PostReference {
    const post = this.references.get(key)
    if (!post || post.accountId !== accountId || post.expiresAt < Date.now())
      throw new Error('空间记录已过期，请重新查询后操作')
    return post
  }

  private async auth(accountId: string, invoke: Invoke) {
    const login = record(await invoke('get_login_info', {}))
    if (String(login.user_id) !== accountId) throw new Error('空间登录账号与当前会话不一致')
    const result = record(await invoke('get_cookies', { domain: 'user.qzone.qq.com' }))
    const cookies = String(result.cookies ?? '')
    const values = new Map(
      cookies.split(';').map((item) => {
        const index = item.indexOf('=')
        return [item.slice(0, index).trim(), item.slice(index + 1)]
      }),
    )
    const key = values.get('p_skey')
    if (!key || /[\r\n]/.test(cookies)) throw new Error('空间登录凭据不可用，请重新登录 QQ')
    for (const name of ['uin', 'p_uin']) {
      const value = values.get(name)?.replace(/^o0*/, '')
      if (value && value !== accountId) throw new Error('空间凭据所属账号不一致')
    }
    let hash = 5381
    for (let i = 0; i < key.length; i++) hash = (hash + (hash << 5) + key.charCodeAt(i)) | 0
    return { cookies, token: String(hash & 0x7fffffff) }
  }

  private async request(
    accountId: string,
    invoke: Invoke,
    endpoint: keyof typeof ENDPOINTS,
    input: Record<string, string>,
    signal?: AbortSignal,
    post = false,
  ): Promise<string> {
    const auth = await this.auth(accountId, invoke)
    const url = new URL(BASE + ENDPOINTS[endpoint])
    url.searchParams.set('g_tk', auth.token)
    const fields = new URLSearchParams({ ...input, g_tk: auth.token })
    if (!post) for (const [key, value] of fields) url.searchParams.set(key, value)
    const abort = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)])
    const response = await fetch(url, {
      method: post ? 'POST' : 'GET',
      redirect: 'error',
      signal: abort,
      headers: {
        Cookie: auth.cookies,
        Referer: `https://user.qzone.qq.com/${accountId}`,
        Origin: 'https://user.qzone.qq.com',
        'User-Agent': 'Mozilla/5.0',
        ...(post ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(post ? { body: fields.toString() } : {}),
    })
    if (!response.ok) throw new Error(`空间请求失败（HTTP ${response.status}）`)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('空间返回空响应')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (let item = await reader.read(); !item.done; item = await reader.read()) {
        length += item.value.byteLength
        if (length > 4 * 1024 * 1024) throw new Error('空间响应过大，请减少查询数量')
        chunks.push(item.value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  private check(raw: string) {
    const data = parseQzoneResponse(raw)
    if (data.code !== 0)
      throw new Error(
        `空间操作失败（${String(data.code ?? '响应缺少状态码')}）：${cleanText(data.message ?? data.msg).slice(0, 200)}`,
      )
    return data
  }

  private normalize(accountId: string, value: unknown, fallbackUserId: string) {
    const item = record(value)
    const userId = String(item.uin ?? fallbackUserId)
    const tid = String(item.tid ?? '')
    const postId = this.reference(accountId, userId, tid, {
      ...(typeof item.curkey === 'string' && item.curkey ? { curkey: item.curkey } : {}),
      ...(typeof item.unikey === 'string' && item.unikey ? { unikey: item.unikey } : {}),
    })
    return {
      post_id: postId,
      user_id: userId,
      tid,
      name: cleanText(item.name),
      content: cleanText(item.content),
      created_at: item.created_time,
      comment_count: item.cmtnum,
      repost_count: item.fwdnum,
      images: (Array.isArray(item.pic) ? item.pic : [])
        .slice(0, 9)
        .map((pic) => String(record(pic).url1 ?? record(pic).url2 ?? ''))
        .filter((url) => /^https?:\/\//.test(url)),
      comments: (Array.isArray(item.commentlist) ? item.commentlist : [])
        .slice(0, 30)
        .map((comment) => {
          const c = record(comment)
          return {
            comment_id: String(c.tid ?? c.id ?? ''),
            user_id: String(c.uin ?? ''),
            name: cleanText(c.name),
            content: cleanText(c.content),
          }
        }),
    }
  }

  async execute(
    accountId: string,
    action: string,
    input: Record<string, unknown>,
    invoke: Invoke,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (action === 'qzone_list') {
      const userId = String(input.user_id ?? accountId)
      const data = this.check(
        await this.request(
          accountId,
          invoke,
          'list',
          {
            uin: userId,
            ftype: '0',
            sort: '0',
            pos: String(input.offset ?? 0),
            num: String(input.count ?? 10),
            replynum: '10',
            code_version: '1',
            format: 'jsonp',
            need_private_comment: '1',
            callback: '_preloadCallback',
          },
          signal,
        ),
      )
      if (data.msglist != null && !Array.isArray(data.msglist))
        throw new Error('空间说说列表格式异常')
      const items = (Array.isArray(data.msglist) ? data.msglist : []).map((item) =>
        this.normalize(accountId, item, userId),
      )
      return {
        posts: items,
        total: data.total,
        next_offset: Number(input.offset ?? 0) + items.length,
      }
    }
    if (action === 'qzone_feed') {
      const raw = await this.request(
        accountId,
        invoke,
        'feed',
        {
          uin: accountId,
          scope: '0',
          view: '1',
          filter: 'all',
          flag: '1',
          applist: 'all',
          pagenum: String(input.page ?? 1),
          count: String(input.count ?? 10),
          format: 'json',
          useutf8: '1',
          outputhtmlfeed: '1',
        },
        signal,
      )
      const code = raw.match(/(?:["']?code["']?)\s*:\s*(-?\d+)/)?.[1]
      if (code !== '0') throw new Error('空间动态读取失败或登录已失效')
      const items = raw.split(/\{\s*ver\s*:/).slice(1, Number(input.count ?? 10) + 1)
      if (!items.length && !/(?:data|feeds|items)\s*["']?\s*:\s*\[\s*\]/.test(raw))
        throw new Error('空间动态格式发生变化，无法确认列表内容')
      return {
        posts: items.map((item) => {
          const field = (name: string) =>
            item.match(new RegExp(`\\b${name}\\s*:\\s*'((?:\\\\.|[^'\\\\])*)'`))?.[1] ??
            item.match(new RegExp(`\\b${name}\\s*:\\s*(\\d+)`))?.[1] ??
            ''
          const decode = (value: string) =>
            value
              .replace(/\\x([\da-f]{2})/gi, (_, hex: string) =>
                String.fromCharCode(parseInt(hex, 16)),
              )
              .replace(/\\u([\da-f]{4})/gi, (_, hex: string) =>
                String.fromCharCode(parseInt(hex, 16)),
              )
              .replace(/\\([\\/'"])/g, '$1')
              .replace(/\\n/g, '\n')
          const html = decode(field('html'))
          const content = [...html.matchAll(/class=["']f-info[^"']*["'][^>]*>([\s\S]*?)<\/div>/g)]
            .map((match) => cleanText(match[1]))
            .join('\n')
          const userId = field('uin') || field('opuin')
          const tid = field('key')
          const curkey = decode(field('curkey')) || html.match(/data-curkey=["']([^"']+)["']/)?.[1]
          const unikey = decode(field('unikey')) || html.match(/data-unikey=["']([^"']+)["']/)?.[1]
          return {
            post_id:
              field('appid') === '311'
                ? this.reference(accountId, userId, tid, {
                    ...(curkey ? { curkey } : {}),
                    ...(unikey ? { unikey } : {}),
                  })
                : undefined,
            user_id: userId,
            tid,
            type: field('appid'),
            name: cleanText(decode(field('nickname'))),
            content,
            created_at: field('abstime'),
            images: [...html.matchAll(/data-originurl=["'](https?:\/\/[^"']+)["']/g)]
              .slice(0, 9)
              .map((match) => match[1]),
          }
        }),
        page: Number(input.page ?? 1),
      }
    }
    const target = this.resolve(accountId, String(input.post_id ?? ''))
    if (action === 'qzone_detail') {
      const data = this.check(
        await this.request(
          accountId,
          invoke,
          'detail',
          {
            uin: target.userId,
            tid: target.tid,
            num: '30',
            format: 'jsonp',
            callback: '_preloadCallback',
            code_version: '1',
          },
          signal,
        ),
      )
      return this.normalize(
        accountId,
        { ...record(data.data ?? data), tid: target.tid, uin: target.userId },
        target.userId,
      )
    }
    let fields: Record<string, string>
    let endpoint: 'like' | 'comment' | 'repost'
    if (action === 'qzone_like') {
      endpoint = 'like'
      fields = {
        qzreferrer: `https://user.qzone.qq.com/${target.userId}`,
        opuin: accountId,
        unikey: target.unikey,
        curkey: target.curkey,
        appid: '311',
        from: '1',
        typeid: '0',
        abstime: String(Math.floor(Date.now() / 1000)),
        fid: target.tid,
        active: '0',
        format: 'json',
        fupdate: '1',
      }
    } else if (action === 'qzone_comment') {
      endpoint = 'comment'
      fields = {
        topicId: `${target.userId}_${target.tid}__1`,
        feedsType: '100',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        plat: 'qzone',
        source: 'ic',
        hostUin: target.userId,
        platformid: '52',
        uin: accountId,
        format: 'fs',
        ref: 'feeds',
        content: String(input.content),
        richval: '',
        richtype: '',
        private: '0',
        paramstr: '1',
      }
    } else if (action === 'qzone_repost') {
      endpoint = 'repost'
      fields = {
        t1_uin: target.userId,
        t1_source: '1',
        tid: target.tid,
        signin: '0',
        con: String(input.content ?? ''),
        with_cmt: '0',
        fwdToWeibo: '0',
        forward_source: '2',
        code_version: '1',
        format: 'fs',
        hostuin: accountId,
      }
    } else throw new Error('未知空间操作')
    const result = this.check(await this.request(accountId, invoke, endpoint, fields, signal, true))
    return { accepted: true, tid: result.tid ?? record(result.data).tid }
  }
}
