export interface PetControlSettings {
  voiceMode: 'off' | 'ptt' | 'vad'
  pttBinding: string
  toggleVoiceShortcut: string
  stopSpeechShortcut: string
  openConversationShortcut: string
  togglePetShortcut: string
  speechEnabled: boolean
  subtitlesEnabled: boolean
  microphoneId: string
}

export interface PetConversationTarget {
  agentId: string
  threadId?: string
  messageId?: string
  taskId?: string
}

export interface PetControlSnapshot {
  settings: PetControlSettings
  pttSupported: boolean
  error: string
}

export const DEFAULT_PET_CONTROLS: Readonly<PetControlSettings> = Object.freeze({
  voiceMode: 'off',
  pttBinding: 'Mouse4',
  toggleVoiceShortcut: 'CommandOrControl+Alt+V',
  stopSpeechShortcut: 'CommandOrControl+Alt+S',
  openConversationShortcut: 'CommandOrControl+Shift+D',
  togglePetShortcut: 'CommandOrControl+Shift+P',
  speechEnabled: true,
  subtitlesEnabled: true,
  microphoneId: '',
})

/** 只允许读取明确绑定的按键状态，不采集任意键盘输入。 */
export function pttVirtualKeys(binding: string): number[] | null {
  const named: Record<string, number> = {
    Mouse4: 5,
    Mouse5: 6,
    Space: 0x20,
    ControlLeft: 0xa2,
    ControlRight: 0xa3,
    AltLeft: 0xa4,
    AltRight: 0xa5,
    ShiftLeft: 0xa0,
    ShiftRight: 0xa1,
    Ctrl: 0x11,
    Control: 0x11,
    Alt: 0x12,
    Shift: 0x10,
    Meta: 0x5b,
    Backquote: 0xc0,
    CapsLock: 0x14,
    Tab: 9,
    Enter: 0x0d,
    NumpadEnter: 0x0d,
    Backspace: 0x08,
    Delete: 0x2e,
    Insert: 0x2d,
    Home: 0x24,
    End: 0x23,
    PageUp: 0x21,
    PageDown: 0x22,
    ArrowLeft: 0x25,
    ArrowUp: 0x26,
    ArrowRight: 0x27,
    ArrowDown: 0x28,
    NumLock: 0x90,
    ScrollLock: 0x91,
    Minus: 0xbd,
    Equal: 0xbb,
    BracketLeft: 0xdb,
    BracketRight: 0xdd,
    Backslash: 0xdc,
    Semicolon: 0xba,
    Quote: 0xde,
    Comma: 0xbc,
    Period: 0xbe,
    Slash: 0xbf,
    NumpadAdd: 0x6b,
    NumpadSubtract: 0x6d,
    NumpadMultiply: 0x6a,
    NumpadDivide: 0x6f,
    NumpadDecimal: 0x6e,
  }
  const keys = binding.split('+').map((part) => {
    if (named[part] !== undefined) return named[part]!
    if (/^Key[A-Z]$/.test(part)) return part.charCodeAt(3)
    if (/^Digit[0-9]$/.test(part)) return part.charCodeAt(5)
    if (/^Numpad[0-9]$/.test(part)) return 0x60 + Number(part.slice(-1))
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(part)) return 0x6f + Number(part.slice(1))
    return -1
  })
  const modifiers = [0x10, 0x11, 0x12, 0x5b, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5]
  return keys.length > 0 &&
    keys.length <= 4 &&
    new Set(keys).size === keys.length &&
    keys.every((key) => key > 0) &&
    keys.some((key) => !modifiers.includes(key))
    ? keys
    : null
}
