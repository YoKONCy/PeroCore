import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getDataDir, getPackagesDir } from '@infos/backend/lib/env'

const originalDataDir = process.env.PERO_DATA_DIR
const originalPackagesDir = process.env.PERO_PACKAGES_DIR

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.PERO_DATA_DIR
  else process.env.PERO_DATA_DIR = originalDataDir
  if (originalPackagesDir === undefined) delete process.env.PERO_PACKAGES_DIR
  else process.env.PERO_PACKAGES_DIR = originalPackagesDir
})

describe('物理数据目录保护', () => {
  it('应拒绝把逻辑路径别名当成物理数据目录', () => {
    process.env.PERO_DATA_DIR = '@data'
    expect(() => getDataDir()).toThrow('不能使用逻辑路径别名')
  })

  it('应将明确的相对路径规范化为绝对路径', () => {
    process.env.PERO_DATA_DIR = '.test-data'
    expect(getDataDir()).toBe(path.resolve('.test-data'))
  })

  it('Package 默认安装到数据目录下的 packages', () => {
    process.env.PERO_DATA_DIR = '.test-data'
    delete process.env.PERO_PACKAGES_DIR
    expect(getPackagesDir()).toBe(path.join(path.resolve('.test-data'), 'packages'))
  })
})
