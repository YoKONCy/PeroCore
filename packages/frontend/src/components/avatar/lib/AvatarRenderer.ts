/**
 * 虚拟人渲染器
 *
 * 将 IModelProvider 提供的模型数据（骨骼、几何体、纹理）
 * 转换为可交互的 Three.js 场景对象。
 * 支持两种几何体路径：
 * - Native 路径：Rust 预计算的顶点/UV/索引数据
 * - JS 回退路径：从 Bedrock Cube 数据构建 BoxGeometry
 *
 * @module packages/frontend/src/components/avatar/lib/AvatarRenderer
 */

import * as THREE from 'three'
import { logger } from '../../../lib/logger'
import type { IModelProvider, ParsedBone } from './adapter/IModelProvider'

// ══════ 类型定义 ══════

/** Bedrock Cube 数据结构 */
interface BedrockCube {
  origin?: [number, number, number]
  size?: [number, number, number]
  pivot?: [number, number, number]
  rotation?: [number, number, number]
  inflate?: number
  mirror?: boolean
  /** Box UV: [u, v] 或逐面 UV: { east: ..., west: ... } */
  uv?: [number, number] | Record<string, PerFaceUV>
}

/** 逐面 UV 数据 */
interface PerFaceUV {
  uv: [number, number]
  uv_size: [number, number]
}

/** Bedrock UV 面名称到 Three.js 面索引的映射 */
const FACE_INDEX_MAP: Record<string, number> = {
  east: 0,
  west: 1,
  up: 2,
  down: 3,
  south: 4,
  north: 5,
}

// ══════ 渲染器 ══════

/**
 * 虚拟人渲染器
 *
 * 核心职责：
 * 1. 构建骨骼层级（Pivot/旋转变换）
 * 2. 生成几何体 Mesh（Native 或 JS 回退）
 * 3. 应用 Bedrock UV 映射（Box UV / 逐面 UV）
 */
export class AvatarRenderer {
  /** 骨骼名称 → Three.js Group 列表（多部位共用骨骼时有多个） */
  boneMap: Map<string, THREE.Group[]> = new Map()
  /** 纹理图集宽度（像素） */
  textureWidth: number = 64
  /** 纹理图集高度（像素） */
  textureHeight: number = 64

  /**
   * 从 Provider 构建完整的 3D 场景
   *
   * @param provider - 模型数据提供者
   * @returns 构建完成的根 Group，可直接添加到 Three.js Scene
   */
  async build(provider: IModelProvider): Promise<THREE.Group> {
    this.boneMap.clear()
    const rootGroup = new THREE.Group()

    // 并行获取模型数据和纹理以提高加载速度
    const [modelData, texture] = await Promise.all([provider.getModelData(), provider.getTexture()])

    this.textureWidth = modelData.textureWidth
    this.textureHeight = modelData.textureHeight

    // 设置纹理过滤为最近邻（NearestFilter）以保持像素风格清晰度
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.colorSpace = THREE.SRGBColorSpace

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      alphaTest: 0.5,
      side: THREE.DoubleSide, // 双面渲染，解决法线反向问题
      // 像素风体素模型不应有 PBR 镜面高光：多个强光源下 roughness=0.4 会在
      // 面部皮肤/眼睛处产生随视角闪烁的高光点。粗糙度拉满 + 零金属度退化为纯漫反射。
      roughness: 1.0,
      metalness: 0,
      // 体素模型必须用平面着色：computeVertexNormals 会做平滑法线，导致薄片
      // （发卡/裙摆）的法线被相邻面平均，光照在表面产生类似“影子抽搐”的明暗条纹。
      // flatShading 让每个面用独立面法线，光照均匀，符合像素风硬边。
      flatShading: true,
      emissive: 0x000000,
      emissiveIntensity: 0,
    })

    this.buildSkeleton(modelData.bones, rootGroup, material)

    // Bedrock 根骨骼绕 Y 轴旋转 180° 适配 Three.js 坐标系
    rootGroup.rotation.y = Math.PI
    rootGroup.scale.set(1, 1, 1)

    return rootGroup
  }

  // ══════ 骨骼层级构建 ══════

  /** 构建骨骼层级并附加几何体 */
  private buildSkeleton(
    bones: ParsedBone[],
    rootGroup: THREE.Group,
    material: THREE.Material,
  ): void {
    const localBoneMap = new Map<string, THREE.Group>()
    const caseInsensitiveBoneMap = new Map<string, string>()

    // 第一遍：创建所有骨骼 Group 对象
    bones.forEach((boneData) => {
      // 解析 Rust 兼容层的 cubesJson
      if (boneData.cubesJson && !boneData.cubes) {
        try {
          boneData.cubes = JSON.parse(boneData.cubesJson)
        } catch (e) {
          logger.error('AvatarRenderer', `解析骨骼 ${boneData.name} 的 cubesJson 失败`, e)
        }
      }

      const boneName = boneData.name
      caseInsensitiveBoneMap.set(boneName.toLowerCase(), boneName)

      if (!localBoneMap.has(boneName)) {
        const boneGroup = new THREE.Group()
        boneGroup.name = boneName
        boneGroup.userData = {
          pivot: boneData.pivot,
          rotation: boneData.rotation,
          bindPose: {
            position: new THREE.Vector3(),
            quaternion: new THREE.Quaternion(),
            scale: new THREE.Vector3(1, 1, 1),
          },
        }
        localBoneMap.set(boneName, boneGroup)

        // 添加到全局骨骼映射
        if (!this.boneMap.has(boneName)) {
          this.boneMap.set(boneName, [])
        }
        this.boneMap.get(boneName)!.push(boneGroup)
      }
    })

    // 第二遍：建立父子关系和添加几何体
    const processedBones = new Set<string>()

    bones.forEach((boneData) => {
      const boneName = boneData.name
      const boneGroup = localBoneMap.get(boneName)!

      // 仅对每个骨骼名处理一次父子关系
      if (!processedBones.has(boneName)) {
        this.setupBoneHierarchy(
          boneData,
          boneGroup,
          bones,
          localBoneMap,
          caseInsensitiveBoneMap,
          rootGroup,
        )
        processedBones.add(boneName)
      }

      // 生成几何体
      this.addGeometryToBone(boneData, boneGroup, material)
    })
  }

  /** 设置单个骨骼的父子关系和初始变换 */
  private setupBoneHierarchy(
    boneData: ParsedBone,
    boneGroup: THREE.Group,
    allBones: ParsedBone[],
    localBoneMap: Map<string, THREE.Group>,
    caseInsensitiveBoneMap: Map<string, string>,
    rootGroup: THREE.Group,
  ): void {
    // 建立父子关系
    if (boneData.parent) {
      let parentGroup = localBoneMap.get(boneData.parent)
      if (!parentGroup) {
        const actualName = caseInsensitiveBoneMap.get(boneData.parent.toLowerCase())
        if (actualName) parentGroup = localBoneMap.get(actualName)
      }

      if (parentGroup) {
        parentGroup.add(boneGroup)
      } else {
        logger.warn('AvatarRenderer', `未找到父骨骼 ${boneData.parent}，挂载到根节点`)
        rootGroup.add(boneGroup)
      }
    } else {
      rootGroup.add(boneGroup)
    }

    // 计算初始变换 (Bind Pose)
    // Bedrock: 骨骼位置 = 自身枢轴点 - 父级枢轴点
    let parentPivot: [number, number, number] = [0, 0, 0]
    if (boneData.parent) {
      let parentBone = allBones.find((b) => b.name === boneData.parent)
      if (!parentBone) {
        const lowerName = boneData.parent!.toLowerCase()
        parentBone = allBones.find((b) => b.name.toLowerCase() === lowerName)
      }
      if (parentBone) parentPivot = parentBone.pivot
    }

    const pivot = boneData.pivot
    // 基岩版 X 轴与 Three.js 相反，需取反
    boneGroup.position.set(
      -(pivot[0] - parentPivot[0]),
      pivot[1] - parentPivot[1],
      pivot[2] - parentPivot[2],
    )

    // 设置初始旋转
    if (boneData.rotation) {
      const rot = boneData.rotation
      boneGroup.rotation.order = 'ZYX'
      boneGroup.rotation.x = THREE.MathUtils.degToRad(-rot[0])
      boneGroup.rotation.y = THREE.MathUtils.degToRad(-rot[1])
      boneGroup.rotation.z = THREE.MathUtils.degToRad(rot[2])
    }

    // 保存 Bind Pose
    boneGroup.updateMatrix()
    boneGroup.userData.bindPose.position.copy(boneGroup.position)
    boneGroup.userData.bindPose.quaternion.copy(boneGroup.quaternion)
    boneGroup.userData.bindPose.scale.copy(boneGroup.scale)
  }

  /** 为骨骼添加几何体 Mesh */
  private addGeometryToBone(
    boneData: ParsedBone,
    boneGroup: THREE.Group,
    material: THREE.Material,
  ): void {
    if (boneData.vertices && boneData.uvs && boneData.indices) {
      // 使用 Native Geometry (高性能路径)
      // Rust 侧已预计算顶点位置、UV 坐标和索引
      const geometry = new THREE.BufferGeometry()

      geometry.setAttribute('position', new THREE.BufferAttribute(boneData.vertices, 3))
      geometry.setAttribute('uv', new THREE.BufferAttribute(boneData.uvs, 2))
      geometry.setIndex(new THREE.BufferAttribute(boneData.indices, 1))

      // 自动计算法线 (Rust 侧未生成法线)
      // 确保光照计算正确
      geometry.computeVertexNormals()

      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.name = `${boneData.name}_Mesh`

      logger.debug('AvatarRenderer', `为骨骼 ${boneData.name} 添加了 Native Mesh`, {
        vertexCount: boneData.vertices.length / 3,
      })

      // Native geometry 已经在 Bone Local Space 中 (相对于 Pivot)
      // 所以直接添加到 Bone Group，位置为 (0,0,0)
      boneGroup.add(mesh)
    } else if (boneData.cubes && boneData.cubes.length > 0) {
      // 回退：使用 JS 侧 Cube 解析 (低性能路径)
      logger.debug('AvatarRenderer', `为骨骼 ${boneData.name} 添加了 Cubes`, {
        cubeCount: boneData.cubes.length,
      })
      const cubes = boneData.cubes as BedrockCube[]
      cubes.forEach((cubeData) => {
        this.addCubeToBone(boneGroup, cubeData, boneData.pivot, material)
      })
    }
  }

  // ══════ Cube 几何体（JS 回退路径） ══════

  // 创建与 BlockBench 兼容的 Box 几何体
  // BlockBench 使用自定义的顶点顺序，与 Three.js BoxGeometry 不同
  private createBedrockBoxGeometry(
    width: number,
    height: number,
    depth: number,
  ): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()

    const w = width / 2
    const h = height / 2
    const d = depth / 2

    // BlockBench setShape 顶点定义 (参照 blockbench-master/js/util/three_custom.js)
    // 注意：BlockBench 使用 from/to 坐标系，我们这里使用中心点坐标系
    // from = [-w, -h, -d], to = [w, h, d]（中心点坐标系）
    const vertices = new Float32Array([
      // 东面 (+x): to[0], to[1], to[2] -> to[0], to[1], from[2] -> to[0], from[1], to[2] -> to[0], from[1], from[2]
      w,
      h,
      d,
      w,
      h,
      -d,
      w,
      -h,
      d,
      w,
      -h,
      -d,
      // 西面 (-x): from[0], to[1], from[2] -> from[0], to[1], to[2] -> from[0], from[1], from[2] -> from[0], from[1], to[2]
      -w,
      h,
      -d,
      -w,
      h,
      d,
      -w,
      -h,
      -d,
      -w,
      -h,
      d,
      // 上面 (+y): from[0], to[1], from[2] -> to[0], to[1], from[2] -> from[0], to[1], to[2] -> to[0], to[1], to[2]
      -w,
      h,
      -d,
      w,
      h,
      -d,
      -w,
      h,
      d,
      w,
      h,
      d,
      // 下面 (-y): from[0], from[1], to[2] -> to[0], from[1], to[2] -> from[0], from[1], from[2] -> to[0], from[1], from[2]
      -w,
      -h,
      d,
      w,
      -h,
      d,
      -w,
      -h,
      -d,
      w,
      -h,
      -d,
      // 南面 (+z): from[0], to[1], to[2] -> to[0], to[1], to[2] -> from[0], from[1], to[2] -> to[0], from[1], to[2]
      -w,
      h,
      d,
      w,
      h,
      d,
      -w,
      -h,
      d,
      w,
      -h,
      d,
      // 北面 (-z): to[0], to[1], from[2] -> from[0], to[1], from[2] -> to[0], from[1], from[2] -> from[0], from[1], from[2]
      w,
      h,
      -d,
      -w,
      h,
      -d,
      w,
      -h,
      -d,
      -w,
      -h,
      -d,
    ])

    // UV 坐标 (每个面 4 个顶点，每个顶点 2 个 UV 坐标)
    const uvs = new Float32Array(24 * 2) // 6 面 * 4 顶点 * 2 UV

    // 索引 (每个面 2 个三角形，每个三角形 3 个索引)
    // BlockBench 索引顺序: 0, 2, 1, 2, 3, 1 (CCW)
    const indices = new Uint16Array([
      0,
      2,
      1,
      2,
      3,
      1, // East
      4,
      6,
      5,
      6,
      7,
      5, // West
      8,
      10,
      9,
      10,
      11,
      9, // Up
      12,
      14,
      13,
      14,
      15,
      13, // Down
      16,
      18,
      17,
      18,
      19,
      17, // South
      20,
      22,
      21,
      22,
      23,
      21, // North
    ])

    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    geometry.computeVertexNormals()

    return geometry
  }

  // 保留用于非 Native 数据源的回退支持
  private addCubeToBone(
    boneGroup: THREE.Group,
    cubeData: BedrockCube,
    bonePivot: [number, number, number],
    material: THREE.Material,
  ): void {
    // Bedrock Cube 定义:
    // origin: [x, y, z] (方块左下角坐标)
    // size: [w, h, d] (宽, 高, 深)
    // pivot: [x, y, z] (方块旋转中心，可选)
    // rotation: [x, y, z] (方块旋转角度，可选)

    const size: [number, number, number] = cubeData.size || [0, 0, 0]
    const origin: [number, number, number] = cubeData.origin || [0, 0, 0]
    const inflate = cubeData.inflate || 0
    const mirror = cubeData.mirror || false

    // 创建与 BlockBench 兼容的几何体
    const geometry = this.createBedrockBoxGeometry(
      size[0] + inflate * 2,
      size[1] + inflate * 2,
      size[2] + inflate * 2,
    )

    // UV 映射
    if (cubeData.uv) {
      this.applyBedrockUV(geometry, cubeData.uv, size, mirror)
    }

    const mesh = new THREE.Mesh(geometry, material)
    // 亚像素薄片（最小边 < 1 单位，如发卡/丝带这类被缩小的装饰 cube）不参与阴影：
    // 它们在 shadow map 里只有几个纹素宽，投射/接收阴影必然产生随摆动抽搐的噪点，
    // 且体积极小，关闭阴影对画面几乎没有影响。
    const minSize = Math.min(size[0], size[1], size[2])
    const isThinDecal = minSize < 1.0
    mesh.castShadow = !isThinDecal
    mesh.receiveShadow = !isThinDecal
    mesh.name = 'Cube'

    // 计算 Cube 相对于 Bone 的位置
    // Bedrock Cube Origin 是绝对坐标
    // Bone Pivot 也是绝对坐标
    // Cube 在 Bone 局部空间的位置 = Cube Center - Bone Pivot

    // 处理 Cube 自身的旋转
    if (cubeData.rotation) {
      // 如果 Cube 没有定义自己的 pivot，则默认使用骨骼的 pivot（即相对于骨骼 pivot 偏移为 0）
      const cubePivot = cubeData.pivot || bonePivot
      const pivotGroup = new THREE.Group()

      // PivotGroup 的位置是相对于 Bone Pivot 的
      pivotGroup.position.set(
        -(cubePivot[0] - bonePivot[0]),
        cubePivot[1] - bonePivot[1],
        cubePivot[2] - bonePivot[2],
      )

      pivotGroup.rotation.order = 'ZYX'
      pivotGroup.rotation.x = THREE.MathUtils.degToRad(-cubeData.rotation[0])
      pivotGroup.rotation.y = THREE.MathUtils.degToRad(-cubeData.rotation[1])
      pivotGroup.rotation.z = THREE.MathUtils.degToRad(cubeData.rotation[2])

      // Mesh 在 PivotGroup 内的位置
      // Mesh 中心 - Cube 枢轴点
      mesh.position.set(
        -(origin[0] + size[0] / 2 - cubePivot[0]),
        origin[1] + size[1] / 2 - cubePivot[1],
        origin[2] + size[2] / 2 - cubePivot[2],
      )

      pivotGroup.add(mesh)
      boneGroup.add(pivotGroup)
    } else {
      // 无旋转，直接挂在 Bone Group 下
      // Mesh 中心 - 骨骼枢轴点
      mesh.position.set(
        -(origin[0] + size[0] / 2 - bonePivot[0]),
        origin[1] + size[1] / 2 - bonePivot[1],
        origin[2] + size[2] / 2 - bonePivot[2],
      )
      boneGroup.add(mesh)
    }
  }

  // ══════ UV 映射 ══════

  /**
   * 应用 Bedrock UV 映射
   *
   * 支持两种格式：
   * - Box UV: [u, v] 原点坐标 → 按标准 Bedrock 布局展开
   * - 逐面 UV: { east: { uv, uv_size }, ... } → 每个面独立配置
   */
  private applyBedrockUV(
    geometry: THREE.BufferGeometry,
    uvData: number[] | Record<string, PerFaceUV>,
    size: number[],
    mirror: boolean = false,
  ): void {
    const uvAttribute = geometry.attributes.uv
    const textureWidth = this.textureWidth
    const textureHeight = this.textureHeight

    // 基岩版 Box UV 布局:
    // 东 (+x), 西 (-x), 上 (+y), 下 (-y), 南 (+z), 北 (-z)
    // 0,    1,    2,  3,    4,     5

    // 辅助函数：设置面的 UV
    // u, v: 纹理起始坐标 (像素)
    // w, h: 纹理宽高 (像素)
    // faceIndex: 面索引 (0-5)
    const setFaceUV = (faceIndex: number, u: number, v: number, w: number, h: number) => {
      // BlockBench 标准支持负的 w/h 来表示 UV 翻转
      // 负值意味着 UV 方向翻转
      let u0: number, u1: number, v0: number, v1: number

      if (w < 0) {
        // 负宽度：U 方向翻转
        u0 = (u + w) / textureWidth // u + (-w) 实际上是 u - |w|
        u1 = u / textureWidth
      } else {
        u0 = u / textureWidth
        u1 = (u + w) / textureWidth
      }

      if (h < 0) {
        // 负高度：V 方向翻转
        // 注意：纹理坐标系 Y 轴向下，但 UV 坐标系 Y 轴向上
        v0 = (textureHeight - v) / textureHeight
        v1 = (textureHeight - (v + h)) / textureHeight // v + (-h) 实际上是 v - |h|
      } else {
        v0 = (textureHeight - v - h) / textureHeight // 底部 (UV 中 Y 轴是反向的)
        v1 = (textureHeight - v) / textureHeight // 顶部
      }

      if (mirror) {
        // 镜像翻转 X
        ;[u0, u1] = [u1, u0]
      }

      // Three.js BoxGeometry UV 顺序:
      // 0: 左上 (0, 1)
      // 1: 右上 (1, 1)
      // 2: 左下 (0, 0)
      // 3: 右下 (1, 0)

      // BoxGeometry 面顺序:
      // +x, -x, +y, -y, +z, -z
      // 右, 左, 上, 下, 前, 后
      // 基岩版映射需要与此对齐

      // BufferGeometry from BoxGeometry 是非索引的 (24 个顶点)
      // 每个面 4 个顶点
      // 顶点顺序: 0: 左上, 1: 右上, 2: 左下, 3: 右下 (标准矩形)

      const offset = faceIndex * 4

      // 设置 UV 坐标
      uvAttribute!.setXY(offset + 0, u0, v1) // 左上
      uvAttribute!.setXY(offset + 1, u1, v1) // 右上
      uvAttribute!.setXY(offset + 2, u0, v0) // 左下
      uvAttribute!.setXY(offset + 3, u1, v0) // 右下
    }

    if (Array.isArray(uvData)) {
      // Box UV (标准基岩版)
      // [u, v] 原点
      const u = uvData[0]
      const v = uvData[1]

      // 尺寸
      const w = Math.ceil(size[0]!)
      const h = Math.ceil(size[1]!)
      const d = Math.ceil(size[2]!)

      // 基于基岩版规范的映射
      // 上 (Up): 2
      // 下 (Down): 3
      // 前 (North/South): 5 或 4
      // 右 (West): 1
      // 左 (East): 0
      // 后: 4 或 5

      // Three.js 面索引:
      // 0: 右 (+x)
      // 1: 左 (-x)
      // 2: 上 (+y)
      // 3: 下 (-y)
      // 4: 前 (+z)
      // 5: 后 (-z)

      // 基岩版布局:
      // 上: [u+d, v, w, d]
      // 下: [u+d+w, v, w, d]
      // 前: [u+d, v+d, w, h]
      // 后: [u+d+w+d, v+d, w, h]
      // 右: [u, v+d, d, h]
      // 左: [u+d+w, v+d, d, h]

      // BlockBench 标准 Box UV 布局 (参照 blockbench-master/js/outliner/cube.js):
      // face_list = [
      //   {face: 'east',  from: [0, size_z],                    size: [size_z,  size_y]},
      //   {face: 'west',  from: [size_z + size_x, size_z],      size: [size_z,  size_y]},
      //   {face: 'up',    from: [size_z+size_x, size_z],        size: [-size_x, -size_z]},
      //   {face: 'down',  from: [size_z+size_x*2, 0],           size: [-size_x, size_z]},
      //   {face: 'south', from: [size_z*2 + size_x, size_z],    size: [size_x,  size_y]},
      //   {face: 'north', from: [size_z, size_z],               size: [size_x,  size_y]},
      // ]
      //
      // Three.js BoxGeometry 面索引映射：
      // 0: +x (东面)
      // 1: -x (西面)
      // 2: +y (上面)
      // 3: -y (下面)
      // 4: +z (南面/前)
      // 5: -z (北面/后)

      setFaceUV(0, u!, v! + d, d, h) // East (+x)
      setFaceUV(1, u! + d + w, v! + d, d, h) // West (-x)
      setFaceUV(2, u! + d + w, v! + d, -w, -d) // Up (+y)
      setFaceUV(3, u! + d + w * 2, v!, -w, d) // Down (-y)
      setFaceUV(4, u! + d * 2 + w, v! + d, w, h) // South (+z)
      setFaceUV(5, u! + d, v! + d, w, h) // North (-z)
    } else {
      // 逐面 UV
      // 对象格式: { up: { uv: [u, v], uv_size: [w, h] }, ... }
      for (const [faceName, faceData] of Object.entries(uvData)) {
        const faceIndex = FACE_INDEX_MAP[faceName]
        if (faceIndex === undefined) continue

        const perFace = faceData as PerFaceUV
        setFaceUV(faceIndex, perFace.uv[0], perFace.uv[1], perFace.uv_size[0], perFace.uv_size[1])
      }
    }

    uvAttribute!.needsUpdate = true
  }
}
