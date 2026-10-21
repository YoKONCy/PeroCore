import { lookup } from 'node:dns/promises'
import { createReadStream } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import path from 'node:path'
import type { Readable } from 'node:stream'
import type { ResourceKind } from '@infos/shared'

export const MAX_RESOURCE_BYTES = 100 * 1024 * 1024

/** 已校验的本地资源通过统一的流读取边界限制大小，并响应取消。 */
export function readBoundedResourceFile(
  filePath: string,
  signal?: AbortSignal,
  maxBytes = MAX_RESOURCE_BYTES,
): Promise<Buffer> {
  return boundedResourceBytes(createReadStream(filePath), signal, maxBytes)
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  aac: 'audio/aac',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  js: 'text/javascript',
  mjs: 'text/javascript',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ico: 'image/x-icon',
  ts: 'text/typescript',
  py: 'text/x-python',
  css: 'text/css',
  html: 'text/html',
  htm: 'text/html',
  xml: 'text/xml',
  svg: 'image/svg+xml',
  vue: 'text/plain',
  tsx: 'text/plain',
  jsx: 'text/plain',
  rs: 'text/plain',
  go: 'text/plain',
  c: 'text/plain',
  h: 'text/plain',
  cpp: 'text/plain',
  java: 'text/plain',
  sh: 'text/plain',
  ps1: 'text/plain',
  log: 'text/plain',
  toml: 'text/plain',
  ini: 'text/plain',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  rtf: 'application/rtf',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  epub: 'application/epub+zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export function resourceName(value: string): string {
  return (
    path
      .basename(value.replaceAll('\\', '/'))
      // eslint-disable-next-line no-control-regex -- 文件名必须去除 ASCII 控制字符。
      .replace(/[\x00-\x1f\x7f]/g, '')
      .slice(0, 180) || '文件'
  )
}

export function resourceMime(name: string, declared = '', bytes?: Buffer): string {
  if (bytes) {
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      return 'image/png'
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
    if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif'
    if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
      return 'image/webp'
    if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf'
  }
  const hint = declared.toLowerCase().split(';')[0]?.trim() ?? ''
  if (hint && hint !== 'application/octet-stream') return hint
  return MIME_BY_EXTENSION[path.extname(name).slice(1).toLowerCase()] ?? 'application/octet-stream'
}

export function resourceKind(mime: string): ResourceKind {
  if (
    [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/avif',
      'image/bmp',
      'image/x-icon',
    ].includes(mime)
  )
    return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  if (
    mime.startsWith('text/') ||
    ['application/json', 'image/svg+xml', 'application/svg+xml', 'application/xml'].includes(mime)
  )
    return 'text'
  return 'file'
}

function publicAddress(address: string): boolean {
  if (isIP(address) === 6)
    return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0):/i.test(address)
  const [a = 0, b = 0] = address.split('.').map(Number)
  return (
    isIP(address) === 4 &&
    a !== 0 &&
    a !== 10 &&
    a !== 127 &&
    a < 224 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && [0, 168].includes(b)) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 198 && [18, 19].includes(b))
  )
}

/** 每次重定向重新校验，并固定 DNS 解析结果，避免下载转向本机或内网。 */
export async function publicResourceUrl(value: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('资源地址须为 HTTP 或 HTTPS，不能包含登录凭据')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true })
  if (!addresses.length || addresses.some((item) => !publicAddress(item.address)))
    throw new Error('在线资源不能指向本机或内网')
  url.hash = ''
  return { url, address: addresses.find((item) => item.family === 4) ?? addresses[0]! }
}

export async function boundedResourceBytes(
  stream: Readable,
  signal?: AbortSignal,
  maxBytes = MAX_RESOURCE_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > maxBytes) throw new Error(`文件超过 ${maxBytes / 1024 / 1024} MB 限制`)
      chunks.push(bytes)
    }
  } finally {
    stream.destroy()
  }
  signal?.throwIfAborted()
  return Buffer.concat(chunks, size)
}

async function requestResource(
  target: string,
  signal: AbortSignal,
  method: 'GET' | 'HEAD' = 'GET',
) {
  const { url, address } = await publicResourceUrl(target)
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method,
        signal,
        lookup: (_hostname, options, callback) =>
          options.all
            ? callback(null, [{ address: address.address, family: address.family }])
            : callback(null, address.address, address.family),
        headers: { 'User-Agent': 'infOS', Accept: '*/*', 'Accept-Encoding': 'identity' },
      },
      resolve,
    )
    request.on('error', reject)
    request.end()
  })
  return { url, response }
}

function responseName(response: import('node:http').IncomingMessage, url: URL): string {
  const disposition = response.headers['content-disposition'] ?? ''
  const filename =
    disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ??
    disposition.match(/filename="?([^";]+)/i)?.[1] ??
    url.pathname.split('/').pop() ??
    ''
  let name = filename
  try {
    name = decodeURIComponent(filename)
  } catch {
    /* 保留未编码文件名。 */
  }
  return resourceName(name || url.hostname)
}

/** 引用只读取响应头，按实际类型识别没有扩展名的下载地址。 */
export async function inspectResource(source: string, cancellation?: AbortSignal) {
  const signal = AbortSignal.any([
    ...(cancellation ? [cancellation] : []),
    AbortSignal.timeout(15_000),
  ])
  let target = source
  let method: 'HEAD' | 'GET' = 'HEAD'
  for (let redirects = 0; redirects <= 4; redirects++) {
    signal.throwIfAborted()
    const { url, response } = await requestResource(target, signal, method)
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      response.destroy()
      if (!response.headers.location) throw new Error('资源重定向缺少地址')
      target = new URL(response.headers.location, url).href
      continue
    }
    if (method === 'HEAD' && [403, 405, 501].includes(response.statusCode ?? 0)) {
      response.destroy()
      method = 'GET'
      redirects--
      continue
    }
    response.destroy()
    if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300)
      throw new Error(`资源暂不可用（HTTP ${response.statusCode ?? '未知'}）`)
    const name = responseName(response, url)
    return {
      name,
      mimeType: resourceMime(name, response.headers['content-type']),
      sizeBytes: Math.max(0, Number(response.headers['content-length']) || 0),
      url: url.href,
    }
  }
  throw new Error('资源重定向次数过多')
}

export async function downloadResource(
  source: string,
  signal?: AbortSignal,
  maxBytes = MAX_RESOURCE_BYTES,
) {
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(90_000)])
  let target = source
  for (let redirects = 0; redirects <= 4; redirects++) {
    deadline.throwIfAborted()
    const { url, response } = await requestResource(target, deadline)
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      response.destroy()
      if (!response.headers.location) throw new Error('资源重定向缺少地址')
      target = new URL(response.headers.location, url).href
      continue
    }
    if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
      response.destroy()
      throw new Error(`资源获取失败（HTTP ${response.statusCode ?? '未知'}）`)
    }
    if (Number(response.headers['content-length'] ?? 0) > maxBytes) {
      response.destroy()
      throw new Error(`文件超过 ${maxBytes / 1024 / 1024} MB 限制`)
    }
    const name = responseName(response, url)
    const bytes = await boundedResourceBytes(response, deadline, maxBytes)
    return {
      bytes,
      name,
      mimeType: resourceMime(name, response.headers['content-type'], bytes),
      url: url.href,
    }
  }
  throw new Error('资源重定向次数过多')
}
