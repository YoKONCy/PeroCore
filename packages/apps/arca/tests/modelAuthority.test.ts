import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArcaModelRepository } from '../src/modelRepository'

const directories: string[] = []
function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'arca-model-authority-'))
  directories.push(directory)
  return { directory, models: new ArcaModelRepository(directory) }
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Arca独立Model Authority', () => {
  it('配置仓库只保存credentialRef，Secret Store不出现API Key明文', () => {
    const { directory, models } = repository()
    const saved = models.save({
      name: '本地写作模型',
      provider: 'openai',
      modelId: 'gpt-test',
      apiBase: 'http://127.0.0.1:1234/v1',
      apiKey: 'arca-secret-value',
    })
    expect(saved.credentialConfigured).toBe(true)
    expect('credentialRef' in saved).toBe(false)
    const modelFile = readFileSync(join(directory, 'models.json'), 'utf8')
    const secretFile = readFileSync(join(directory, 'secrets', 'credentials.json'), 'utf8')
    expect(modelFile).not.toContain('arca-secret-value')
    expect(modelFile).toContain('arca-credential:')
    expect(secretFile).not.toContain('arca-secret-value')
    const internal = models.resolve(saved.id)
    expect(models.secrets.resolve(internal.credentialRef!)).toBe('arca-secret-value')
  })

  it('更新时留空API Key保留原凭据，删除模型同步删除Secret', () => {
    const { models } = repository()
    const created = models.save({
      name: '模型A',
      provider: 'openai',
      modelId: 'model-a',
      apiKey: 'secret-a',
    })
    const credentialRef = models.resolve(created.id).credentialRef!
    const updated = models.save({
      id: created.id,
      name: '模型A更新',
      provider: 'openai',
      modelId: 'model-a',
    })
    expect(updated.credentialConfigured).toBe(true)
    expect(models.secrets.resolve(credentialRef)).toBe('secret-a')
    expect(models.remove(created.id)).toBe(true)
    expect(models.secrets.has(credentialRef)).toBe(false)
  })

  it('模型选择完全保存在Arca仓库且不依赖Kernel', () => {
    const { directory, models } = repository()
    const first = models.save({ name: '本地模型', provider: 'ollama', modelId: 'qwen3' })
    expect(models.selected()).toBe(first.id)
    expect(existsSync(join(directory, 'models.json'))).toBe(true)
    expect(() => models.select('missing')).toThrow('ARCA_MODEL_NOT_FOUND')
  })
})
