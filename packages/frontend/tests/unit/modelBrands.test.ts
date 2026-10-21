import { describe, expect, it } from 'vitest'
import { resolveModelBrand } from '../../src/lib/modelBrands'

describe('模型图标识别', () => {
  it.each([
    ['[bo++2]gemini-4-argon-4.5', 'gemini'],
    ['[bo++2]gemini-4-argon-高度思考-4.5', 'gemini'],
    ['[bo++]gemini-3-flash-0.6', 'gemini'],
    ['[bo++]gemini-3.1-pro-preview-3', 'gemini'],
    ['acm/gemini-3.8-flash', 'gemini'],
    ['[claude渠道][高速]gemini-3-flash', 'gemini'],
    ['【高速】Gemini-3-Pro', 'gemini'],
    ['［高速］ＧＥＭＩＮＩ－３－ＰＲＯ', 'gemini'],
    ['route__claude-sonnet-4-5', 'claude'],
    ['us.anthropic.claude-3-7-sonnet:0', 'claude'],
    ['publishers/google/models/gemini-2.5-pro', 'gemini'],
    ['proxy: GPT-4o', 'openai'],
    ['Gemini—3 Pro', 'gemini'],
    ['[fast]o3-mini', 'openai'],
    ['Qwen/Qwen3.8-27B', 'qwen'],
    ['DeepSeek-R1-Distill-Qwen-32B', 'deepseek'],
    ['nvidia/Llama-3.3-Nemotron-Super-49B', 'nvidia'],
    ['meta-llama/Llama-3.3-70B-Instruct', 'llama'],
    ['ollama/gemma3:latest', 'gemma'],
    ['(gemini-3-pro)', 'gemini'],
  ])('识别 %s', (id, expected) => {
    expect(resolveModelBrand(id)).toBe(expected)
  })

  it.each([
    undefined,
    '',
    'unknown',
    'mygemini-3',
    'notgpt-4',
    'google/unknown-model',
    '[gemini渠道]unknown-model',
  ])('未知模型保持通用图标：%s', (id) => {
    expect(resolveModelBrand(id)).toBeUndefined()
  })
})
