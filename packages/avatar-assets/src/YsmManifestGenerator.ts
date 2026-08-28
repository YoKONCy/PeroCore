/**
 * YSM 模型配置生成器
 *
 * 该适配器由 Electron 资产扫描与 Frontend 运行时加载共同使用，归属头像资产领域包。
 */

export interface YsmConfigForm {
  type?: string
  title?: string
  description?: string
  value?: string
  [key: string]: unknown
}

export interface YsmExtraButton {
  id?: string
  name?: string
  config_forms?: YsmConfigForm[]
}

export type YsmTextureItem = { uv?: string; [key: string]: unknown } | string

export interface YsmConfig {
  spec?: number
  metadata?: {
    name?: string
    tips?: string
    authors?: Array<{ name?: string; role?: string }>
    [key: string]: unknown
  }
  properties?: {
    height_scale?: number
    width_scale?: number
    default_texture?: string
    preview_animation?: string
    extra_animation_buttons?: YsmExtraButton[]
    [key: string]: unknown
  }
  files?: {
    player?: {
      model?: { main?: string; arm?: string }
      animation?: Record<string, string>
      animation_controllers?: string[]
      texture?: YsmTextureItem[]
    }
    [key: string]: unknown
  }
}

export interface YsmFeatureButton {
  id: string
  label: string
  group?: string
  defaultValue?: boolean
}

export type MappingHealth = Record<string, boolean>

export interface YsmGeneratedManifest {
  asset_id: string
  type: 'model_3d'
  source: 'ysm'
  display_name: string
  metadata: { name: string; version: string; author?: string; description?: string }
  resources: { model: string; texture: string; animations: string[] }
  animation_controllers?: string | string[]
  featureButtons: YsmFeatureButton[]
  retargetingMap: { mapping: Record<string, string> }
  scale?: number
  boneFilterPatterns: string[]
  mappingHealth: MappingHealth
  ysmFunctions?: string[]
}

export const BONE_ALIASES: Record<string, string[]> = {
  Root: ['Root'],
  Body: ['UpBody', 'UpperBody', 'AllBody', 'Torso'],
  Head: ['Head', 'AllHead', 'MHead'],
  LeftArm: ['LeftArm', 'ArmL', 'L_arm'],
  RightArm: ['RightArm', 'ArmR', 'R_arm'],
  LeftLeg: ['LeftLeg', 'LegL', 'L_leg'],
  RightLeg: ['RightLeg', 'LegR', 'R_leg'],
  Mouth: ['Mouth', 'MouthBase'],
  EyeBrow: ['EyeBrow', 'Eyebrow', 'Brow'],
  LeftEye: ['LeftEye', 'LeftEyes'],
  RightEye: ['RightEye', 'RightEyes'],
  Eyes: ['Eyes', 'Eye'],
  Eyelid: ['Eyelid', 'LeftEyelid', 'RightEyelid'],
  Tail: ['Tail', 'Tail1', 'tail'],
  Arm: ['Arm', 'arms'],
  Leg: ['Leg', 'legs'],
}

function normalizeBoneName(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, '')
}

export const YSM_SCENE_FILTERS = [
  'bed',
  'ghost',
  'catwj',
  'Hordflower',
  'ysmGlowlx',
  'ysmGlowstxwq',
]

const DEFAULT_BONE_FILTER = [
  'GUI',
  'Hud',
  'Panel',
  'Button',
  'Text',
  'Start',
  'End',
  'background',
  'molang',
  'Locator',
  'Sheath',
  'Blade',
  'Rifle',
  'Elytra',
  'wazi',
  ...YSM_SCENE_FILTERS,
]

export const BASE_HEIGHT = 0.7

export class YsmManifestGenerator {
  static fromYsm(
    ysm: YsmConfig,
    dirName: string,
    boneNames: string[],
    _visibleBoundsHeight?: number,
  ): YsmGeneratedManifest {
    const metadata = ysm.metadata || {}
    const properties = ysm.properties || {}
    const player = ysm.files?.player || {}
    const displayName = metadata.name?.replace(/§[0-9a-fk-or]/g, '') || dirName
    const encodedDir = encodeURIComponent(dirName)
    const url = (rel: string | undefined): string => (rel ? `/assets/3d/${encodedDir}/${rel}` : '')
    const model = url(player.model?.main) || url(player.model?.arm)
    const texture = this.pickTexture(player.texture || [], properties.default_texture, encodedDir)
    const animations = Object.values(player.animation || {}).map((rel) => url(rel))
    const controllers = player.animation_controllers?.map((rel) => url(rel)) || []
    const { mapping, mappingHealth } = this.detectRetargetMap(boneNames)
    const featureButtons = this.translateCheckboxButtons(properties.extra_animation_buttons || [])

    return {
      asset_id: `com.infos.model.ysm.${dirName}`,
      type: 'model_3d',
      source: 'ysm',
      display_name: displayName,
      metadata: {
        name: displayName,
        version: '1.0.0',
        author: metadata.authors?.[0]?.name || '',
        description: metadata.tips,
      },
      resources: { model, texture, animations },
      ...(controllers.length > 0 ? { animation_controllers: controllers } : {}),
      featureButtons,
      retargetingMap: { mapping },
      scale: this.computeScale(properties.height_scale),
      boneFilterPatterns: DEFAULT_BONE_FILTER,
      mappingHealth,
    }
  }

  static pickTexture(
    textures: YsmTextureItem[],
    defaultTexture: string | undefined,
    encodedDir: string,
  ): string {
    if (textures.length === 0) return ''
    const candidates = textures
      .map((texture) => (typeof texture === 'string' ? texture : texture.uv))
      .filter((uv): uv is string => !!uv)
    if (defaultTexture && candidates.length > 1) {
      const hit = candidates.find((uv) => {
        const base =
          uv
            .split('/')
            .pop()
            ?.replace(/\.\w+$/, '') || ''
        return base === defaultTexture || base.startsWith(defaultTexture)
      })
      if (hit) return `/assets/3d/${encodedDir}/${hit}`
    }
    return candidates[0] ? `/assets/3d/${encodedDir}/${candidates[0]}` : ''
  }

  static detectRetargetMap(boneNames: string[]): {
    mapping: Record<string, string>
    mappingHealth: MappingHealth
  } {
    const boneSet = new Set(boneNames)
    const normalized = new Map<string, string>()
    for (const name of boneNames) normalized.set(normalizeBoneName(name), name)
    const mapping: Record<string, string> = {}
    const mappingHealth: MappingHealth = {}

    for (const [standard, aliases] of Object.entries(BONE_ALIASES)) {
      let hit = boneSet.has(standard) ? standard : normalized.get(normalizeBoneName(standard)) || ''
      if (!hit) hit = aliases.find((alias) => boneSet.has(alias)) || ''
      if (!hit) {
        for (const alias of aliases) {
          const aliasHit = normalized.get(normalizeBoneName(alias))
          if (aliasHit) {
            hit = aliasHit
            break
          }
        }
      }
      mappingHealth[standard] = !!hit
      if (hit) mapping[standard] = hit
    }
    return { mapping, mappingHealth }
  }

  static computeScale(heightScale?: number): number {
    return heightScale && heightScale > 0 ? heightScale / BASE_HEIGHT : 1
  }

  static translateCheckboxButtons(buttons: YsmExtraButton[]): YsmFeatureButton[] {
    const result: YsmFeatureButton[] = []
    for (const button of buttons) {
      const group = button.name?.replace(/§[0-9a-fk-or]/g, '') || button.id || ''
      for (const form of button.config_forms || []) {
        if (form.type !== 'checkbox') continue
        const varName = form.value?.trim()
        if (!varName) continue
        result.push({
          id: varName,
          label: form.title || varName,
          group: group || undefined,
          defaultValue: true,
        })
      }
    }
    return result
  }
}
