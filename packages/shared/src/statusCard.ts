import { getLocale, translate, type AppLocale } from './i18n'
import './i18n/catalogs/statusCard'

/** 社交状态卡片的受控设计与设备快照；不接受脚本、远程资源或模型生成的指标。 */
export const STATUS_CARD_SECTIONS = ['cpu', 'memory', 'gpu', 'disk', 'tasks'] as const
export type StatusCardSection = (typeof STATUS_CARD_SECTIONS)[number]
export interface StatusCardDesign {
  title: string
  theme: 'light' | 'dark'
  accent: 'sky' | 'pink' | 'mint' | 'amber'
  layout: 'grid' | 'stack'
  sections: StatusCardSection[]
}
export const DEFAULT_STATUS_CARD_DESIGN: StatusCardDesign = {
  title: '设备状态',
  theme: 'dark',
  accent: 'sky',
  layout: 'grid',
  sections: ['cpu', 'memory', 'gpu', 'disk', 'tasks'],
}
export interface StatusCardSnapshot {
  capturedAt: string
  deviceName: string
  platform: string
  uptimeSeconds: number
  cpu: { model: string; cores: number; percent: number | null }
  memory: { totalBytes: number; usedBytes: number }
  gpu: {
    name: string
    percent: number | null
    usedBytes: number | null
    totalBytes: number | null
  } | null
  disk: { totalBytes: number; usedBytes: number } | null
  tasks: Array<{ title: string; status: string }>
}
export interface StatusCardImage {
  imageBase64: string
  mimeType: 'image/png'
  snapshot: StatusCardSnapshot
}
export interface SocialStatusCardPort {
  render(agentId: string, design: StatusCardDesign): Promise<StatusCardImage>
}

export function parseStatusCardDesign(value: unknown): StatusCardDesign {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('卡片设计格式无效')
  const v = value as Record<string, unknown>
  if (typeof v.title !== 'string' || !v.title.trim() || v.title.trim().length > 32)
    throw new Error('卡片标题应为 1–32 个字符')
  if (v.theme !== 'light' && v.theme !== 'dark') throw new Error('卡片主题无效')
  if (typeof v.accent !== 'string' || !['sky', 'pink', 'mint', 'amber'].includes(v.accent))
    throw new Error('卡片配色无效')
  if (v.layout !== 'grid' && v.layout !== 'stack') throw new Error('卡片布局无效')
  if (
    !Array.isArray(v.sections) ||
    !v.sections.length ||
    v.sections.length > 5 ||
    v.sections.some((s) => !STATUS_CARD_SECTIONS.includes(s as StatusCardSection)) ||
    new Set(v.sections).size !== v.sections.length
  )
    throw new Error('请选择不重复的卡片项目')
  return {
    title: v.title.trim(),
    theme: v.theme,
    accent: v.accent as StatusCardDesign['accent'],
    layout: v.layout,
    sections: [...v.sections] as StatusCardSection[],
  }
}

const escapeHtml = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const gb = (v: number) => `${(v / 1024 ** 3).toFixed(1)} GB`

const metricIcons = {
  cpu: 'M6 6h12v12H6z M9 2v4 M15 2v4 M9 18v4 M15 18v4 M2 9h4 M2 15h4 M18 9h4 M18 15h4 M10 10h4v4h-4z',
  memory: 'M3 7h18v10H3z M7 10v4 M11 10v4 M15 10v4 M6 17v3 M10 17v3 M14 17v3 M18 17v3',
  gpu: 'M3 6h17v12H3z M7 18v3 M11 18v3 M21 10h2 M21 14h2 M13 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  disk: 'M5 3h14l3 15v3H2v-3z M3 15h18 M6 18h.01 M10 18h.01',
  tasks: 'M9 5h12 M9 12h12 M9 19h12 M3 5h1 M3 12h1 M3 19h1',
  desktop: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  clock: 'M12 8v4l3 2 M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0',
} as const
const cardIcon = (name: keyof typeof metricIcons) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${metricIcons[name]}"/></svg>`

/** 预览和图片输出共用布局；正文使用系统无衬线字体，像素字体只用于底部署名。所有动态文本均转义。 */
export function statusCardDocument(
  design: StatusCardDesign,
  s: StatusCardSnapshot,
  fontSource?: string,
  language: AppLocale = getLocale(),
): string {
  const d = parseStatusCardDesign(design)
  const dark = d.theme === 'dark'
  const text = (source: string, parameters: readonly unknown[] = []) =>
    translate('common.status-card', source, parameters, language)
  const accent = {
    sky: dark ? '#67c9f1' : '#1786b5',
    pink: dark ? '#eda1c7' : '#be4a85',
    mint: dark ? '#72d4b8' : '#16896c',
    amber: dark ? '#edc17b' : '#a56a12',
  }[d.accent]
  const bar = (v: number | null) =>
    `<div class="track${v === null ? ' is-unavailable' : ''}"><i style="width:${v === null ? 0 : Math.max(0, Math.min(100, v))}%"></i></div>`
  const tile = (kind: StatusCardSection, label: string, value: number | null, detail: string) =>
    `<section class="metric"><div class="metric-heading"><span class="metric-icon">${cardIcon(kind)}</span><h2>${escapeHtml(label)}</h2></div><div class="metric-value${value === null ? ' is-unavailable' : ''}">${value === null ? escapeHtml(text('未提供')) : `${Math.round(value)}<span>%</span>`}</div><p class="metric-detail">${escapeHtml(detail)}</p>${bar(value)}</section>`
  const states: Record<string, string> = {
    queued: text('排队中'),
    running: text('运行中'),
    paused: text('已暂停'),
    waiting: text('等待条件'),
    waiting_input: text('等待输入'),
    blocked: text('需要处理'),
  }
  const sections = d.sections
    .map((section) => {
      if (section === 'cpu')
        return tile('cpu', 'CPU', s.cpu.percent, text('{0} · {1} 核心', [s.cpu.model, s.cpu.cores]))
      if (section === 'memory') {
        const p = s.memory.totalBytes > 0 ? (s.memory.usedBytes / s.memory.totalBytes) * 100 : null
        return tile(
          'memory',
          text('内存'),
          p,
          `${gb(s.memory.usedBytes)} / ${gb(s.memory.totalBytes)}`,
        )
      }
      if (section === 'gpu')
        return s.gpu
          ? tile(
              'gpu',
              'GPU',
              s.gpu.percent,
              s.gpu.totalBytes !== null && s.gpu.usedBytes !== null
                ? text('{0} · 显存 {1} / {2}', [
                    s.gpu.name,
                    gb(s.gpu.usedBytes),
                    gb(s.gpu.totalBytes),
                  ])
                : s.gpu.name,
            )
          : tile('gpu', 'GPU', null, text('设备未提供 GPU 指标'))
      if (section === 'disk') {
        const p =
          s.disk && s.disk.totalBytes > 0 ? (s.disk.usedBytes / s.disk.totalBytes) * 100 : null
        return tile(
          'disk',
          text('系统盘'),
          p,
          s.disk
            ? `${gb(s.disk.usedBytes)} / ${gb(s.disk.totalBytes)}`
            : text('设备未提供磁盘指标'),
        )
      }
      return `<section class="tasks"><div class="tasks-heading"><span class="metric-icon">${cardIcon('tasks')}</span><h2>${escapeHtml(text('助手任务'))}</h2><span class="task-count">${s.tasks.length}</span></div>${s.tasks.length ? s.tasks.map((task) => `<div class="task"><span class="task-title">${escapeHtml(task.title)}</span><span class="task-state${task.status === 'running' ? ' is-running' : ''}"><i></i>${escapeHtml(states[task.status] ?? task.status)}</span></div>`).join('') : `<p class="tasks-empty">${escapeHtml(text('暂无进行中的任务'))}</p>`}</section>`
    })
    .join('')
  const title = d.title === DEFAULT_STATUS_CARD_DESIGN.title ? text('设备状态') : d.title
  const uptime = text('运行 {0}h {1}m', [
    Math.floor(s.uptimeSeconds / 3600),
    Math.floor((s.uptimeSeconds % 3600) / 60),
  ])
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data: file: http: https:; img-src data:"><style>
  ${fontSource ? `@font-face{font-family:Zpix;src:url("${escapeHtml(fontSource)}");font-display:swap}` : ''}
  *{box-sizing:border-box}html,body{margin:0}body{padding:20px;background:${dark ? '#101219' : '#edf1f7'};color:${dark ? '#edf0f8' : '#20283a'};font:14px/1.6 'Segoe UI','Microsoft YaHei','PingFang SC',system-ui,sans-serif;--accent:${accent};--muted:${dark ? '#929bb0' : '#738097'};--edge:${dark ? '#2e3445' : '#dce3ed'};--surface:${dark ? '#1c202c' : '#ffffff'};--track:${dark ? '#10141e' : '#e9eef5'}}
  svg{display:block;width:20px;height:20px;flex-shrink:0}article{position:relative;max-width:880px;margin:auto;padding:24px;border:1px solid var(--edge);border-radius:16px;background:linear-gradient(135deg,${dark ? '#1b1f2c,#151822' : '#ffffff,#f7f9fd'});box-shadow:0 10px 28px ${dark ? '#00000024' : '#283c6210'}}article:before{content:'';position:absolute;top:0;left:24px;width:48px;height:3px;border-radius:0 0 3px 3px;background:var(--accent)}
  header{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-bottom:20px;border-bottom:1px solid var(--edge)}.identity{display:flex;align-items:center;gap:12px;min-width:0}.device-icon{display:grid;place-items:center;flex:0 0 42px;height:42px;border:1px solid color-mix(in srgb,var(--accent) 25%,var(--edge));border-radius:11px;background:color-mix(in srgb,var(--accent) 8%,transparent);color:var(--accent)}.device-icon svg{width:23px;height:23px}h1{margin:0;font-size:23px;font-weight:650;letter-spacing:.01em;line-height:1.4;overflow-wrap:anywhere}.device{margin:5px 0 0;color:var(--muted);font-size:11px;overflow-wrap:anywhere}.uptime{display:flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid var(--edge);border-radius:6px;white-space:nowrap;color:var(--muted);font-size:10px;font-variant-numeric:tabular-nums}.uptime svg{width:13px;height:13px}
  main{display:grid;grid-template-columns:${d.layout === 'grid' ? 'repeat(2,minmax(0,1fr))' : 'minmax(0,1fr)'};gap:12px;margin-top:20px}section{min-width:0;padding:16px;border:1px solid var(--edge);border-radius:10px;background:var(--surface)}.metric-heading,.tasks-heading{display:flex;align-items:center;gap:8px}.metric-icon{display:grid;place-items:center;width:27px;height:27px;border-radius:6px;color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent)}.metric-icon svg{width:16px;height:16px}h2{font-size:12px;font-weight:600;margin:0;color:${dark ? '#ccd3e3' : '#4a566c'}}.metric-value{margin-top:10px;font-size:36px;font-weight:600;line-height:1.1;letter-spacing:-.04em;font-variant-numeric:tabular-nums}.metric-value span{margin-left:3px;font-size:17px;letter-spacing:0;color:var(--muted);font-weight:400}.metric-value.is-unavailable{font-size:20px;line-height:1.98;color:var(--muted);letter-spacing:0}.metric-detail{min-height:32px;margin:9px 0 0;font-size:10px;line-height:1.6;color:var(--muted);overflow-wrap:anywhere}.track{height:4px;background:var(--track);margin-top:10px;border-radius:4px;overflow:hidden}.track i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 65%,transparent),var(--accent))}.track.is-unavailable{opacity:.45}
  .tasks{grid-column:1/-1;padding-bottom:10px}.tasks-heading{margin-bottom:10px}.task-count{margin-left:auto;min-width:22px;padding:0 6px;border:1px solid var(--edge);border-radius:4px;color:var(--muted);font-size:10px;text-align:center;font-variant-numeric:tabular-nums}.task{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:10px 0;border-top:1px solid var(--edge);font-size:12px}.task-title{overflow-wrap:anywhere}.task-state{display:inline-flex;align-items:center;flex-shrink:0;gap:5px;font-size:10px;color:var(--muted)}.task-state i{width:5px;height:5px;border-radius:50%;background:currentColor}.task-state.is-running{color:var(--accent)}.tasks-empty{margin:0;padding:8px 0 5px;color:var(--muted);font-size:12px}footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:18px;font-size:10px;color:var(--muted)}.signature{display:flex;align-items:center;gap:7px;white-space:nowrap}.signature i{width:6px;height:6px;border-radius:2px;background:var(--accent)}.capture-time{text-align:right;overflow-wrap:anywhere}
  .signature{font-family:Zpix,'Segoe UI','Microsoft YaHei',sans-serif}
  @media(max-width:480px){body{padding:12px}article{padding:16px;border-radius:12px}header{align-items:flex-start;gap:10px;flex-wrap:wrap}h1{font-size:20px}.device-icon{flex-basis:34px;height:34px;border-radius:8px}.uptime{margin-left:46px}main{gap:10px;margin-top:16px}section{padding:12px}.metric-value{font-size:30px}.metric-detail{font-size:10px}footer{align-items:flex-start;flex-wrap:wrap}}
  </style></head><body><article><header><div class="identity"><span class="device-icon">${cardIcon('desktop')}</span><div><h1>${escapeHtml(title)}</h1><p class="device">${escapeHtml(s.deviceName)} · ${escapeHtml(s.platform)}</p></div></div><span class="uptime">${cardIcon('clock')}${escapeHtml(uptime)}</span></header><main>${sections}</main><footer><span class="signature"><i></i>${escapeHtml(text('infOS · 设备快照'))}</span><span class="capture-time">${escapeHtml(s.capturedAt)}</span></footer></article></body></html>`
}
