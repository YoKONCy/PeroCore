import { createHash } from 'node:crypto'
import type { PromptVariableState, PromptVariableEffects } from '@infos/shared'
import {
  parseStTemplate as nodes,
  splitStArguments as splitArguments,
  stShorthand,
} from './sillyTavernSyntax'

const FUNCTIONS = new Set([
  'if',
  'getvar',
  'setvar',
  'addvar',
  'incvar',
  'decvar',
  'hasvar',
  'deletevar',
  'getglobalvar',
  'setglobalvar',
  'addglobalvar',
  'incglobalvar',
  'decglobalvar',
  'hasglobalvar',
  'deleteglobalvar',
  'random',
  'pick',
  'roll',
  'trim',
  'noop',
  'comment',
  '//',
  'newline',
  'space',
  'reverse',
  'upper',
  'lower',
  'capitalize',
  'date',
  'time',
  'isodate',
  'isotime',
  'weekday',
  'datetimeformat',
])
const RESERVED = new Set(['__proto__', 'prototype', 'constructor'])
const LIMIT = 200_000

function variableName(name: string): string {
  if (!name || name.length > 100 || RESERVED.has(name) || name.startsWith('__'))
    throw new Error(`酒馆变量名无效：${name}`)
  return name
}
const scalar = (value: unknown): string =>
  value === undefined || value === null
    ? ''
    : typeof value === 'string'
      ? value
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)

const truthy = (value: string) =>
  !['', 'false', '0', 'off', 'no', 'null', 'undefined'].includes(value.trim().toLowerCase())

/** 编译只生成变量变更；真实调用完成后由持久层提交。 */
export class SillyTavernMacros {
  private readonly variables = new Map<string, string>()
  private readonly globals = new Map<string, string>()
  private readonly observed = {
    local: new Map<string, { before?: string; write: boolean }>(),
    global: new Map<string, { before?: string; write: boolean }>(),
  }
  private readonly aliases = new Map<string, string>()
  private calls = 0
  private readonly now = new Date()
  private randomState: number
  private original?: () => string
  constructor(
    input: Record<string, unknown>,
    values: Record<string, string>,
    readonly seed: string,
    state: PromptVariableState = { local: {}, global: {} },
  ) {
    for (const [key, value] of Object.entries(state.local))
      this.variables.set(variableName(key), value)
    for (const [key, value] of Object.entries(state.global))
      this.globals.set(variableName(key), value)
    for (const [key, value] of Object.entries(input))
      if (
        !key.startsWith('__') &&
        !RESERVED.has(key) &&
        ['string', 'number', 'boolean'].includes(typeof value)
      )
        this.aliases.set(key.toLowerCase(), scalar(value))
    for (const [key, value] of Object.entries(values))
      this.aliases.set(variableName(key).toLowerCase(), value)
    const aliases: Record<string, unknown> = {
      char: input.agent_name,
      charifnotgroup: input.channel === 'group' || input.is_group ? '' : input.agent_name,
      user: input.owner_name,
      description: values.charDescription ?? input.persona_definition,
      personality: values.charPersonality ?? input.char_personality,
      scenario: values.scenario ?? input.scenario,
      persona: values.personaDescription ?? input.user_persona,
      mesexamples: values.dialogueExamples ?? input.dialogue_examples,
      group: input.group_names ?? input.agent_name,
      lastusermessage: input.last_user_message,
      lastcharmessage: input.last_assistant_message,
      lastmessage: input.last_message,
      chathistory: input.conversation_history,
      lastgenerationtype: input.generation_type,
      charprompt: input.char_prompt,
      charinstruction: input.char_instruction,
      original: '',
      charfirstmessage: input.char_first_message,
      charcreatornotes: input.char_creator_notes,
      charversion: input.char_version,
      authorsnote: input.authors_note,
      charauthorsnote: input.authors_note,
      mesexamplesraw: values.dialogueExamples ?? input.dialogue_examples,
      lastmessageid: input.last_message_id,
      firstincludedmessageid: input.first_included_message_id,
      model: input.model,
      maxprompt: input.max_prompt,
      maxcontexttokens: input.max_context_tokens,
      maxresponsetokens: input.max_response_tokens,
    }
    for (const [key, value] of Object.entries(aliases)) this.aliases.set(key, scalar(value))
    this.randomState = createHash('sha256').update(seed).digest().readUInt32LE(0) || 1
  }
  inspect(source: string): string[] {
    if (source.length > LIMIT) throw new Error('酒馆宏源码超过 200K 字符')
    const unsupported = new Set<string>()
    const visit = (body: string, depth: number) => {
      if (depth > 32) throw new Error('酒馆宏嵌套超过 32 层')
      for (const node of nodes(body))
        if (node.kind === 'macro') {
          const macro = splitArguments(node.body)
          const short = stShorthand(node.body)
          if (short) {
            variableName(short.name)
            visit(short.value, depth + 1)
            continue
          }
          if (!FUNCTIONS.has(macro.name) && !this.aliases.has(macro.name))
            unsupported.add(macro.name)
          else
            this.signature(macro.name, [
              ...macro.args,
              ...(node.scoped !== undefined && macro.name !== 'if' ? ['占位正文'] : []),
            ])
          if (macro.name !== 'comment' && macro.name !== '//') {
            for (const arg of macro.args) visit(arg, depth + 1)
            if (node.scoped !== undefined) visit(node.scoped, depth + 1)
            if (node.otherwise !== undefined) visit(node.otherwise, depth + 1)
          }
        }
    }
    visit(source, 0)
    return [...unsupported]
  }
  render(source: string, depth = 0): string {
    if (depth > 32 || source.length > LIMIT) throw new Error('酒馆宏渲染超过大小或嵌套限制')
    let result = '',
      trimNext = false
    for (const node of nodes(source)) {
      if (++this.calls > 20_000) throw new Error('酒馆宏展开次数过多')
      if (node.kind === 'text') {
        const text = node.text.replace(
          /<(USER|BOT|CHAR|GROUP|CHARIFNOTGROUP)>/gi,
          (_all, tag: string) =>
            this.aliases.get(tag.toLowerCase() === 'bot' ? 'char' : tag.toLowerCase()) ?? '',
        )
        result += trimNext ? text.trimStart() : text
        trimNext = false
      } else {
        const { name, args: raw } = splitArguments(node.body)
        const short = stShorthand(node.body)
        if (short) {
          result += this.shorthand(short, depth)
          if (result.length > LIMIT) throw new Error('酒馆宏渲染结果超过 200K 字符')
          continue
        }
        if (name === 'if') {
          if (node.scoped === undefined || raw.length !== 1)
            throw new Error('if 宏需要一个条件和配对结束块')
          result += this.render(
            this.condition(raw[0]!, depth + 1) ? node.scoped : (node.otherwise ?? ''),
            depth + 1,
          )
          if (result.length > LIMIT) throw new Error('酒馆宏渲染结果超过 200K 字符')
          continue
        }
        if (name === 'trim') {
          result = result.trimEnd()
          trimNext = true
          continue
        }
        if (['noop', 'comment', '//'].includes(name)) continue
        const args = raw.map((value) => this.render(value.trim(), depth + 1))
        if (node.scoped !== undefined) args.push(this.render(node.scoped, depth + 1))
        this.signature(name, args)
        result += this.evaluate(name, args, node.body)
      }
      if (result.length > LIMIT) throw new Error('酒馆宏渲染结果超过 200K 字符')
    }
    if (result.length > LIMIT) throw new Error('酒馆宏渲染结果超过 200K 字符')
    return result
  }
  withOriginal<T>(value: string | (() => string), callback: () => T): T {
    const previous = this.original
    let cached: string | undefined,
      resolving = false
    this.original = () => {
      if (cached !== undefined) return cached
      if (resolving) throw new Error('原始提示词不能递归引用 original')
      resolving = true
      try {
        return (cached = typeof value === 'string' ? value : value())
      } finally {
        resolving = false
      }
    }
    try {
      return callback()
    } finally {
      this.original = previous
    }
  }
  effects(): PromptVariableEffects {
    const scope = (global: boolean) =>
      [...this.observed[global ? 'global' : 'local']].map(([name, item]) => ({
        name,
        ...item,
        after: (global ? this.globals : this.variables).get(name),
      }))
    return { local: scope(false), global: scope(true) }
  }
  private read(name: string, global = false): string | undefined {
    name = variableName(name)
    const map = global ? this.globals : this.variables,
      observed = this.observed[global ? 'global' : 'local']
    if (!observed.has(name) && observed.size >= 1000)
      throw new Error('单轮酒馆变量数量超过 1000 个')
    if (!observed.has(name)) observed.set(name, { before: map.get(name), write: false })
    return map.get(name)
  }
  private write(name: string, value: string | undefined, global = false) {
    this.read(name, global)
    if (value !== undefined && value.length > LIMIT) throw new Error('酒馆变量内容过大')
    this.observed[global ? 'global' : 'local'].get(name)!.write = true
    const map = global ? this.globals : this.variables
    if (value === undefined) map.delete(name)
    else map.set(name, value)
  }
  private condition(source: string, depth: number): boolean {
    const text = source.trim(),
      inverted = text.startsWith('!')
    const value = inverted ? text.slice(1).trim() : text
    const short = stShorthand(value)
    const evaluated = short
      ? this.shorthand(short, depth)
      : value.toLowerCase() === 'original'
        ? (this.original?.() ?? '')
        : this.aliases.has(value.toLowerCase())
          ? this.aliases.get(value.toLowerCase())!
          : this.render(value, depth)
    return inverted ? !truthy(evaluated) : truthy(evaluated)
  }
  private shorthand(short: NonNullable<ReturnType<typeof stShorthand>>, depth: number): string {
    const old = this.read(short.name, short.global)
    if (!short.operator) return old ?? ''
    if (['||', '||='].includes(short.operator) && truthy(old ?? '')) return old!
    if (['??', '??='].includes(short.operator) && old !== undefined) return old
    const value = this.render(short.value.trim(), depth + 1)
    if (['==', '!='].includes(short.operator))
      return String(short.operator === '==' ? (old ?? '') === value : (old ?? '') !== value)
    if (['>', '>=', '<', '<='].includes(short.operator)) {
      const left = Number(old ?? ''),
        right = Number(value)
      return String(
        Number.isFinite(left) &&
          Number.isFinite(right) &&
          (short.operator === '>'
            ? left > right
            : short.operator === '>='
              ? left >= right
              : short.operator === '<'
                ? left < right
                : left <= right),
      )
    }
    if (['||', '??'].includes(short.operator)) return value
    if (['=', '||=', '??='].includes(short.operator)) {
      this.write(short.name, value, short.global)
      return short.operator === '=' ? '' : value
    }
    if (
      short.operator === '-=' &&
      (!Number.isFinite(Number(value)) || !Number.isFinite(Number(old ?? '')))
    )
      throw new Error('变量减法需要有效数字')
    const name = `${short.operator === '++' ? 'inc' : short.operator === '--' ? 'dec' : 'add'}${short.global ? 'global' : ''}var`
    return this.evaluate(
      name,
      [short.name, short.operator === '-=' ? String(-Number(value)) : value],
      '',
    )
  }
  private signature(name: string, args: string[]) {
    if (name === 'if' && args.length !== 1) throw new Error('if 宏需要一个条件')
    const variableMacros = [
      'getvar',
      'setvar',
      'addvar',
      'incvar',
      'decvar',
      'hasvar',
      'deletevar',
      'getglobalvar',
      'setglobalvar',
      'addglobalvar',
      'incglobalvar',
      'decglobalvar',
      'hasglobalvar',
      'deleteglobalvar',
    ]
    if (variableMacros.includes(name)) {
      const required = name.startsWith('set') || name.startsWith('add') ? 2 : 1
      if (args.length < required) throw new Error(`${name} 宏需要 ${required} 个参数`)
      if (!args[0]!.includes('{{')) variableName(args[0]!.trim())
    }
    if (['time', 'date', 'isodate', 'isotime', 'weekday'].includes(name) && args.length)
      throw new Error(`${name} 宏暂不支持参数，请改用 datetimeformat`)
    if (name === 'datetimeformat') {
      if (!args[0]?.trim()) throw new Error('datetimeformat 宏需要日期格式')
      if (!args[0].includes('{{') && /[a-zA-Z]/.test(args[0].replace(/YYYY|MM|DD|HH|mm|ss/g, '')))
        throw new Error('datetimeformat 暂支持 YYYY、MM、DD、HH、mm、ss')
    }
    if (['space', 'newline'].includes(name) && args[0] !== undefined && !args[0].includes('{{')) {
      const count = Number(args[0])
      if (!Number.isInteger(count) || count < 0 || count > 100)
        throw new Error(`${name} 宏数量应在 0～100 之间`)
    }
    if (!FUNCTIONS.has(name) && this.aliases.has(name) && args.length)
      throw new Error(`兼容变量 {{${name}}} 只支持无参数读取`)
  }
  private random(): number {
    let x = this.randomState
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.randomState = x >>> 0
    return this.randomState / 0x100000000
  }
  private evaluate(name: string, args: string[], original: string): string {
    if (name === 'original') return this.original?.() ?? ''
    if (this.aliases.has(name) && !FUNCTIONS.has(name)) return this.aliases.get(name)!
    if (name === 'newline' || name === 'space') {
      const count = args[0] === undefined ? 1 : Number(args[0])
      if (!Number.isInteger(count) || count < 0 || count > 100)
        throw new Error(`${name} 宏数量应在 0～100 之间`)
      return (name === 'newline' ? '\n' : ' ').repeat(count)
    }
    const operation = /^(get|set|add|inc|dec|has|delete)(global)?var$/.exec(name)
    if (operation) {
      const key = variableName(args[0]?.trim() ?? ''),
        global = Boolean(operation[2]),
        old = this.read(key, global)
      if (operation[1] === 'get') return old ?? ''
      if (operation[1] === 'has') return String(old !== undefined)
      if (operation[1] === 'delete') {
        this.write(key, undefined, global)
        return ''
      }
      if (operation[1] === 'set') {
        this.write(key, args.slice(1).join('::'), global)
        return ''
      }
      const amount = operation[1] === 'inc' ? '1' : operation[1] === 'dec' ? '-1' : (args[1] ?? '0')
      let next: string
      if (operation[1] === 'add') {
        let list: unknown
        try {
          list = JSON.parse(old ?? '')
        } catch {
          /* 普通字符串和数字不走数组追加。 */
        }
        next = Array.isArray(list)
          ? JSON.stringify([...list, amount])
          : Number.isFinite(Number(old ?? '')) && Number.isFinite(Number(amount))
            ? String(Number(old ?? '') + Number(amount))
            : (old ?? '') + amount
      } else
        next = String((Number.isFinite(Number(old ?? '')) ? Number(old ?? '') : 0) + Number(amount))
      this.write(key, next, global)
      return operation[1] === 'add' ? '' : next
    }
    if (name === 'random' || name === 'pick') {
      const choices = args.length === 1 ? args[0]!.split(',').map((value) => value.trim()) : args
      if (!choices.length) return ''
      const fraction =
        name === 'pick'
          ? createHash('sha256')
              .update(this.seed + original)
              .digest()
              .readUInt32LE(0) / 0x100000000
          : this.random()
      return choices[Math.floor(fraction * choices.length)] ?? ''
    }
    if (name === 'roll') {
      const match = /^(\d{1,3})?d(\d{1,7})([+-]\d+)?$/i.exec((args[0] ?? '1d6').trim())
      if (!match) throw new Error('骰子宏需要例如 1d20 的表达式')
      const count = Number(match[1] ?? 1),
        sides = Number(match[2])
      if (count < 1 || count > 100 || sides < 1 || sides > 1_000_000)
        throw new Error('骰子数量或面数超出限制')
      let result = Number(match[3] ?? 0)
      for (let i = 0; i < count; i++) result += 1 + Math.floor(this.random() * sides)
      return String(result)
    }
    if (name === 'reverse') return [...(args[0] ?? '')].reverse().join('')
    if (name === 'upper') return (args[0] ?? '').toUpperCase()
    if (name === 'lower') return (args[0] ?? '').toLowerCase()
    if (name === 'capitalize')
      return (args[0] ?? '').replace(/^./u, (character) => character.toUpperCase())
    if (['date', 'time', 'isodate', 'isotime', 'weekday', 'datetimeformat'].includes(name)) {
      const now = this.now
      const pad = (n: number) => String(n).padStart(2, '0')
      const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
      if (name === 'datetimeformat') {
        if (!args[0]) throw new Error('datetimeformat 宏需要日期格式')
        const fields: Record<string, string> = {
          YYYY: String(now.getFullYear()),
          MM: pad(now.getMonth() + 1),
          DD: pad(now.getDate()),
          HH: pad(now.getHours()),
          mm: pad(now.getMinutes()),
          ss: pad(now.getSeconds()),
        }
        if (/[a-zA-Z]/.test(args[0].replace(/YYYY|MM|DD|HH|mm|ss/g, '')))
          throw new Error('datetimeformat 暂支持 YYYY、MM、DD、HH、mm、ss')
        return args[0].replace(/YYYY|MM|DD|HH|mm|ss/g, (key) => fields[key]!)
      }
      if (args.length) throw new Error(`${name} 宏暂不支持参数，请改用 datetimeformat`)
      return name === 'weekday'
        ? now.toLocaleDateString('zh-CN', { weekday: 'long' })
        : name === 'isodate'
          ? date
          : name === 'isotime'
            ? time.slice(0, 5)
            : name === 'date'
              ? now.toLocaleDateString('zh-CN')
              : time
    }
    throw new Error(`暂不支持酒馆宏：{{${name}}}，请修改正文或在兼容变量中提供值`)
  }
}
