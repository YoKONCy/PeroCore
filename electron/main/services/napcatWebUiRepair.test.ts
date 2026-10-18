import { describe, expect, it, vi } from 'vitest'
import { repairNapCatWebUiSource } from './napcatWebUiRepair'

// 保留 4.18.38 真实回退路由，检查响应文件与静态根目录的边界。
const source = [
  'const Vu = typeof sQ < "u" && "4.18.38" || "1.0.0-dev";',
  'function mount(jn, e, fn) {',
  '  const d = fn(e.staticPath, "index.html");',
  '  jn.all(/\\/webui\\/(.*)/, (f, m) => {',
  '    m.sendFile(d);',
  '  }), jn.all("/", (f, m) => {',
  '    m.status(301).header("Location", "/webui").send();',
  '  });',
  '}',
].join('\n')

describe('NapCat 管理页 SPA 回退', () => {
  it.each([
    'C:/Users/Administrator/.infos/tools/NapCat/napcat/static',
    'D:/应用 便携版/data/tools/NapCat/napcat/static',
  ])('固定发送根目录内的首页，不把隐藏安装目录当作请求路径：%s', (root) => {
    const repaired = repairNapCatWebUiSource(source)
    let render: ((request: object, response: object) => void) | undefined
    const mount = new Function(`${repaired}\nreturn mount;`)() as (
      router: object,
      paths: object,
      join: (...parts: string[]) => string,
    ) => void
    mount(
      {
        all: (route: unknown, handler: typeof render) => {
          if (route instanceof RegExp) render = handler
        },
      },
      { staticPath: root },
      (...parts) => parts.join('/'),
    )
    const sendFile = vi.fn()
    render!({ path: '/webui/qq_login' }, { sendFile })
    expect(sendFile).toHaveBeenCalledWith('index.html', {
      root,
      cacheControl: false,
      headers: { 'Cache-Control': 'no-store' },
    })
    expect(repaired).not.toContain('dotfiles:')
    expect(repairNapCatWebUiSource(repaired)).toBe(repaired)
  })

  it('枚举之外的打包变量可改名，其他文件响应保持原状', () => {
    const renamed = source.replace(/\be\b/g, 'paths$').replace(/\bd\b/g, 'entry$')
    const plugin = '\nfunction plugin(response, path) { response.sendFile(path); }'
    const repaired = repairNapCatWebUiSource(renamed + plugin)
    expect(repaired).toContain('root: paths$.staticPath')
    expect(repaired).toContain(plugin)
    expect(repairNapCatWebUiSource(repaired)).toBe(repaired)
  })

  it('其他版本不修改，未知路由布局不执行替换', () => {
    const newer = source.replace('4.18.38', '4.19.0')
    expect(repairNapCatWebUiSource(newer)).toBe(newer)
    expect(() =>
      repairNapCatWebUiSource(source.replace('m.sendFile(d);', 'm.send("未知响应");')),
    ).toThrow('文件响应布局不匹配')
  })
})
