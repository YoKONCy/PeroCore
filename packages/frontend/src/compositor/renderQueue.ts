/** 富文本解析分批让出主线程，让输入、滚动与首帧先得到处理。 */
import { frontendPerformance } from './performanceBaseline'
const jobs = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

export function queueTextRender(job: () => void): () => void {
  jobs.add(job)
  schedule()
  return () => jobs.delete(job)
}

function schedule(): void {
  if (timer !== undefined || !jobs.size) return
  timer = setTimeout(() => {
    timer = undefined
    const started = performance.now()
    for (const job of jobs) {
      jobs.delete(job)
      const jobStarted = performance.now()
      job()
      frontendPerformance.observe('rich_text_render_ms', performance.now() - jobStarted)
      if (performance.now() - started >= 4) break
    }
    schedule()
  }, 0)
}
