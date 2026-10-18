import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll } from 'vitest'

// DOM 环境会把 import.meta.url 改写为 HTTP 地址，临时根目录由 Node 配置统一提供。
const root = process.env.INFOS_TEST_TEMP_ROOT
if (!root || !path.isAbsolute(root)) throw new Error('测试运行缺少绝对临时目录配置')
mkdirSync(root, { recursive: true })
const directory = mkdtempSync(path.join(root, 'test-runtime-'))
process.env.PERO_DATA_DIR = directory
afterAll(() => {
  const relative = path.relative(root, directory)
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    rmSync(directory, { recursive: true, force: true })
})
