import type { DocumentNodeId } from './types'
import { officeChildren, runsOf, setNodeRuns, type OfficeContent, type OfficeNode } from './office'

export interface OfficeCellPosition {
  node: OfficeNode
  row: number
  column: number
  rowspan: number
  colspan: number
}
/** 根据跨度构造逻辑网格；结构修改不依赖浏览器临时生成的表格 DOM。 */
export function officeTableGrid(content: OfficeContent, tableId: string) {
  const rows = officeChildren(content, tableId),
    grid: Array<Array<OfficeCellPosition | undefined>> = rows.map(() => []),
    positions: OfficeCellPosition[] = []
  for (let row = 0; row < rows.length; row++) {
    let column = 0
    for (const node of officeChildren(content, rows[row]!.nodeId)) {
      while (grid[row]![column]) column++
      const rowspan = Number(node.attributes.rowspan ?? 1),
        colspan = Number(node.attributes.colspan ?? 1)
      if (
        !Number.isInteger(rowspan) ||
        !Number.isInteger(colspan) ||
        rowspan < 1 ||
        colspan < 1 ||
        row + rowspan > rows.length ||
        column + colspan > 30
      )
        throw new Error('表格跨度无效或超过 30 列')
      const position = { node, row, column, rowspan, colspan }
      positions.push(position)
      for (let r = row; r < row + rowspan; r++)
        for (let c = column; c < column + colspan; c++) {
          if (grid[r]![c]) throw new Error('表格单元格重叠')
          grid[r]![c] = position
        }
      column += colspan
    }
  }
  const width = Math.max(0, ...grid.map((row) => row.length))
  if (
    !rows.length ||
    !width ||
    rows.length > 1000 ||
    grid.some(
      (row) =>
        row.length !== width ||
        Array.from({ length: width }, (_, index) => row[index]).some((cell) => !cell),
    )
  )
    throw new Error('表格必须是完整矩形，且不能超过 1000 行')
  return { rows, grid, positions, width }
}

export type OfficeTableAction =
  | 'row'
  | 'column'
  | 'delete-row'
  | 'delete-column'
  | 'merge-right'
  | 'merge-down'
  | 'split'
export function editOfficeTable(
  content: OfficeContent,
  cellId: string,
  action: OfficeTableAction,
  id: () => string,
): void {
  const cell = content.nodes.find((node) => node.nodeId === cellId),
    row = content.nodes.find((node) => node.nodeId === cell?.parentId),
    table = content.nodes.find((node) => node.nodeId === row?.parentId)
  if (cell?.type !== 'table-cell' || row?.type !== 'table-row' || table?.type !== 'table')
    throw new Error('请先选择一个表格单元格')
  const { rows, positions, grid, width } = officeTableGrid(content, table.nodeId),
    current = positions.find((position) => position.node.nodeId === cellId)!
  const widths = Array.from({ length: width }, (_, index) =>
    Array.isArray(table.attributes.columnWidths)
      ? Math.max(24, Math.min(1600, Number(table.attributes.columnWidths[index]) || 120))
      : 120,
  )
  const removed = new Set<string>()
  const create = (r: number, c: number): OfficeCellPosition => {
    const node: OfficeNode = {
      nodeId: id() as DocumentNodeId,
      type: 'table-cell',
      parentId: rows[r]!.nodeId,
      orderKey: String(c).padStart(10, '0'),
      text: '',
      attributes: {},
    }
    content.nodes.push(node)
    const position = { node, row: r, column: c, rowspan: 1, colspan: 1 }
    positions.push(position)
    return position
  }
  if (action === 'merge-right' || action === 'merge-down') {
    const other =
      action === 'merge-right'
        ? grid[current.row]?.[current.column + current.colspan]
        : grid[current.row + current.rowspan]?.[current.column]
    if (
      !other ||
      (action === 'merge-right'
        ? other.row !== current.row || other.rowspan !== current.rowspan
        : other.column !== current.column || other.colspan !== current.colspan)
    )
      throw new Error('相邻单元格跨度不一致，无法合并为矩形')
    setNodeRuns(cell, [
      ...runsOf(cell),
      ...(cell.text && other.node.text ? [{ text: '\n' }] : []),
      ...runsOf(other.node),
    ])
    if (action === 'merge-right') current.colspan += other.colspan
    else current.rowspan += other.rowspan
    removed.add(other.node.nodeId)
  } else if (action === 'split') {
    const { row, column, rowspan, colspan } = current
    current.rowspan = 1
    current.colspan = 1
    for (let r = row; r < row + rowspan; r++)
      for (let c = column; c < column + colspan; c++) if (r !== row || c !== column) create(r, c)
  } else if (action === 'row') {
    if (rows.length >= 1000) throw new Error('表格最多支持 1000 行')
    const at = current.row + current.rowspan
    const next: OfficeNode = {
      nodeId: id() as DocumentNodeId,
      parentId: table.nodeId,
      type: 'table-row',
      orderKey: '',
      attributes: {},
    }
    content.nodes.push(next)
    rows.splice(at, 0, next)
    const occupied = new Set<number>()
    for (const position of positions) {
      if (position.row < at && position.row + position.rowspan > at) {
        position.rowspan++
        for (let c = position.column; c < position.column + position.colspan; c++) occupied.add(c)
      } else if (position.row >= at) position.row++
    }
    for (let c = 0; c < width; c++) if (!occupied.has(c)) create(at, c)
  } else if (action === 'column') {
    if (width >= 30) throw new Error('表格最多支持 30 列')
    const at = current.column + current.colspan,
      occupied = new Set<number>()
    widths.splice(at, 0, 120)
    for (const position of positions) {
      if (position.column < at && position.column + position.colspan > at) {
        position.colspan++
        for (let r = position.row; r < position.row + position.rowspan; r++) occupied.add(r)
      } else if (position.column >= at) position.column++
    }
    for (let r = 0; r < rows.length; r++) if (!occupied.has(r)) create(r, at)
  } else if (action === 'delete-row') {
    if (rows.length === 1) {
      removed.add(table.nodeId)
      removed.add(row.nodeId)
      positions.forEach((position) => removed.add(position.node.nodeId))
    } else {
      const at = current.row
      removed.add(rows[at]!.nodeId)
      for (const position of positions) {
        if (position.row === at) {
          if (position.rowspan === 1) removed.add(position.node.nodeId)
          else {
            position.rowspan--
            position.node.parentId = rows[at + 1]!.nodeId
          }
        } else if (position.row < at && position.row + position.rowspan > at) position.rowspan--
        else if (position.row > at) position.row--
      }
      rows.splice(at, 1)
    }
  } else if (action === 'delete-column') {
    widths.splice(current.column, 1)
    if (width === 1) {
      removed.add(table.nodeId)
      rows.forEach((row) => removed.add(row.nodeId))
      positions.forEach((position) => removed.add(position.node.nodeId))
    } else
      for (const position of positions) {
        if (
          position.column <= current.column &&
          position.column + position.colspan > current.column
        ) {
          if (position.colspan === 1) removed.add(position.node.nodeId)
          else position.colspan--
        } else if (position.column > current.column) position.column--
      }
  }
  for (const position of positions) {
    position.node.attributes.colspan = position.colspan
    position.node.attributes.rowspan = position.rowspan
    position.node.orderKey = String(position.column).padStart(10, '0')
  }
  rows.forEach((row, index) => {
    row.orderKey = String(index).padStart(10, '0')
  })
  content.nodes = content.nodes.filter((node) => !removed.has(node.nodeId))
  table.attributes.columnWidths = widths
  if (!removed.has(table.nodeId)) officeTableGrid(content, table.nodeId)
}
