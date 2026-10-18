import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  fileToolBusinessOutput,
  modelToolObservation,
  readToolObservation,
  releaseToolObservations,
} from '../../../../src/services/execution/toolObservation'

const owner = { agentId: 'pero', threadId: 'thread', channel: 'desktop' }
let directory: string
beforeEach(() => {
  const root = fileURLToPath(new URL('../../../../../../TEMP/', import.meta.url))
  mkdirSync(root, { recursive: true })
  directory = mkdtempSync(path.join(root, 'work-results-'))
  vi.stubEnv('PERO_DATA_DIR', directory)
})
afterEach(() => {
  releaseToolObservations({}, true)
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})
describe('模型观察与脚本业务值', () => {
  it('超过旧 8000 字符仍完整交付，文件 diff 仅在文件契约边界移出', () => {
    const output = JSON.stringify({ value: '正文'.repeat(10_000) })
    expect(modelToolObservation(output, owner)).toBe(output)
    const file = JSON.stringify({
      success: true,
      newHash: '新版本',
      diffPreview: [{ text: '正文' }],
    })
    expect(JSON.parse(fileToolBusinessOutput('edit_file', file))).toEqual({
      success: true,
      newHash: '新版本',
    })
    expect(fileToolBusinessOutput('custom_tool', file)).toBe(file)
  })
  it('转义后的外壳仍满足预算，正文分页重读并核验所有者', () => {
    const original = '\n"中文🎉'.repeat(30_000)
    const result = modelToolObservation(original, owner, 4096)
    const body = JSON.parse(result)
    expect(result.length).toBeLessThanOrEqual(4096)
    expect(body.observationTruncated).toBe(true)
    const tail = readToolObservation(body.resultRef, owner, body.nextOffset, 1000).content
    expect(body.excerpt + tail).toBe(original.slice(0, body.nextOffset + tail.length))
    expect(() => readToolObservation(body.resultRef, { ...owner, threadId: '其他' })).toThrow(
      '不属于',
    )
    releaseToolObservations(owner, true)
    expect(() => readToolObservation(body.resultRef, owner)).toThrow('失效')
  })
  it('释放热缓存及重启边界后仍可分页读取，其他任务不能读取，永久删除才清理原件', () => {
    const original = '跨轮原始输出'.repeat(30_000)
    const result = JSON.parse(modelToolObservation(original, owner, 4096))
    releaseToolObservations(owner)
    expect(readToolObservation(result.resultRef, owner, 4000, 300).content).toBe(
      original.slice(4000, 4300),
    )
    expect(() => readToolObservation(result.resultRef, { ...owner, taskId: 'other' })).toThrow(
      '不属于',
    )
    releaseToolObservations(owner, true)
    expect(() => readToolObservation(result.resultRef, owner)).toThrow('失效')
  })
})
