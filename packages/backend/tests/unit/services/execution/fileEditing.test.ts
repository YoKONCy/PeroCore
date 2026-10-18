import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { VirtualWorkspace } from '../../../../src/services/execution/virtualWorkspace'
import {
  createDefaultSandboxProfile,
  type ExecutionSession,
} from '../../../../src/services/execution/executionSession'
import {
  applyFileEdits,
  createReadReference,
  fileEditOwner,
  prepareFileEditArguments,
  releaseFileEditReferences,
  fileEditPreviewReference,
} from '../../../../src/services/execution/fileEditing'

describe('文件版本引用与单文件批次', () => {
  let root: string, session: ExecutionSession
  const workspace = new VirtualWorkspace()
  beforeEach(async () => {
    const temporary = fileURLToPath(new URL('../../../../../../TEMP/', import.meta.url))
    await mkdir(temporary, { recursive: true })
    root = await mkdtemp(path.join(temporary, 'file-edit-'))
    session = {
      id: root,
      ownerAgentId: 'pero',
      threadId: 'thread',
      channel: 'desktop',
      workspaceRoot: root,
      sandboxProfile: createDefaultSandboxProfile('workspace-write', root),
      state: 'active',
      createdAt: '',
      lastActiveAt: '',
    }
  })
  afterEach(async () => {
    releaseFileEditReferences({ threadId: 'thread' })
    await rm(root, { recursive: true, force: true })
  })

  it('流式预览引用仍校验会话归属，返回的位置副本不能修改真实编辑范围', async () => {
    const file = path.join(root, 'preview.txt')
    await writeFile(file, '甲\n乙\n丙\n')
    const read = await workspace.read(session, file, { lineStart: 2, lineEnd: 2 })
    const owner = fileEditOwner(session)
    const ref = createReadReference(owner, file, read)!
    expect(() => fileEditPreviewReference(ref, '其他会话')).toThrow('不属于')
    const preview = fileEditPreviewReference(ref, owner)
    expect(preview).toMatchObject({ path: file, hash: read.hash, lines: { start: 2, end: 2 } })
    preview.lines!.end = 3
    expect(fileEditPreviewReference(ref, owner).lines?.end).toBe(2)
    expect(await readFile(file, 'utf8')).toBe('甲\n乙\n丙\n')
  })

  it('引用编辑不重发旧正文，并保持 BOM 与 CRLF', async () => {
    const file = path.join(root, 'a.txt')
    await writeFile(file, '\uFEFF甲\r\n乙\r\n丙\r\n')
    const read = await workspace.read(session, file, { lineStart: 2, lineEnd: 2 })
    const owner = fileEditOwner(session)
    const ref = createReadReference(owner, file, read)
    await applyFileEdits(workspace, session, { read_ref: ref, new_text: '新乙' }, { owner })
    expect(await readFile(file, 'utf8')).toBe('\uFEFF甲\r\n新乙\r\n丙\r\n')
    await expect(
      applyFileEdits(workspace, session, { read_ref: ref, new_text: '旧引用' }, { owner }),
    ).rejects.toThrow('版本')
    expect(() => prepareFileEditArguments({ read_ref: ref, new_text: '越权' }, '其他会话')).toThrow(
      '不属于',
    )
  })

  it('批量行号基于原版本，失败整批不写', async () => {
    const file = path.join(root, 'a.txt')
    await writeFile(file, '甲\n乙\n丙\n丁\n')
    const { hash } = await workspace.read(session, file)
    const owner = fileEditOwner(session)
    await applyFileEdits(
      workspace,
      session,
      {
        path: file,
        expected_hash: hash,
        steps: [
          { line_start: 1, new_text: '甲一\n甲二' },
          { line_start: 4, new_text: '丁新' },
        ],
      },
      { owner },
    )
    expect(await readFile(file, 'utf8')).toBe('甲一\n甲二\n乙\n丙\n丁新\n')
    const current = await readFile(file, 'utf8')
    await expect(
      applyFileEdits(
        workspace,
        session,
        {
          path: file,
          steps: [
            { old_text: '甲一', new_text: '修改' },
            { old_text: '不存在', new_text: '' },
          ],
        },
        { owner },
      ),
    ).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe(current)
  })

  it('歧义选择复用原编辑，不能改变内容或绕过新版本', async () => {
    const file = path.join(root, 'a.txt')
    await writeFile(file, '重复\n重复\n')
    const owner = fileEditOwner(session)
    const pending = await applyFileEdits(
      workspace,
      session,
      { path: file, old_text: '重复', new_text: '第二处' },
      { owner },
    )
    if (pending.success) throw new Error('应返回候选')
    expect(pending.candidates).toHaveLength(2)
    expect(() =>
      prepareFileEditArguments({ ticket_id: pending.ticketId, pick: 2, new_text: '篡改' }, owner),
    ).toThrow()
    const prepared = prepareFileEditArguments({ ticket_id: pending.ticketId, pick: 2 }, owner)
    await applyFileEdits(workspace, session, prepared, { owner })
    expect(await readFile(file, 'utf8')).toBe('重复\n第二处\n')
  })

  it('内置并行写入在同一旧版本下只能成功一次', async () => {
    const file = path.join(root, 'a.txt')
    await writeFile(file, '原文')
    const { hash } = await workspace.read(session, file)
    const outcomes = await Promise.allSettled(
      ['一', '二'].map((content) =>
        workspace.write(session, { path: file, content, expectedHash: hash }),
      ),
    )
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(['一', '二']).toContain(await readFile(file, 'utf8'))
  })
})
