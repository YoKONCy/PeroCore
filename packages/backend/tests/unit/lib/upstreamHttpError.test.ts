import { describe, expect, it } from 'vitest'
import { upstreamHttpError, upstreamWebPage } from '@infos/backend/lib/upstreamHttpError'

describe('上游网页错误识别', () => {
  it('仅凭验证响应头即可识别，错误不包含网页内容', () => {
    const response = new Response(null, { status: 403, headers: { 'cf-mitigated': 'challenge' } })
    const error = upstreamHttpError(response, '不可打印的网页内容', '测试 API', 'EMBEDDING_ERROR')
    expect(upstreamWebPage(response)).toBe('challenge')
    expect(error.message).toContain('Cloudflare 人机验证')
    expect(error.message).not.toContain('不可打印')
    expect(error.data).toMatchObject({ status: 403, kind: 'challenge', retryable: false })
  })

  it('缺少响应头时仍可从 HTML 识别验证页', () => {
    const response = new Response(null, { status: 403 })
    expect(upstreamWebPage(response, '<!DOCTYPE html><html><title>Just a moment...</title>')).toBe(
      'challenge',
    )
  })

  it('普通代理错误网页提示检查地址，不把 HTML 当模型错误原文展示', () => {
    const response = new Response(null, { status: 502, headers: { 'content-type': 'text/html' } })
    const error = upstreamHttpError(response, '<html>代理内部页面</html>', '测试 API', 'LLM_ERROR')
    expect(error.message).toContain('检查 API 基址')
    expect(error.message).not.toContain('<html>')
  })

  it('JSON 错误只提取有限的服务商原因', () => {
    const response = new Response(null, { status: 401 })
    const error = upstreamHttpError(
      response,
      JSON.stringify({ error: { message: '密钥无效' }, private: '不展示' }),
      '测试 API',
      'LLM_ERROR',
    )
    expect(error.message).toContain('密钥无效')
    expect(error.message).not.toContain('不展示')
  })
})
