interface ApplicationWaitingOptions {
  dark: boolean
  applicationName: string
  motion?: 'full' | 'reduced' | 'off'
}

/** 所有样式限制在过渡页内部，避免嵌入外壳时影响业务界面。 */
const waitingStyles = `
    .infos-application-waiting, .infos-application-waiting * { box-sizing: border-box; }
    .infos-application-waiting {
      width: 100%; height: 100%; min-height: 100%; display: grid; place-items: center;
      padding: 28px 20px; overflow-x: hidden; background: var(--background); color: var(--ink);
      font-family: "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .infos-application-waiting .waiting-content { position: relative; isolation: isolate; width: min(100%, 360px); text-align: center; animation: infos-waiting-arrive .7s cubic-bezier(.2,.75,.25,1) both; }
    .infos-application-waiting .waiting-content::before {
      content: ""; position: absolute; z-index: -1; pointer-events: none;
      inset: -52px -48px 14px; border-radius: 50%;
      background: radial-gradient(ellipse, color-mix(in srgb, var(--halo) 10%, transparent), transparent 68%);
    }
    .infos-application-waiting .illustration { display: block; width: min(100%, 300px); height: auto; margin: 0 auto 10px; overflow: visible; }
    .infos-application-waiting .lines { fill: none; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2.3; }
    .infos-application-waiting .window { transform-box: view-box; }
    .infos-application-waiting .cat { transform-box: view-box; transform-origin: 160px 178px; animation: infos-waiting-breathe 4.8s ease-in-out infinite; }
    .infos-application-waiting .eyes { transform-origin: 160px 146px; animation: infos-waiting-blink 6.8s ease-in-out infinite; }
    .infos-application-waiting .tail { transform-box: view-box; transform-origin: 208px 172px; animation: infos-waiting-tail 4.8s cubic-bezier(.45,0,.55,1) infinite; }
    .infos-application-waiting .bubble { transform-box: view-box; animation: infos-waiting-bubble 5.6s ease-in-out infinite; }
    .infos-application-waiting .sparkle { animation: infos-waiting-twinkle 4.8s ease-in-out infinite; }
    .infos-application-waiting .sparkle.late { animation-delay: -2.4s; }
    .infos-application-waiting .trail { stroke-dasharray: 2 8; }
    .infos-application-waiting .shadow { opacity: .08; }
    .infos-application-waiting h1 { margin: 0; font-size: 22px; line-height: 1.5; font-weight: 650; letter-spacing: .025em; }
    .infos-application-waiting .caption { margin: 9px 0 0; font-size: 13px; line-height: 1.8; letter-spacing: .06em; color: var(--muted); }
    .infos-application-waiting .waiting { display: flex; justify-content: center; align-items: center; gap: 7px; height: 28px; margin-top: 16px; }
    .infos-application-waiting .waiting span { width: 4px; height: 4px; border-radius: 50%; background: var(--line); opacity: .4; animation: infos-waiting-pebble 1.8s ease-in-out infinite; }
    .infos-application-waiting .waiting span:nth-child(2) { animation-delay: .18s; background: var(--pink); }
    .infos-application-waiting .waiting span:nth-child(3) { animation-delay: .36s; background: var(--mint); }
    @keyframes infos-waiting-arrive { from { transform: translateY(4px); } to { transform: translateY(0); } }
    @keyframes infos-waiting-breathe { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
    @keyframes infos-waiting-blink { 0%,42%,46%,74%,78%,100% { transform: scaleY(1); } 44%,76% { transform: scaleY(.08); } }
    @keyframes infos-waiting-tail { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(4deg); } }
    @keyframes infos-waiting-bubble { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
    @keyframes infos-waiting-twinkle { 0%,100% { opacity: .6; } 50% { opacity: .9; } }
    @keyframes infos-waiting-pebble { 0%,60%,100% { transform: translateY(0); opacity: .35; } 30% { transform: translateY(-4px); opacity: .9; } }
    @media (max-height: 420px) {
      .infos-application-waiting { padding-block: 16px; }
      .infos-application-waiting .illustration { width: 210px; margin-bottom: 0; }
      .infos-application-waiting .waiting { margin-top: 4px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .infos-application-waiting *, .infos-application-waiting *::before { animation: none !important; }
    }
    .infos-application-waiting[data-motion="reduced"] *, .infos-application-waiting[data-motion="off"] * { animation: none !important; }
`

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
}

/** 外壳直接呈现 SVG，不创建会触发窗口加载事件的 iframe。 */
export function createApplicationWaitingContent(options: ApplicationWaitingOptions): string {
  const { dark, motion = 'full' } = options
  const name = escapeHtml(options.applicationName)
  const palette = `
      color-scheme: ${dark ? 'dark' : 'light'};
      --background: ${dark ? '#15151d' : '#f5f6fa'};
      --ink: ${dark ? '#e4e8f5' : '#3f4a66'};
      --muted: ${dark ? '#8d98b3' : '#8290ab'};
      --line: ${dark ? '#b3b9f0' : '#818acb'};
      --frame: ${dark ? '#7183a9' : '#a4b7d3'};
      --panel: ${dark ? '#1c2231' : '#ffffff'};
      --fur: ${dark ? '#252d40' : '#f1f3ff'};
      --pink: ${dark ? '#edb3cb' : '#e99db9'};
      --mint: ${dark ? '#9fddce' : '#75bdad'};
      --halo: ${dark ? '#8894d4' : '#c4cdee'};
  `
  return `<style>${waitingStyles}</style>
<div class="infos-application-waiting" data-motion="${escapeHtml(motion)}" style="${palette}">
  <div class="waiting-content" role="status" aria-live="polite" aria-atomic="true">
    <svg class="illustration" viewBox="0 0 320 240" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
      <ellipse class="shadow" cx="160" cy="209" rx="76" ry="7" fill="var(--line)" opacity=".1" />
      <g class="lines">
        <path class="trail" d="M245 109C278 102 282 76 257 65" stroke="var(--frame)" opacity=".45" />
        <g class="sparkle" stroke="var(--mint)">
          <path d="M55 105v12m-6-6h12" />
          <circle cx="74" cy="66" r="2" fill="var(--mint)" stroke="none" />
        </g>
        <g class="sparkle late" stroke="var(--pink)">
          <path d="M269 164v10m-5-5h10" />
          <circle cx="248" cy="200" r="2" fill="var(--pink)" stroke="none" />
        </g>
        <g class="bubble" style="transform-origin:250px 63px">
          <path d="M236 42h25a11 11 0 0 1 11 11v13a11 11 0 0 1-11 11h-13l-10 8v-9a11 11 0 0 1-13-10V53a11 11 0 0 1 11-11Z" fill="var(--panel)" stroke="var(--frame)" />
          <path d="m248 68-8-7c-6-6 3-12 8-6 5-6 14 0 8 6Z" fill="var(--pink)" fill-opacity=".18" stroke="var(--pink)" stroke-width="1.8" />
        </g>
        <g class="window">
          <rect x="68" y="78" width="184" height="116" rx="17" fill="var(--panel)" stroke="var(--frame)" />
          <path d="M69 103h182" stroke="var(--frame)" opacity=".45" stroke-width="1.5" />
          <g stroke="none">
            <circle cx="84" cy="91" r="2.5" fill="var(--pink)" />
            <circle cx="94" cy="91" r="2.5" fill="var(--line)" opacity=".6" />
            <circle cx="104" cy="91" r="2.5" fill="var(--mint)" />
          </g>
          <path d="M222 90h13" stroke="var(--frame)" opacity=".55" stroke-width="1.5" />
          <path class="tail" d="M207 173c23 3 35-12 28-23-6-9-17-3-13 4" stroke="var(--line)" stroke-width="3" />
          <g class="cat" stroke="var(--line)">
            <path d="M117 160c-8-12-6-30-1-49q2-5 6-1l17 14q21-7 42 0l17-14q4-4 6 2c4 18 6 36-2 48-13 20-72 20-85 0Z" fill="var(--fur)" />
            <path d="m120 121 2 11 8-3m60 0 8 3 2-11" stroke="var(--pink)" opacity=".8" stroke-width="1.8" />
            <g class="eyes" fill="var(--line)" stroke="none">
              <ellipse cx="141" cy="146" rx="2.6" ry="3.6" />
              <ellipse cx="179" cy="146" rx="2.6" ry="3.6" />
            </g>
            <g fill="var(--pink)" stroke="none" opacity=".3">
              <ellipse cx="129" cy="154" rx="6" ry="3" />
              <ellipse cx="191" cy="154" rx="6" ry="3" />
            </g>
            <path d="M157 151q3-2 6 0l-3 3Z" fill="var(--pink)" stroke="var(--pink)" stroke-width="1.4" />
            <path d="M160 154v3q-4 5-7 0m7 0q4 5 7 0" stroke-width="1.7" />
            <path d="m119 148-9-2m9 9-10 1m92-8 9-2m-9 9 10 1" opacity=".65" stroke-width="1.6" />
            <path d="M130 171q30 8 60 0" opacity=".35" stroke-width="1.5" />
          </g>
          <rect x="126" y="170" width="18" height="12" rx="6" fill="var(--fur)" stroke="var(--line)" />
          <rect x="176" y="170" width="18" height="12" rx="6" fill="var(--fur)" stroke="var(--line)" />
          <path d="M133 176v2m4-2v2m46-2v2m4-2v2" stroke="var(--line)" stroke-width="1.3" opacity=".6" />
        </g>
      </g>
    </svg>
    <h1>等一下，马上就好~</h1>
    <p class="caption">正在准备 ${name}</p>
    <div class="waiting" aria-hidden="true"><span></span><span></span><span></span></div>
  </div>
</div>`
}

/** 原生管理页使用同一套 SVG；不加载脚本或外部资源。 */
export function createApplicationWaitingPage(options: ApplicationWaitingOptions): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <meta name="color-scheme" content="${options.dark ? 'dark' : 'light'}">
  <title>${escapeHtml(options.applicationName)} · 等一下，马上就好~</title>
  <style>html, body { margin: 0; width: 100%; height: 100%; }</style>
</head>
<body>${createApplicationWaitingContent(options)}</body>
</html>`
}
