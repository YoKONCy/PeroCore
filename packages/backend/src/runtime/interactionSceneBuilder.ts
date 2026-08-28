import { createHash } from 'node:crypto'
import type {
  WebInjectionFinding,
  WebInteractionHandle,
  WebInteractionScene,
  WebSceneAffordance,
  WebSceneObject,
  WebSideEffectClass,
  WebTrustLevel,
} from '@infos/shared'
import type { WebObjectSnapshot } from './webObjectStore'
import type { WebElementSnapshot } from './webSnapshot.types'

const INJECTION_PATTERNS: Array<{
  pattern: RegExp
  severity: WebInjectionFinding['severity']
  category: WebInjectionFinding['category']
}> = [
  {
    pattern: /ignore (?:all )?(?:previous|prior) instructions?/i,
    severity: 'critical',
    category: 'instruction-override',
  },
  {
    pattern: /忽略(?:之前|以上|先前).{0,12}(?:指令|规则|要求)/i,
    severity: 'critical',
    category: 'instruction-override',
  },
  {
    pattern: /(?:upload|send|reveal).{0,30}(?:password|token|cookie|secret|credential)/i,
    severity: 'critical',
    category: 'secret-request',
  },
  {
    pattern: /(?:上传|发送|泄露|提供).{0,20}(?:密码|令牌|Cookie|密钥|凭据)/i,
    severity: 'critical',
    category: 'secret-request',
  },
  {
    pattern: /(?:disable|bypass).{0,20}(?:security|approval|policy)/i,
    severity: 'high',
    category: 'unsafe-action',
  },
  {
    pattern: /(?:绕过|关闭).{0,20}(?:安全|审批|策略|权限)/i,
    severity: 'high',
    category: 'unsafe-action',
  },
]

/** 将页面证据编译为 Agent 第一视角的交互世界模型。 */
export class InteractionSceneBuilder {
  build(snapshot: WebObjectSnapshot, intent?: string): WebInteractionScene {
    const objects = snapshot.pageState.elements.map((element) =>
      this.objectFromElement(snapshot, element),
    )
    this.linkForms(objects)
    const injectionFindings = this.detectInjection(snapshot, objects)
    const blockers = [
      ...(snapshot.pageState.blocked ? [snapshot.pageState.blocked] : []),
      ...injectionFindings
        .filter((finding) => finding.severity === 'critical')
        .map((finding) => `检测到不可信网页指令：${finding.category}`),
    ]
    return {
      sceneId: `scene:${snapshot.pageState.snapshotId}`,
      pageRef: { ...snapshot.page },
      snapshotId: snapshot.pageState.snapshotId,
      url: snapshot.pageState.url,
      title: snapshot.pageState.title,
      intent,
      objects,
      injectionFindings,
      blockers,
      createdAt: new Date().toISOString(),
    }
  }

  private objectFromElement(
    snapshot: WebObjectSnapshot,
    element: WebElementSnapshot,
  ): WebSceneObject {
    const kind = this.kindOf(element)
    const frame = element.frameId
      ? snapshot.pageState.frames.find((candidate) => candidate.id === element.frameId)
      : undefined
    const trust: WebTrustLevel = frame?.parentId ? 'third-party' : 'site-content'
    const objectId = `object:${snapshot.page.generation}:${element.handle}`
    return {
      objectId,
      kind,
      role: element.role,
      name: element.name,
      value: element.value,
      state: {
        disabled: element.disabled,
        checked: element.checked,
        required: element.required,
        inputType: element.inputType,
        label: element.label,
        parentFormHandle: element.parentFormHandle,
        visible: Boolean(element.bounds?.width && element.bounds?.height),
      },
      trust,
      handle: this.createHandle(snapshot, element),
      relatedObjectIds: [],
      affordances: this.affordances(element, kind),
      evidence: [
        { kind: 'dom', ref: element.tag, confidence: 0.9 },
        { kind: 'accessibility', ref: element.role, confidence: element.name ? 0.9 : 0.5 },
        {
          kind: 'layout',
          ref: element.bounds ? JSON.stringify(element.bounds) : undefined,
          confidence: element.bounds ? 0.8 : 0.2,
        },
      ],
      confidence: Math.min(
        1,
        0.55 + (element.name ? 0.2 : 0) + (element.role ? 0.15 : 0) + (element.bounds ? 0.1 : 0),
      ),
    }
  }

  private createHandle(
    snapshot: WebObjectSnapshot,
    element: WebElementSnapshot,
  ): WebInteractionHandle {
    const semantic = `${element.role}|${element.name}|${element.tag}|${element.value ?? ''}`
    const geometry = element.bounds ? JSON.stringify(element.bounds) : ''
    return {
      handleId: element.handle,
      runtimeRef: { ...snapshot.runtime },
      pageRef: { ...snapshot.page },
      frameId: element.frameId,
      backendNodeId: element.backendNodeId,
      documentGeneration: snapshot.page.generation,
      snapshotId: snapshot.pageState.snapshotId,
      semanticFingerprint: this.hash(semantic),
      accessibleFingerprint: this.hash(`${element.role}|${element.name}`),
      geometryFingerprint: geometry ? this.hash(geometry) : undefined,
      selectorHint: `[data-infos-handle="${element.handle}"]`,
    }
  }

  private kindOf(element: WebElementSnapshot): WebSceneObject['kind'] {
    const role = element.role.toLowerCase()
    if (element.tag === 'form' || role === 'form') return 'form'
    if (
      ['input', 'textarea', 'select'].includes(element.tag) ||
      ['textbox', 'combobox', 'checkbox', 'radio'].includes(role)
    )
      return 'field'
    if (element.tag === 'button' || role === 'button') return 'button'
    if (element.tag === 'a' || role === 'link') return 'link'
    if (role === 'dialog') return 'dialog'
    if (role === 'list') return 'list'
    if (role === 'listitem') return 'item'
    if (role === 'table' || element.tag === 'table') return 'table'
    if (role === 'region' || ['main', 'nav', 'header', 'footer', 'aside'].includes(element.tag))
      return 'region'
    return 'unknown'
  }

  private affordances(
    element: WebElementSnapshot,
    kind: WebSceneObject['kind'],
  ): WebSceneAffordance[] {
    const risk = this.riskOf(element.name)
    if (kind === 'field') {
      const operation =
        element.inputType === 'file'
          ? 'upload'
          : element.tag === 'select'
            ? 'select'
            : element.role === 'checkbox' || element.role === 'radio'
              ? 'check'
              : 'type'
      return [
        {
          operation,
          enabled: !element.disabled,
          risk: operation === 'upload' ? 'external-change' : 'local-change',
          preconditions: element.required ? ['字段为必填项'] : [],
          expectedEffects: ['object-state'],
        },
      ]
    }
    if (kind === 'button') {
      const submit = /提交|确认|支付|购买|发送|删除|submit|confirm|pay|buy|send|delete/i.test(
        element.name,
      )
      return [
        {
          operation: submit ? 'submit' : 'click',
          enabled: !element.disabled,
          risk,
          preconditions: submit ? ['表单字段有效', '用户意图已确认'] : [],
          expectedEffects: ['object-state', 'structure'],
        },
      ]
    }
    if (kind === 'link')
      return [
        {
          operation: 'navigate',
          enabled: !element.disabled,
          risk: 'read',
          preconditions: [],
          expectedEffects: ['url'],
        },
      ]
    return []
  }

  private riskOf(name: string): WebSideEffectClass {
    if (/支付|购买|转账|pay|buy|purchase|transfer/i.test(name)) return 'irreversible'
    if (/提交|确认|发送|删除|授权|submit|confirm|send|delete|authorize/i.test(name)) return 'commit'
    return 'local-change'
  }

  private linkForms(objects: WebSceneObject[]): void {
    const formsByHandle = new Map(
      objects
        .filter((object) => object.kind === 'form' && object.handle)
        .map((object) => [object.handle!.handleId, object]),
    )
    for (const object of objects) {
      if (!['field', 'button'].includes(object.kind)) continue
      const parentFormHandle = String(object.state.parentFormHandle ?? '')
      const form = formsByHandle.get(parentFormHandle)
      if (!form) continue
      object.parentObjectId = form.objectId
      form.relatedObjectIds.push(object.objectId)
    }
  }

  private detectInjection(
    snapshot: WebObjectSnapshot,
    objects: WebSceneObject[],
  ): WebInjectionFinding[] {
    const findings: WebInjectionFinding[] = []
    const sources = [
      { text: snapshot.pageState.text, hidden: false },
      { text: snapshot.pageState.hiddenText ?? '', hidden: true },
    ]
    for (const item of INJECTION_PATTERNS) {
      const sourceText = sources.find((source) => item.pattern.test(source.text))
      if (!sourceText) continue
      const match = sourceText.text.match(item.pattern)
      if (!match) continue
      const source = objects.find((object) => object.name.includes(match[0]))
      findings.push({
        findingId: `finding:${findings.length}:${this.hash(match[0]).slice(0, 8)}`,
        severity: sourceText.hidden ? 'critical' : item.severity,
        category: sourceText.hidden ? 'hidden-content' : item.category,
        text: match[0].slice(0, 300),
        sourceObjectId: source?.objectId,
        trust: source?.trust ?? 'site-content',
      })
    }
    return findings
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }
}
