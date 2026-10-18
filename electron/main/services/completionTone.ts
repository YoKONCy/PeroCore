import { BrowserWindow } from 'electron'

/** 在内存中合成短双音，不依赖远程资源、界面音效设置或聊天窗口生命周期。 */
function toneUrl(): string {
  const sampleRate = 24_000
  const duration = 0.52
  const tones = [
    { frequency: 880, offset: 0, duration: 0.28 },
    { frequency: 1320, offset: 0.14, duration: 0.36 },
  ]
  const samples = Math.ceil(sampleRate * duration)
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples * 2, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples * 2, 40)
  for (let index = 0; index < samples; index++) {
    const time = index / sampleRate
    let value = 0
    for (const tone of tones) {
      const local = time - tone.offset
      if (local < 0 || local > tone.duration) continue
      const envelope =
        Math.min(1, local / 0.018) *
        Math.exp(-local * 12) *
        Math.min(1, (tone.duration - local) / 0.05)
      value += Math.sin(2 * Math.PI * tone.frequency * local) * envelope * 0.16
    }
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + index * 2)
  }
  return `data:audio/wav;base64,${buffer.toString('base64')}`
}

let player: BrowserWindow | null = null
let ready: Promise<void> | undefined
let releaseTimer: ReturnType<typeof setTimeout> | undefined
const source = toneUrl()

export function stopCompletionTone(): void {
  if (releaseTimer) clearTimeout(releaseTimer)
  if (player && !player.isDestroyed()) player.destroy()
  player = null
  ready = undefined
}

export async function playCompletionTone(): Promise<void> {
  if (releaseTimer) clearTimeout(releaseTimer)
  if (!player || player.isDestroyed()) {
    const created = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    })
    player = created
    created.on('closed', () => {
      if (player === created) {
        player = null
        ready = undefined
      }
    })
    ready = created.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; media-src data:"><audio id="tone"></audio>',
        ),
    )
  }
  const current = player
  const deadline = setTimeout(() => {
    if (current && !current.isDestroyed()) current.destroy()
  }, 4000)
  try {
    await ready
    if (!current || current.isDestroyed()) return
    await current.webContents.executeJavaScript(
      `(() => { const audio = document.getElementById('tone'); audio.pause(); audio.src = ${JSON.stringify(source)}; audio.volume = 0.35; return audio.play(); })()`,
    )
  } finally {
    clearTimeout(deadline)
    releaseTimer = setTimeout(() => {
      if (player === current && current && !current.isDestroyed()) current.destroy()
    }, 2000)
  }
}
