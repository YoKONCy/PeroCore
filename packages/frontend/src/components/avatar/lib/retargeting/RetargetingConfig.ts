/**
 * 骨骼重定向配置
 *
 * 定义标准骨骼名称与具体模型骨骼的映射关系，
 * 支持不同来源模型（MC Bedrock / Blockbench / Workshop）的动画兼容。
 *
 * @module packages/frontend/src/components/avatar/lib/retargeting/RetargetingConfig
 */

/**
 * 重定向映射接口
 *
 * 将标准骨骼名称映射到特定模型的实际骨骼名称。
 */
export interface IRetargetingMap {
  /**
   * 映射表
   * Key: 标准骨骼名称 (如 'Head', 'LeftArm')
   * Value: 目标模型中的实际骨骼名称 (如 'head_bone', 'l_arm')
   */
  mapping: Record<string, string>

  /**
   * 默认姿态修正 (T-Pose → A-Pose 等)
   * Key: 骨骼名称
   * Value: [x, y, z] 旋转角度修正 (弧度)
   */
  restPoseCorrection?: Record<string, [number, number, number]>
}

/**
 * 标准骨骼名称常量
 *
 * 所有动画逻辑和程序化交互应基于这些标准名称编写，
 * 通过 RetargetingManager 自动映射到实际模型骨骼。
 */
export const StandardBones = {
  Root: 'Root',
  Body: 'Body',
  Head: 'Head',
  LeftArm: 'LeftArm',
  RightArm: 'RightArm',
  LeftLeg: 'LeftLeg',
  RightLeg: 'RightLeg',
  // 面部交互
  Mouth: 'Mouth',
  EyeBrow: 'EyeBrow',
  LeftEye: 'LeftEye',
  RightEye: 'RightEye',
} as const
