import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  getNapCatWebUiEndpoint,
  isNapCatWebUiDocument,
  observeNapCatWebUi,
  prepareNapCatWebUi,
} from './napcatWebUi'

let directory: string
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(tmpdir(), 'infos-napcat-webui-'))
  prepareNapCatWebUi(directory)
})
afterEach(() => {
  if (path.dirname(directory) === tmpdir()) fs.rmSync(directory, { recursive: true, force: true })
})

describe('NapCat 管理页入口与就绪', () => {
  it('入口规范化为 /webui/，凭据仍只从主进程配置读取', () => {
    const config = JSON.parse(fs.readFileSync(path.join(directory, 'webui.json'), 'utf8'))
    observeNapCatWebUi('[WebUi] WebUi User Panel Url: http://127.0.0.1:6099/webui?token=***')
    const endpoint = getNapCatWebUiEndpoint(directory)!
    expect(endpoint.pathname).toBe('/webui/')
    expect(endpoint.searchParams.get('token')).toBe(config.token)
  })

  it('普通接口的 200 错误响应不能冒充就绪文档', () => {
    const error = '{"code":-1,"message":"An unknown error occurred."}'
    expect(isNapCatWebUiDocument(200, 'application/json', error)).toBe(false)
    expect(isNapCatWebUiDocument(200, 'text/html; charset=utf-8', error)).toBe(false)
    const html = '<!doctype html><html><head><title>NapCat WebUI</title></head><body></body></html>'
    expect(isNapCatWebUiDocument(200, 'text/html; charset=utf-8', html)).toBe(true)
    expect(isNapCatWebUiDocument(500, 'text/html', html)).toBe(false)
  })
})
