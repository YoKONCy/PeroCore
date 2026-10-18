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
const percent = (v: number | null) => (v === null ? '未提供' : `${Math.round(v)}%`)

/** 同一份文档用于本地预览和 Electron 图片输出，所有动态文本均转义。 */
export function statusCardDocument(
  design: StatusCardDesign,
  s: StatusCardSnapshot,
  fontSource?: string,
): string {
  const d = parseStatusCardDesign(design)
  const dark = d.theme === 'dark'
  const accent = { sky: '#28b8eb', pink: '#ed74b2', mint: '#36b899', amber: '#e7ad3f' }[d.accent]
  const bar = (v: number | null) =>
    v === null
      ? ''
      : `<div class="track"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>`
  const tile = (label: string, value: string, detail: string, p: number | null = null) =>
    `<section><h2>${label}</h2><strong>${escapeHtml(value)}</strong><p>${escapeHtml(detail)}</p>${bar(p)}</section>`
  const states: Record<string, string> = {
    queued: '排队中',
    running: '运行中',
    paused: '已暂停',
    waiting: '等待条件',
    waiting_input: '等待输入',
    blocked: '需要处理',
  }
  const sections = d.sections
    .map((section) => {
      if (section === 'cpu')
        return tile(
          'CPU',
          percent(s.cpu.percent),
          `${s.cpu.model} · ${s.cpu.cores} 核心`,
          s.cpu.percent,
        )
      if (section === 'memory') {
        const p = s.memory.totalBytes > 0 ? (s.memory.usedBytes / s.memory.totalBytes) * 100 : null
        return tile('内存', percent(p), `${gb(s.memory.usedBytes)} / ${gb(s.memory.totalBytes)}`, p)
      }
      if (section === 'gpu')
        return s.gpu
          ? tile(
              'GPU',
              percent(s.gpu.percent),
              `${s.gpu.name}${s.gpu.totalBytes !== null && s.gpu.usedBytes !== null ? ` · 显存 ${gb(s.gpu.usedBytes)} / ${gb(s.gpu.totalBytes)}` : ''}`,
              s.gpu.percent,
            )
          : tile('GPU', '未提供', '设备未提供 GPU 指标')
      if (section === 'disk') {
        const p =
          s.disk && s.disk.totalBytes > 0 ? (s.disk.usedBytes / s.disk.totalBytes) * 100 : null
        return tile(
          '系统盘',
          percent(p),
          s.disk ? `${gb(s.disk.usedBytes)} / ${gb(s.disk.totalBytes)}` : '设备未提供磁盘指标',
          p,
        )
      }
      return `<section class="tasks"><h2>助手任务</h2>${s.tasks.length ? s.tasks.map((t) => `<div class="task"><span>${escapeHtml(t.title)}</span><b>${escapeHtml(states[t.status] ?? t.status)}</b></div>`).join('') : '<p>暂无进行中的任务</p>'}</section>`
    })
    .join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data: file: http: https:; img-src data:"><style>
  ${fontSource ? `@font-face{font-family:Zpix;src:url("${escapeHtml(fontSource)}")}` : ''}
  *{box-sizing:border-box}html,body{margin:0}body{padding:18px;background:${dark ? '#111b26' : '#e8f4fb'};color:${dark ? '#e1edf5' : '#29445a'};font:16px/1.6 Zpix,monospace;--accent:${accent};--edge:${dark ? '#354656' : '#b1cad9'};--shine:${dark ? '#526274' : '#ffffff'};--shade:${dark ? '#09111c' : '#9eb9ca'}}
  article{padding:24px;border:1px solid var(--edge);background:${dark ? '#1a2735' : '#f4faff'};box-shadow:inset 1px 1px var(--shine),inset -1px -2px var(--shade),0 3px var(--shade)}
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:1px dashed var(--edge);padding-bottom:18px}h1{font-size:26px;margin:0;color:var(--accent)}h2{font-size:14px;color:var(--accent);margin:0 0 8px}p{font-size:13px;opacity:.8;margin:6px 0 0;overflow-wrap:anywhere}.device{margin-top:4px}.tag{border:1px solid var(--edge);padding:3px 8px;white-space:nowrap;font-size:12px}
  main{display:grid;grid-template-columns:${d.layout === 'grid' ? 'repeat(2,minmax(0,1fr))' : 'minmax(0,1fr)'};gap:14px;margin-top:20px}section{min-width:0;padding:16px;border:1px solid var(--edge);box-shadow:inset 1px 1px var(--shine),0 2px var(--shade);background:${dark ? '#16212e' : '#eaf5fc'}}strong{font-size:30px;line-height:1.3}.track{height:8px;background:var(--shade);margin-top:12px}.track i{display:block;height:100%;background:repeating-linear-gradient(90deg,var(--accent) 0 8px,transparent 8px 10px)}.tasks{grid-column:1/-1}.task{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px dashed var(--edge);font-size:14px}.task span{overflow-wrap:anywhere}.task b{white-space:nowrap;color:var(--accent);font-size:12px;font-weight:normal}footer{display:flex;justify-content:space-between;gap:12px;margin-top:18px;font-size:11px;opacity:.65}
  </style></head><body><article><header><div><h1>${escapeHtml(d.title)}</h1><p class="device">${escapeHtml(s.deviceName)} · ${escapeHtml(s.platform)}</p></div><span class="tag">运行 ${Math.floor(s.uptimeSeconds / 3600)}h ${Math.floor((s.uptimeSeconds % 3600) / 60)}m</span></header><main>${sections}</main><footer><span>infOS · 设备快照</span><span>${escapeHtml(s.capturedAt)}</span></footer></article></body></html>`
}
