export type LaunchFailureStage = 'backend' | 'agreement' | 'launch'

export interface LaunchDiagnostic {
  stage: LaunchFailureStage
  error: string
  logTail: string
  logPath: string
  createdAt: string
}

const escape = String.fromCharCode(27)
const bell = String.fromCharCode(7)
const csi = String.fromCharCode(155)
const terminalStyles = new RegExp(`(?:${escape}\\[|${csi})[0-?]*[ -/]*[@-~]`, 'g')
const terminalTitles = new RegExp(`${escape}\\][^${escape}${bell}]*(?:${bell}|${escape}\\\\)`, 'g')

/** IPC 与异常文本只作为限长纯文本诊断，终端控制符不能进入用户提示。 */
export function cleanLaunchDiagnostic(value: unknown, limit = 12_000): string {
  if (typeof value !== 'string') return ''
  return Array.from(
    value
      .slice(-24_000)
      .replace(terminalTitles, '')
      .replace(terminalStyles, '')
      .replace(/\r\n?/g, '\n'),
  )
    .filter((char) => {
      const code = char.charCodeAt(0)
      return char === '\n' || char === '\t' || (code >= 32 && (code < 127 || code > 159))
    })
    .join('')
    .trim()
    .slice(-limit)
}

export function createLaunchDiagnostic(
  stage: LaunchFailureStage,
  error: unknown,
  logTail?: unknown,
  logPath?: unknown,
): LaunchDiagnostic {
  return {
    stage,
    error: cleanLaunchDiagnostic(error instanceof Error ? error.message : error, 2000),
    logTail: cleanLaunchDiagnostic(logTail),
    logPath: cleanLaunchDiagnostic(logPath, 1000),
    createdAt: new Date().toISOString(),
  }
}
