import { describe, expect, it } from 'vitest'
import {
  CLIENT_ERROR_CODES,
  CODE_MESSAGES,
  CODE_TO_HTTP,
  SERVER_ERROR_CODES,
  SUCCESS_CODES,
} from '@infos/shared'

describe('responseCodes', () => {
  describe('成功码契约', () => {
    it('应当为成功类 Code 提供默认中文消息和 2xx HTTP 状态码', () => {
      for (const code of Object.values(SUCCESS_CODES)) {
        expect(CODE_MESSAGES[code]).toBeTruthy()
        expect(CODE_TO_HTTP[code]).toBeGreaterThanOrEqual(200)
        expect(CODE_TO_HTTP[code]).toBeLessThan(300)
      }
    })
  })

  describe('错误码契约', () => {
    it('应当为客户端错误类 Code 提供 4xx HTTP 状态码', () => {
      for (const code of Object.values(CLIENT_ERROR_CODES)) {
        expect(CODE_MESSAGES[code]).toBeTruthy()
        expect(CODE_TO_HTTP[code]).toBeGreaterThanOrEqual(400)
        expect(CODE_TO_HTTP[code]).toBeLessThan(500)
      }
    })

    it('应当为服务端错误类 Code 提供 5xx HTTP 状态码', () => {
      for (const code of Object.values(SERVER_ERROR_CODES)) {
        expect(CODE_MESSAGES[code]).toBeTruthy()
        expect(CODE_TO_HTTP[code]).toBeGreaterThanOrEqual(500)
        expect(CODE_TO_HTTP[code]).toBeLessThan(600)
      }
    })
  })

  describe('边界映射', () => {
    it('应当将配置未设置视为可成功返回的业务状态', () => {
      expect(CODE_TO_HTTP.NOT_CONFIGURED).toBe(200)
      expect(CODE_MESSAGES.NOT_CONFIGURED).toBe('配置未设置')
    })

    it('应当将限流和超时映射到对应 HTTP 状态码', () => {
      expect(CODE_TO_HTTP.RATE_LIMITED).toBe(429)
      expect(CODE_TO_HTTP.GATEWAY_TIMEOUT).toBe(504)
      expect(CODE_TO_HTTP.LLM_TIMEOUT).toBe(504)
    })
  })
})
