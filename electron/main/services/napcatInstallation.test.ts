import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  prepareNapCatNodeInstallation,
  copyNapCatProgramFiles,
  isNapCatUserFile,
  getNapCatBuiltinProblem,
} from './napcatInstallation'

let directory: string
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(tmpdir(), 'infos-napcat-installation-'))
})
afterEach(() => {
  if (path.dirname(directory) === tmpdir()) fs.rmSync(directory, { recursive: true, force: true })
})

function write(root: string, relative: string, content: string): void {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
}

function program(root: string, version = '9.9.31-49738', build = '49738'): void {
  for (const name of ['node.exe', 'wrapper.node', 'QQNT.dll', 'index.js', 'napcat/napcat.mjs'])
    write(root, name, '程序文件')
  write(root, 'package.json', JSON.stringify({ version, buildVersion: build }))
}

describe('NapCat 发行包与 QQ 元数据', () => {
  it('修复已经更新程序但保留旧版本元数据的安装，不改动账号配置', () => {
    program(directory)
    write(
      directory,
      'config.json',
      JSON.stringify({
        baseVersion: '9.9.23-42086',
        curVersion: '9.9.23-42086',
        buildId: '42086',
        prevVersion: '9.9.22-41900',
        onErrorVersions: ['9.9.31-49738'],
        unzipRetryCount: 3,
      }),
    )
    write(directory, 'napcat/config/onebot11_10000001.json', '{"账号连接":"原配置"}')
    write(directory, 'qqnt.json', '{"设备信息":"原配置"}')
    const result = prepareNapCatNodeInstallation(directory)
    expect(result).toMatchObject({ version: '9.9.31-49738', repaired: true })
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8'))).toEqual({
      baseVersion: '9.9.31-49738',
      curVersion: '9.9.31-49738',
      buildId: '49738',
      prevVersion: '',
      onErrorVersions: [],
      unzipRetryCount: 0,
    })
    expect(fs.readFileSync(path.join(directory, 'qqnt.json'), 'utf8')).toBe('{"设备信息":"原配置"}')
    expect(
      fs.readFileSync(path.join(directory, 'napcat/config/onebot11_10000001.json'), 'utf8'),
    ).toBe('{"账号连接":"原配置"}')
    expect(prepareNapCatNodeInstallation(directory).repaired).toBe(false)
  })

  it.each([undefined, '{损坏的版本信息'])('元数据缺失或损坏时可从发行清单重建：%s', (metadata) => {
    program(directory)
    if (metadata) write(directory, 'config.json', metadata)
    expect(prepareNapCatNodeInstallation(directory).repaired).toBe(true)
  })

  it('拒绝混乱的 QQ 清单，不依据无效版本生成元数据', () => {
    program(directory, '9.9.31-49738', '42086')
    expect(() => prepareNapCatNodeInstallation(directory)).toThrow('QQ 版本清单不一致')
    expect(fs.existsSync(path.join(directory, 'config.json'))).toBe(false)
  })

  it.each(['node.exe', 'wrapper.node', 'QQNT.dll', 'napcat/napcat.mjs'])(
    '程序文件缺失时阻止启动：%s',
    (file) => {
      program(directory)
      fs.unlinkSync(path.join(directory, file))
      expect(() => prepareNapCatNodeInstallation(directory)).toThrow('程序文件缺失或无效')
    },
  )

  it.each(['标准版/用户数据', '便携版 含空格/data'])('支持发行版可写数据路径：%s', (relative) => {
    const root = path.join(directory, relative, 'tools', 'NapCat')
    program(root)
    const result = prepareNapCatNodeInstallation(root)
    expect(result.command).toBe(path.join(root, 'node.exe'))
    expect(result.entry).toBe('index.js')
  })

  it('更新时替换根版本信息，保留账号、登录数据、WebUI、缓存与插件', () => {
    const source = path.join(directory, '发行包')
    const destination = path.join(directory, '已有安装')
    program(source)
    program(destination, '9.9.23-42086', '42086')
    prepareNapCatNodeInstallation(source)
    prepareNapCatNodeInstallation(destination)
    const preserved = [
      'napcat/config/webui.json',
      'napcat/config/onebot11_10000001.json',
      'napcat/config/.env',
      'napcat/config/plugins/napcat-plugin-builtin/config.json',
      'napcat/plugins/插件.js',
      'data/登录凭据',
      'cache/缓存',
      'qqnt.json',
      '.infos-quick-login-account',
    ]
    for (const file of preserved) {
      write(source, file, '发行包默认值')
      write(destination, file, '用户原值')
    }
    write(
      source,
      'napcat/plugins/builtin/index.mjs',
      'const plugin_onmessage = async (ctx, event) => {};',
    )
    write(
      destination,
      'napcat/plugins/builtin/index.mjs',
      'const plugin_onmessage = async (adapter, core, obCtx, event, actions, instance) => {};',
    )
    write(
      source,
      'napcat/plugins/builtin/package.json',
      '{"name":"napcat-plugin-builtin","version":"新版"}',
    )
    write(
      destination,
      'napcat/plugins/builtin/package.json',
      '{"name":"napcat-plugin-builtin","version":"旧版"}',
    )
    copyNapCatProgramFiles(source, destination)
    expect(prepareNapCatNodeInstallation(destination).version).toBe('9.9.31-49738')
    for (const file of preserved)
      expect(fs.readFileSync(path.join(destination, file), 'utf8')).toBe('用户原值')
    expect(
      fs.readFileSync(path.join(destination, 'napcat/plugins/builtin/index.mjs'), 'utf8'),
    ).toBe(fs.readFileSync(path.join(source, 'napcat/plugins/builtin/index.mjs'), 'utf8'))
    expect(
      JSON.parse(
        fs.readFileSync(path.join(destination, 'napcat/plugins/builtin/package.json'), 'utf8'),
      ).version,
    ).toBe('新版')
  })

  it('按目录边界保护用户数据，不误保护 config.json 或名称相似的程序文件', () => {
    expect(isNapCatUserFile('config.json')).toBe(false)
    expect(isNapCatUserFile('napcat/config-default.json')).toBe(false)
    expect(isNapCatUserFile('NapCat\\Config\\webui.json')).toBe(true)
    expect(isNapCatUserFile('napcat/plugins')).toBe(false)
    expect(isNapCatUserFile('napcat/plugins/builtin/index.mjs')).toBe(false)
    expect(isNapCatUserFile('plugins/builtin/package.json')).toBe(false)
    expect(isNapCatUserFile('napcat/plugins/builtin-custom/index.mjs')).toBe(true)
    expect(isNapCatUserFile('napcat/config/plugins/napcat-plugin-builtin/config.json')).toBe(true)
  })

  it('旧多参数内置插件阻止启动，当前 ctx/event 接口可以使用', () => {
    program(directory)
    write(
      directory,
      'napcat/plugins/builtin/index.mjs',
      'const plugin_onmessage = async (adapter, core, obCtx, event, actions, instance) => {};',
    )
    expect(getNapCatBuiltinProblem(directory)).toContain('旧事件接口')
    expect(() => prepareNapCatNodeInstallation(directory)).toThrow('旧事件接口')
    write(
      directory,
      'napcat/plugins/builtin/index.mjs',
      'const plugin_init = async (ctx) => {}; const plugin_onmessage = async (ctx, event) => {};',
    )
    expect(getNapCatBuiltinProblem(directory)).toBeNull()
    expect(prepareNapCatNodeInstallation(directory).version).toBe('9.9.31-49738')
  })

  it('附加补丁无法识别布局时保留有效程序，不再错误阻止启动', () => {
    program(directory)
    const core = 'const Vu = typeof sQ < "u" && "4.18.38" || "1.0.0-dev";'
    write(directory, 'napcat/napcat.mjs', core)
    const installation = prepareNapCatNodeInstallation(directory)
    expect(installation.runtimeRepaired).toBe(false)
    expect(installation.runtimeRepairWarning).toContain('未应用 NapCat 附加修复')
    expect(installation.entry).toBe('index.js')
    expect(fs.readFileSync(path.join(directory, 'napcat/napcat.mjs'), 'utf8')).toBe(core)
  })

  it('拒绝指向安装目录之外的目录链接', () => {
    const source = path.join(directory, '发行包')
    const destination = path.join(directory, '已有安装')
    const outside = path.join(directory, '其他目录')
    program(source)
    fs.mkdirSync(destination)
    fs.mkdirSync(outside)
    fs.symlinkSync(
      outside,
      path.join(destination, 'napcat'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    expect(() => copyNapCatProgramFiles(source, destination)).toThrow('越界链接')
    expect(fs.existsSync(path.join(outside, 'napcat.mjs'))).toBe(false)
  })
})
