import { existsSync, lstatSync, readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import type { PathResolver } from '../../core/pathResolver'

/** 清理已学习的检索权重及隐状态；只删除受管目录中的已知文件，不递归删除目录。 */
export function forgetRetrievalState(paths: PathResolver): void {
  const root = path.resolve(paths.resolve('@data'))
  if (!existsSync(root)) return
  for (const directory of readdirSync(root, { withFileTypes: true })) {
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      !/^(?:agent_.+|shared)$/.test(directory.name)
    )
      continue
    const target = path.resolve(root, directory.name)
    const relative = path.relative(root, target)
    if (
      !relative ||
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      lstatSync(target).isSymbolicLink()
    )
      throw new Error('检索状态目录不在受管范围内')
    for (const file of readdirSync(target, { withFileTypes: true })) {
      if (!file.isFile() || !/^rnn_[\w.-]+\.bin$/.test(file.name)) continue
      unlinkSync(path.join(target, file.name))
    }
  }
}
