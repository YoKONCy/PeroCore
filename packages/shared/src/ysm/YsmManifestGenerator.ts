/**
 * YSM 模型配置生成器
 *
 * 将 YSM mod（Yes Steve Model）导出的模型目录（ysm.json）自动翻译为
 * infOS 的标准模型清单（IAvatarManifest 兼容结构），实现"万能重定向"：
 *
 * 1. 资源路径解析：从 files.player 提取模型/纹理/动画/控制器路径
 * 2. 骨骼自动检测：扫描模型骨骼名，按 YSM 骨骼铁律生成 retargetingMap
 * 3. 尺度归一化：按模型可见包围盒高度统一到基准身高
 * 4. checkbox 按钮翻译：把 YSM 的 extra_animation_buttons 中的 checkbox
 *    控件转换为 infOS 的功能按钮（仅布尔开关）
 *
 * 该模块为纯 TS，无 DOM/Node 依赖，可同时被 Electron 主进程与前端引用。
 *
 * @module packages/shared/src/ysm/YsmManifestGenerator
 */

// ═══════════════════════════════════════════════════════════════
// YSM 配置类型（仅定义生成器所需的子集，保持宽松以兼容不同作者）
// ═══════════════════════════════════════════════════════════════

/** YSM 配置表单控件（仅 checkbox 被翻译） */
export interface YsmConfigForm {
  type?: string
  title?: string
  description?: string
  /** molang 变量名，如 "v.player_armor_head" */
  value?: string
  [key: string]: unknown
}

/** YSM 按钮分组（对应一组表单控件） */
export interface YsmExtraButton {
  id?: string
  name?: string
  config_forms?: YsmConfigForm[]
}

/** YSM 纹理项（部分作者导出为对象 {uv}，部分为纯字符串路径） */
export type YsmTextureItem = { uv?: string; [key: string]: unknown } | string

/** YSM 模型配置（spec 2 子集） */
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
      model?: {
        main?: string
        arm?: string
      }
      animation?: Record<string, string>
      animation_controllers?: string[]
      texture?: YsmTextureItem[]
    }
    [key: string]: unknown
  }
}

// ═══════════════════════════════════════════════════════════════
// 生成结果类型（结构兼容前端 IAvatarManifest）
// ═══════════════════════════════════════════════════════════════

/** 生成的功能按钮（checkbox 翻译结果） */
export interface YsmFeatureButton {
  id: string
  label: string
  group?: string
  defaultValue?: boolean
}

/** 骨骼映射健康度（每个标准骨骼是否命中） */
export type MappingHealth = Record<string, boolean>

/** YSM 生成的标准模型清单 */
export interface YsmGeneratedManifest {
  asset_id: string
  type: 'model_3d'
  source: 'ysm'
  display_name: string
  metadata: {
    name: string
    version: string
    author?: string
    description?: string
  }
  resources: {
    model: string
    texture: string
    animations: string[]
  }
  animation_controllers?: string | string[]
  featureButtons: YsmFeatureButton[]
  /** 自动检测生成的骨骼重定向映射 */
  retargetingMap: { mapping: Record<string, string> }
  /** 统一缩放系数（尺度归一化） */
  scale?: number
  boneFilterPatterns: string[]
  /** 骨骼映射健康度（供上层 UI 降级交互能力） */
  mappingHealth: MappingHealth
  /** YSM 控制器脚本（functions/*.molang）URL 列表，由调用方扫描填充 */
  ysmFunctions?: string[]
}

// ═══════════════════════════════════════════════════════════════
// YSM 骨骼铁律（对 6 个 YSM 模型实测验证）
// ═══════════════════════════════════════════════════════════════

/** 标准骨骼 → YSM 模型中的候选别名（按优先级排列） */
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
  // YSM 特有骨骼（供眨眼/尾巴等程序化交互使用）
  Eyes: ['Eyes', 'Eye'],
  Eyelid: ['Eyelid', 'LeftEyelid', 'RightEyelid'],
  Tail: ['Tail', 'Tail1', 'tail'],
  Arm: ['Arm', 'arms'],
  Leg: ['Leg', 'legs'],
}

/** 标准化骨骼名（去分隔符并转小写） */
function normalizeBoneName(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, '')
}

/**
 * YSM 场景摆件通用过滤模式。
 *
 * 部分作者把房间/场景做进角色模型（如特莉波卡的床与花、幽灵、猫、远处发光件）。
 * 这些骨骼在 MC 里也是常驻显示的，但作为桌面看板娘需要"纯人物"效果。
 * 已对仓库内 6 个 YSM 模型逐一验证零误伤；前端加载 YSM 模型时会强制合并，
 * 不依赖落盘 manifest 是否已用最新模式重新生成。
 */
export const YSM_SCENE_FILTERS = [
  'bed',
  'ghost',
  'catwj',
  'Hordflower',
  'ysmGlowlx',
  'ysmGlowstxwq',
]

/** 默认 YSM 辅助骨骼过滤模式（避免渲染 GUI/辅助/绑定骨骼） */
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
  // YSM 场景摆件模式（配合"子树排除"整棵移除，如 bed 连 groundhua*/flower* 一起移除）
  ...YSM_SCENE_FILTERS,
]

/**
 * YSM height_scale 的基准值。
 *
 * 注意：该值仅作为模型作者希望的相对体型提示；最终视觉尺寸由前端根据
 * 渲染后 Three.js 实际包围盒归一化，绝不使用 visible_bounds_height。
 */
export const BASE_HEIGHT = 0.7

// ═══════════════════════════════════════════════════════════════
// 生成器
// ═══════════════════════════════════════════════════════════════

/**
 * YSM 模型清单生成器
 *
 * 纯函数集合：给定 ysm.json、模型目录名与骨骼名列表，生成标准模型清单。
 */
export class YsmManifestGenerator {
  /**
   * 从 YSM 配置生成标准模型清单
   *
   * @param ysm - 解析后的 ysm.json 内容
   * @param dirName - 模型目录名（用于构建资源 URL）
   * @param boneNames - 模型全部骨骼名（用于自动骨骼检测）
   * @param _visibleBoundsHeight - 兼容旧调用；该值是剔除范围，不再参与视觉缩放
   */
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

    // 1. 资源路径解析
    const model = url(player.model?.main) || url(player.model?.arm)
    const texture = this.pickTexture(player.texture || [], properties.default_texture, encodedDir)
    const animations = Object.values(player.animation || {}).map((rel) => url(rel as string))
    const controllers = player.animation_controllers?.map((rel) => url(rel)) || []

    // 2. 骨骼自动检测
    const { mapping, mappingHealth } = this.detectRetargetMap(boneNames)

    // 3. 仅保留 YSM 作者声明的相对体型提示；最终视觉高度由前端实际包围盒归一化。
    const scale = this.computeScale(properties.height_scale)

    // 4. checkbox 按钮翻译
    const featureButtons = this.translateCheckboxButtons(properties.extra_animation_buttons || [])

    const firstAuthor = metadata.authors?.[0]?.name || ''

    return {
      asset_id: `com.infos.model.ysm.${dirName}`,
      type: 'model_3d',
      source: 'ysm',
      display_name: displayName,
      metadata: {
        name: displayName,
        version: '1.0.0',
        author: firstAuthor,
        description: metadata.tips,
      },
      resources: {
        model,
        texture,
        animations,
      },
      ...(controllers.length > 0 ? { animation_controllers: controllers } : {}),
      featureButtons,
      retargetingMap: { mapping },
      scale,
      boneFilterPatterns: DEFAULT_BONE_FILTER,
      mappingHealth,
    }
  }

  /**
   * 选择默认纹理
   *
   * 匹配规则（YSM 约定）：default_texture 对应纹理文件名的前半部分。
   * 例如 default_texture="skin_pink" 匹配 "textures/skin_pink.png"。
   * 匹配失败时回退到第一项。
   */
  static pickTexture(
    textures: YsmTextureItem[],
    defaultTexture: string | undefined,
    encodedDir: string,
  ): string {
    if (textures.length === 0) return ''
    // 兼容对象 {uv} 与纯字符串两种导出格式
    const candidates = textures
      .map((t) => (typeof t === 'string' ? t : t.uv))
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

  /**
   * 自动骨骼检测
   *
   * 遍历标准骨骼，按 精确匹配 → 忽略大小写 → 别名匹配 的顺序
   * 在模型骨骼名中查找，生成 retargetingMap 与映射健康度。
   */
  static detectRetargetMap(boneNames: string[]): {
    mapping: Record<string, string>
    mappingHealth: MappingHealth
  } {
    const boneSet = new Set(boneNames)
    const normalized = new Map<string, string>()
    for (const name of boneNames) {
      normalized.set(normalizeBoneName(name), name)
    }

    const mapping: Record<string, string> = {}
    const mappingHealth: MappingHealth = {}

    for (const [standard, aliases] of Object.entries(BONE_ALIASES)) {
      let hit = ''

      // 1. 精确匹配（原样）
      if (boneSet.has(standard)) {
        hit = standard
      } else {
        // 2. 忽略大小写/分隔符匹配
        const normalizedHit = normalized.get(normalizeBoneName(standard))
        if (normalizedHit) {
          hit = normalizedHit
        } else {
          // 3. 别名逐个匹配（先精确后标准化）
          for (const alias of aliases) {
            if (boneSet.has(alias)) {
              hit = alias
              break
            }
          }
          if (!hit) {
            for (const alias of aliases) {
              const aliasHit = normalized.get(normalizeBoneName(alias))
              if (aliasHit) {
                hit = aliasHit
                break
              }
            }
          }
        }
      }

      mappingHealth[standard] = !!hit
      if (hit) mapping[standard] = hit
    }

    return { mapping, mappingHealth }
  }

  /**
   * 计算 YSM 作者声明的相对体型比例。
   *
   * visible_bounds_height 是 Minecraft 剔除范围，作者常将其设得远大于实际模型，
   * 因此不能用于视觉缩放。最终统一高度由前端在模型构建后读取实际 Box3 完成。
   */
  static computeScale(heightScale?: number): number {
    if (heightScale && heightScale > 0) {
      return heightScale / BASE_HEIGHT
    }
    return 1
  }

  /**
   * 翻译 YSM checkbox 控件为 infOS 功能按钮
   *
   * YSM 的 extra_animation_buttons 中每个分组含 config_forms 列表，
   * 仅 type === 'checkbox' 的控件被翻译（按钮 id 使用其 molang 变量名）。
   */
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
