import type { EventNote, FactRecord } from '@infos/shared'

export type ArchiveEditTarget =
  | { kind: 'memory'; note: EventNote }
  | { kind: 'fact'; fact: FactRecord }

export type ArchiveEditSaved = ArchiveEditTarget

/** 一行一项，避免名称中的逗号被拆开；提交前去空与去重。 */
export function parseArchiveTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}
