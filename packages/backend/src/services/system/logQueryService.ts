import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { getLogFileTransport } from '../../lib/logger'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 运维日志文件查询服务。 */
export class LogQueryService {
  list() {
    const transport = getLogFileTransport()
    if (!transport) return null
    const logDir = transport.getLogDir()
    const files = readdirSync(logDir)
      .filter((file) => file.endsWith('.log'))
      .map((file) => {
        const stat = statSync(path.join(logDir, file))
        return {
          name: file,
          size: formatBytes(stat.size),
          sizeBytes: stat.size,
          modified: stat.mtime.toISOString(),
        }
      })
      .sort((left, right) => right.modified.localeCompare(left.modified))
    return { logDir, currentFile: path.basename(transport.getLogPath()), files }
  }

  read(filename: string, tail: number) {
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return null
    const transport = getLogFileTransport()
    if (!transport) return null
    const logDir = transport.getLogDir()
    const filePath = path.join(logDir, filename)
    if (!filePath.startsWith(logDir)) return null
    const stat = statSync(filePath)
    const allLines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)
    const lines = tail > 0 ? allLines.slice(-tail) : allLines
    return {
      filename,
      size: formatBytes(stat.size),
      totalLines: allLines.length,
      returnedLines: lines.length,
      lines,
    }
  }
}
