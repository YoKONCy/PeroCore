import { pttVirtualKeys } from '@infos/shared'

const acceleratorKeys: Record<string, string> = {
  Escape: 'Escape',
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Return',
  NumpadEnter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  CapsLock: 'Capslock',
  NumLock: 'Numlock',
  ScrollLock: 'Scrolllock',
  PrintScreen: 'PrintScreen',
  NumpadDecimal: 'numdec',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
}

/** PTT 保存物理键位，其他快捷键保存 Electron 接受的 Accelerator。 */
export function recordPetShortcut(event: KeyboardEvent, ptt: boolean): string | null {
  const modifiers = [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Meta',
  ].filter(Boolean)
  if (ptt) {
    const binding = [...modifiers, event.code].join('+')
    return pttVirtualKeys(binding) ? binding : null
  }

  let key = acceleratorKeys[event.code]
  if (!key) {
    if (/^Numpad[0-9]$/.test(event.code)) key = `num${event.code.slice(-1)}`
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code
    else if (/^[a-z0-9]$/i.test(event.key)) key = event.key.toUpperCase()
    else if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3)
    else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5)
    else if (event.key === '+') key = 'Plus'
    else if (
      [
        ')',
        '!',
        '@',
        '#',
        '$',
        '%',
        '^',
        '&',
        '*',
        '(',
        ':',
        ';',
        '=',
        '<',
        ',',
        '_',
        '-',
        '>',
        '.',
        '?',
        '/',
        '~',
        '`',
        '{',
        ']',
        '[',
        '|',
        '\\',
        '}',
        '"',
        "'",
      ].includes(event.key)
    ) {
      key = event.key
    }
  }
  return key ? [...modifiers, key].join('+') : null
}

/** 用可读键名展示绑定，保留底层格式以兼容已保存的配置。 */
export function petShortcutLabels(binding: string): string[] {
  const mac = /Mac/i.test(navigator.platform)
  const labels: Record<string, string> = {
    CommandOrControl: mac ? '⌘' : 'Ctrl',
    CmdOrCtrl: mac ? '⌘' : 'Ctrl',
    Command: '⌘',
    Cmd: '⌘',
    Control: 'Ctrl',
    Meta: mac ? '⌘' : 'Win',
    Super: mac ? '⌘' : 'Win',
    Space: '空格',
    Return: 'Enter',
    Mouse4: '鼠标侧键 4',
    Mouse5: '鼠标侧键 5',
    ArrowUp: '↑',
    Up: '↑',
    ArrowDown: '↓',
    Down: '↓',
    ArrowLeft: '←',
    Left: '←',
    ArrowRight: '→',
    Right: '→',
    Plus: '+',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    NumpadEnter: '小键盘 Enter',
    NumpadAdd: '小键盘 +',
    numadd: '小键盘 +',
    NumpadSubtract: '小键盘 -',
    numsub: '小键盘 -',
    NumpadMultiply: '小键盘 ×',
    nummult: '小键盘 ×',
    NumpadDivide: '小键盘 ÷',
    numdiv: '小键盘 ÷',
    NumpadDecimal: '小键盘 .',
    numdec: '小键盘 .',
  }
  return binding
    .split('+')
    .filter(Boolean)
    .map((key) => {
      if (labels[key]) return labels[key]!
      if (/^Key[A-Z]$/.test(key)) return key.slice(3)
      if (/^Digit[0-9]$/.test(key)) return key.slice(5)
      if (/^(num|Numpad)[0-9]$/.test(key)) return `小键盘 ${key.slice(-1)}`
      return key
    })
}
