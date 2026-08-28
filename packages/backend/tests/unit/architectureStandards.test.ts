import { readFileSync } from 'node:fs'
import path from 'node:path'
import { globSync } from 'tinyglobby'
import { describe, expect, it } from 'vitest'
import { CODE_MESSAGES } from '@infos/shared'

const root = process.cwd()

function sources(patterns: string[]): Array<{ file: string; content: string }> {
  return globSync(patterns, {
    cwd: root,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**'],
  }).map((file) => ({
    file,
    content: readFileSync(file, 'utf8'),
  }))
}

describe('软件工程架构静态门禁', () => {
  it('Backend Router不得直接依赖Repository、数据库Schema或文件系统', () => {
    const violations = sources(['packages/backend/src/routers/*.router.ts']).flatMap(
      ({ file, content }) =>
        /from ['"].*(repositories|database\/schema)|from ['"]node:fs/.test(content)
          ? [path.relative(root, file)]
          : [],
    )
    expect(violations).toEqual([])
  })

  it('Router必须使用项目级Zod包装器', () => {
    const violations = sources([
      'packages/backend/src/routers/*.router.ts',
      'packages/backend/src/observer/*.router.ts',
    ]).flatMap(({ file, content }) =>
      content.includes("from '@hono/zod-validator'") ? [path.relative(root, file)] : [],
    )
    expect(violations).toEqual([])
  })

  it('Social不得深路径导入Backend内部源码', () => {
    const violations = sources(['packages/apps/social/**/*.ts']).flatMap(({ file, content }) =>
      content.includes('backend/src') ? [path.relative(root, file)] : [],
    )
    expect(violations).toEqual([])
  })

  it('Router字面业务码必须注册，201必须使用CREATED', () => {
    const registered = new Set(Object.keys(CODE_MESSAGES))
    const invalidCodes: string[] = []
    const invalidCreated: string[] = []
    for (const { file, content } of sources([
      'packages/backend/src/**/*.router.ts',
      'packages/apps/social/**/*.router.ts',
    ])) {
      for (const match of content.matchAll(/code:\s*['"]([A-Z][A-Z0-9_]*)['"]/g)) {
        if (!registered.has(match[1]!))
          invalidCodes.push(`${path.relative(root, file)}:${match[1]}`)
      }
      if (/code:\s*['"]OK['"][\s\S]{0,160},\s*201\s*\)/.test(content)) {
        invalidCreated.push(path.relative(root, file))
      }
    }
    expect(invalidCodes).toEqual([])
    expect(invalidCreated).toEqual([])
  })
})
