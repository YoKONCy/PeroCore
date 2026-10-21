import { describe, expect, it } from 'vitest'
import { ToolLoopError, ToolLoopGuard } from '@infos/backend/services/agent/toolLoopGuard'

describe('工具无进展循环的误判保护', () => {
  it('相同失败先拦截提醒一次，再重复才中断，参数键顺序不影响判断', () => {
    const guard = new ToolLoopGuard()
    for (let index = 0; index < 6; index++) {
      expect(guard.before('edit_file', { path: 'a.ts', old: 'a' })).toBeUndefined()
      guard.observe('edit_file', { path: 'a.ts', old: 'a' }, '目标文字不存在', true)
    }
    expect(guard.before('edit_file', { old: 'a', path: 'a.ts' })).toContain('本次调用未执行')
    expect(guard.signal.aborted).toBe(false)
    expect(() => guard.before('edit_file', { path: 'a.ts', old: 'a' })).toThrow(ToolLoopError)
    expect(guard.signal.aborted).toBe(true)
  })

  it('不同文件、不同参数以及读取结果变化都表示进展', () => {
    const guard = new ToolLoopGuard()
    expect(() => {
      for (let index = 0; index < 100; index++) {
        expect(guard.before('read_file', { path: `${index}.ts` })).toBeUndefined()
        guard.observe('read_file', { path: `${index}.ts` }, '相同模板', false)
        expect(guard.before('read_file', { path: 'state.ts' })).toBeUndefined()
        guard.observe('read_file', { path: 'state.ts' }, `版本 ${index}`, false)
      }
    }).not.toThrow()
  })

  it('轮询、截图和等待不会因返回相同内容而中断', () => {
    for (const name of [
      'terminal_read',
      'terminal_wait',
      'browser_screenshot',
      'wait',
      'social_act',
    ]) {
      const guard = new ToolLoopGuard()
      for (let index = 0; index < 100; index++) {
        expect(guard.before(name, { id: 'same' })).toBeUndefined()
        guard.observe(name, { id: 'same' }, '仍在等待', false)
      }
    }
  })

  it('成功修改和其他动态操作会清除旧的读取循环证据', () => {
    const guard = new ToolLoopGuard()
    for (let index = 0; index < 30; index++) {
      for (let read = 0; read < 4; read++) {
        expect(guard.before('read_file', { path: 'a' })).toBeUndefined()
        guard.observe('read_file', { path: 'a' }, 'a', false)
      }
      guard.observe('edit_file', { path: 'b' }, '已修改', false)
    }
  })

  it('短期读取引用变化不是进展，但文件版本变化仍是进展', () => {
    const guard = new ToolLoopGuard()
    for (let index = 0; index < 12; index++) {
      expect(guard.before('read_file', { path: 'a' })).toBeUndefined()
      guard.observe(
        'read_file',
        { path: 'a' },
        JSON.stringify({
          path: 'a',
          hash: 'version-a',
          content: '相同内容',
          read_ref: `read-${index}`,
        }),
        false,
      )
    }
    expect(guard.before('read_file', { path: 'a' })).toBeDefined()
    guard.observe(
      'read_file',
      { path: 'a' },
      JSON.stringify({
        path: 'a',
        hash: 'version-b',
        content: '相同内容',
        read_ref: 'new-ref',
      }),
      false,
    )
    expect(guard.before('read_file', { path: 'a' })).toBeUndefined()
  })

  it('没有子工具的纯计算脚本也能识别重复结果', () => {
    const guard = new ToolLoopGuard()
    for (let index = 0; index < 12; index++) {
      expect(guard.before('run_script', { code: 'return 1' })).toBeUndefined()
      const version = guard.observationVersion
      guard.observe('run_script', { code: 'return 1' }, '1', false, version)
    }
    expect(guard.before('run_script', { code: 'return 1' })).toBeDefined()
    expect(() => guard.before('run_script', { code: 'return 1' })).toThrow(ToolLoopError)
  })

  it('识别交替的稳定读取循环，NIT 容器不遮掉内部证据', () => {
    const guard = new ToolLoopGuard()
    for (let index = 0; index < 12; index++) {
      for (const path of ['a', 'b']) {
        expect(guard.before('read_file', { path })).toBeUndefined()
        guard.observe('read_file', { path }, path, false)
      }
      guard.before('run_script', { code: '不同外壳' })
      guard.observe('run_script', {}, '脚本已结束', false)
    }
    expect(guard.before('read_file', { path: 'a' })).toContain('近期相同工具参数')
    expect(() => guard.before('read_file', { path: 'a' })).toThrow(ToolLoopError)
    expect(new ToolLoopGuard().before('read_file', { path: 'a' })).toBeUndefined()
  })
})
