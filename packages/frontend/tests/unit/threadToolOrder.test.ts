import { describe, expect, it } from 'vitest'
import { sortThreadTools } from '../../src/lib/threadToolOrder'

function tool(name: string, packageId?: string, enabled = true, locked = false) {
  return { name, packageId, enabled, locked }
}
const names = (tools: ReturnType<typeof tool>[]) => sortThreadTools(tools).map((item) => item.name)

describe('会话工具自动排序', () => {
  it('系统启用项置顶，普通启用项随后，关闭和模式未开放项沉底', () => {
    expect(
      names([
        tool('a_disabled', undefined, false),
        tool('z_system', undefined, true, true),
        tool('b_normal'),
        tool('a_system', undefined, true, true),
        tool('a_blocked_system', undefined, false, true),
        tool('a_normal'),
      ]),
    ).toEqual(['a_system', 'z_system', 'a_normal', 'b_normal', 'a_blocked_system', 'a_disabled'])
  })

  it('按实际工具包聚合，不依赖函数名前缀或包标识字母顺序', () => {
    expect(
      names([
        tool('z_write', 'package:z'),
        tool('c_other', 'package:a'),
        tool('a_read', 'package:z'),
        tool('b_other', 'package:a'),
      ]),
    ).toEqual(['a_read', 'z_write', 'b_other', 'c_other'])
  })

  it('同包关闭成员归末，重新启用后自动回到包内', () => {
    const write = tool('write_file', 'files', false)
    const tools = [
      write,
      tool('get_system_info'),
      tool('read_file', 'files'),
      tool('get_file_info', 'files'),
    ]
    expect(names(tools)).toEqual(['get_file_info', 'read_file', 'get_system_info', 'write_file'])
    write.enabled = true
    expect(names(tools)).toEqual(['get_file_info', 'read_file', 'write_file', 'get_system_info'])
  })

  it('结果不受注册顺序影响，也不修改原数组或复制工具对象', () => {
    const tools = [tool('z', 'one'), tool('b'), tool('a', 'one')]
    const original = [...tools]
    expect(names(tools)).toEqual(names([...tools].reverse()))
    expect(tools).toEqual(original)
    expect(sortThreadTools(tools)[0]).toBe(tools[2])
    expect(sortThreadTools([])).toEqual([])
  })

  it('未声明工具包的功能按完整函数名字母顺序排列', () => {
    expect(names([tool('beta'), tool('Alpha'), tool('alpha'), tool('alpha_more')])).toEqual([
      'Alpha',
      'alpha',
      'alpha_more',
      'beta',
    ])
  })
})
