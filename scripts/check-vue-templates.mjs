import { t as __t } from './i18n.mjs'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse } from 'vue/compiler-sfc'

const directories = process.argv.slice(2)
if (directories.length === 0) {
  throw new Error('请指定需要检查的 Vue 组件目录')
}

let componentCount = 0
let errorCount = 0

// 仅解析源码，不生成代码或构建产物；补齐 vue-tsc 未覆盖的模板表达式语法检查。
function checkDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git'].includes(entry.name)) checkDirectory(filename)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.vue')) continue

    componentCount++
    const { errors } = parse(readFileSync(filename, 'utf8'), { filename })
    for (const error of errors) {
      errorCount++
      const location = typeof error === 'string' ? undefined : error.loc?.start
      const position = location ? `:${location.line}:${location.column}` : ''
      const message = typeof error === 'string' ? error : error.message
      console.error(`${relative(process.cwd(), filename)}${position}：${message}`)
    }
  }
}

for (const directory of directories) checkDirectory(directory)

if (errorCount > 0) {
  console.error(
    __t('scripts.check-vue-templates', 'Vue 模板语法检查失败：{0} 个组件，{1} 个错误', [
      componentCount,
      errorCount,
    ]),
  )
  process.exitCode = 1
} else {
  console.log(
    __t('scripts.check-vue-templates', 'Vue 模板语法检查通过：{0} 个组件', [componentCount]),
  )
}
