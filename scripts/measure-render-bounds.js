/**
 * 测量工具：按 AvatarRenderer 的骨骼变换 + 旋转逻辑，计算各模型构建后的世界包围盒。
 * 用于核对各 YSM 模型的视觉高度基准（Rossi 原始包围盒高度 59.5 为统一目标）。
 */
const fs = require('fs')
const path = require('path')

/** ZYX 顺序欧拉角旋转矩阵（three.js 约定：x/y 取反，z 保持） */
function eulerZYX(rx, ry, rz) {
  const cx = Math.cos(rx),
    sx = Math.sin(rx)
  const cy = Math.cos(ry),
    sy = Math.sin(ry)
  const cz = Math.cos(rz),
    sz = Math.sin(rz)
  return [
    [cz * cy, -sz * cx + cz * sy * sx, sz * sx + cz * sy * cx],
    [sz * cy, cz * cx + sz * sy * sx, -cz * sx + sz * sy * cx],
    [-sy, cy * sx, cy * cx],
  ]
}

function matMul(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}

function computeRenderBounds(name) {
  const p = path.join('public/assets/3d', name, 'models/main.json')
  if (!fs.existsSync(p)) return null
  const g = JSON.parse(fs.readFileSync(p, 'utf8'))['minecraft:geometry'][0]
  const bones = g.bones || []
  const map = {}
  for (const b of bones) map[b.name] = b

  const world = {}
  function boneWorld(name) {
    if (world[name]) return world[name]
    const b = map[name]
    if (!b) return { pos: [0, 0, 0], rot: eulerZYX(0, 0, 0) }
    const pivot = b.pivot || [0, 0, 0]
    let parentPivot = [0, 0, 0]
    let parentWorld = { pos: [0, 0, 0], rot: eulerZYX(0, 0, 0) }
    if (b.parent && map[b.parent]) {
      const pb = map[b.parent]
      parentPivot = pb.pivot || [0, 0, 0]
      parentWorld = boneWorld(pb.name)
    }
    // 渲染器：localPos = (-(pivot-parentPivot).x, (pivot-parentPivot).y, (pivot-parentPivot).z)
    const localPos = [
      -(pivot[0] - parentPivot[0]),
      pivot[1] - parentPivot[1],
      pivot[2] - parentPivot[2],
    ]
    let localRot = eulerZYX(0, 0, 0)
    if (b.rotation) {
      localRot = eulerZYX(
        (-b.rotation[0] * Math.PI) / 180,
        (-b.rotation[1] * Math.PI) / 180,
        (b.rotation[2] * Math.PI) / 180,
      )
    }
    const parentRot = parentWorld.rot
    // 世界旋转 = parentRot * localRot
    const worldRot = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++) worldRot[i][j] += parentRot[i][k] * localRot[k][j]
    // 世界位置 = parentPos + parentRot * localPos
    const offset = matMul(parentRot, localPos)
    const pos = [
      parentWorld.pos[0] + offset[0],
      parentWorld.pos[1] + offset[1],
      parentWorld.pos[2] + offset[2],
    ]
    world[name] = { pos, rot: worldRot }
    return world[name]
  }

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const b of bones) {
    const pivot = b.pivot || [0, 0, 0]
    const bw = boneWorld(b.name)
    for (const c of b.cubes || []) {
      const origin = c.origin || [0, 0, 0]
      const size = c.size || [0, 0, 0]
      const inflate = c.inflate || 0
      // cube 局部坐标（无 cube 旋转）：相对骨骼 pivot 的偏移
      const cx0 = -(origin[0] - pivot[0])
      const cy0 = origin[1] - pivot[1]
      const cz0 = origin[2] - pivot[2]
      const corners = [
        [cx0, cy0, cz0],
        [cx0, cy0 + size[1], cz0],
        [cx0, cy0, cz0 + size[2]],
        [cx0, cy0 + size[1], cz0 + size[2]],
      ]
      for (const [lx, ly, lz] of corners) {
        // x 方向取反处理（size 方向也取反）
        for (const sx2 of [0, -size[0]]) {
          const v = matMul(bw.rot, [lx + sx2, ly, lz])
          const wx = bw.pos[0] + v[0]
          const wy = bw.pos[1] + v[1]
          const wz = bw.pos[2] + v[2]
          min[0] = Math.min(min[0], wx - inflate)
          min[1] = Math.min(min[1], wy - inflate)
          min[2] = Math.min(min[2], wz - inflate)
          max[0] = Math.max(max[0], wx + inflate)
          max[1] = Math.max(max[1], wy + inflate)
          max[2] = Math.max(max[2], wz + inflate)
        }
      }
    }
  }
  return { name, min, max, size: max.map((v, i) => v - min[i]) }
}

const root = path.resolve('public/assets/3d')
for (const name of fs.readdirSync(root)) {
  const r = computeRenderBounds(name)
  if (r) console.log(JSON.stringify(r))
}
