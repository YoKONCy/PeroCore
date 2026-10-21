// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { AvatarRenderer } from '../../src/components/avatar/lib/AvatarRenderer'
import type { IModelProvider } from '../../src/components/avatar/lib/adapter/IModelProvider'
import { disposeAvatarResources } from '../../src/components/avatar/lib/disposeAvatarResources'

vi.mock('../../src/lib/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const roots: THREE.Group[] = []

afterEach(() => {
  for (const root of roots.splice(0)) disposeAvatarResources(root)
})

async function buildCubes(cubes: Record<string, unknown>[]) {
  const texture = new THREE.Texture()
  const provider: IModelProvider = {
    getManifest: async () => ({}),
    getModelData: async () => ({
      textureWidth: 64,
      textureHeight: 64,
      bones: [{ name: 'body', pivot: [0, 0, 0], cubes }],
    }),
    getTexture: async () => texture,
    getAnimations: async () => new Map<string, unknown>(),
  }
  const renderer = new AvatarRenderer()
  const root = await renderer.build(provider)
  roots.push(root)
  return renderer.boneMap.get('body')![0]!.children as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  >[]
}

describe('桌宠表面稳定性', () => {
  it.each([
    { size: [0, 4, 4], faces: ['east', 'west'] },
    { size: [4, 0, 4], faces: ['up', 'down'] },
    { size: [4, 4, 0], faces: ['south', 'north'] },
  ])('零厚度 $size 贴片保留正反 UV，避免重复双面绘制', async ({ size, faces }) => {
    const [mesh] = await buildCubes([
      {
        size,
        uv: {
          [faces[0]!]: { uv: [0, 0], uv_size: [4, 4] },
          [faces[1]!]: { uv: [16, 16], uv_size: [4, 4] },
        },
      },
    ])
    expect(mesh!.material.side).toBe(THREE.FrontSide)
    expect(mesh!.geometry.index!.count).toBe(12)
    const index = mesh!.geometry.index!
    const uv = mesh!.geometry.getAttribute('uv')
    expect(uv.getX(index.getX(0))).toBe(0)
    expect(uv.getX(index.getX(6))).toBe(16 / 64)
  })

  it('从贴片两侧观察时各命中一张表面，且两侧贴图不同', async () => {
    const [mesh] = await buildCubes([
      {
        origin: [-2, -2, 0],
        size: [4, 4, 0],
        uv: {
          south: { uv: [0, 0], uv_size: [4, 4] },
          north: { uv: [16, 16], uv_size: [4, 4] },
        },
      },
    ])
    mesh!.updateWorldMatrix(true, false)
    const front = new THREE.Raycaster(
      new THREE.Vector3(0.3, 0.7, 10),
      new THREE.Vector3(0, 0, -1),
    ).intersectObject(mesh!, false)
    const back = new THREE.Raycaster(
      new THREE.Vector3(0.3, 0.7, -10),
      new THREE.Vector3(0, 0, 1),
    ).intersectObject(mesh!, false)
    expect(front).toHaveLength(1)
    expect(back).toHaveLength(1)
    const coordinates = [front[0]!.uv!.x, back[0]!.uv!.x].sort((a, b) => a - b)
    expect(coordinates[0]).toBeLessThan(4 / 64)
    expect(coordinates[1]).toBeGreaterThanOrEqual(16 / 64)
  })

  it('逐面 UV 只生成已声明的面，不补画默认贴图面', async () => {
    const [mesh, empty] = await buildCubes([
      { size: [4, 4, 4], uv: { north: { uv: [8, 8], uv_size: [4, 4] } } },
      { size: [4, 4, 4], uv: {} },
    ])
    expect(Array.from(mesh!.geometry.index!.array)).toEqual([20, 22, 21, 22, 23, 21])
    expect(empty!.geometry.index!.count).toBe(0)
  })

  it('单面装饰、实体和膨胀外层保持双面可见与原有 Box UV', async () => {
    const meshes = await buildCubes([
      { size: [4, 4, 0], uv: { north: { uv: [0, 0], uv_size: [4, 4] } } },
      { size: [4, 4, 4], uv: [0, 0] },
      { size: [4, 4, 0], inflate: 0.1, uv: [0, 0] },
      { size: [4, 4, 0.01], uv: [0, 0] },
    ])
    for (const mesh of meshes) expect(mesh.material.side).toBe(THREE.DoubleSide)
    for (const mesh of meshes.slice(1)) expect(mesh.geometry.index!.count).toBe(36)
    expect(meshes[1]!.castShadow).toBe(true)
    expect(meshes[1]!.receiveShadow).toBe(true)
  })

  it('贴片共享材质但不改变实体材质，释放时不重复销毁共享纹理', async () => {
    const [first, second, volume] = await buildCubes([
      { size: [4, 4, 0], uv: [0, 0] },
      { size: [4, 0, 4], uv: [0, 0] },
      { size: [4, 4, 4], uv: [0, 0] },
    ])
    expect(first!.material).toBe(second!.material)
    expect(first!.material).not.toBe(volume!.material)
    expect(first!.material.map).toBe(volume!.material.map)
    const disposeTexture = vi.spyOn(first!.material.map!, 'dispose')
    const disposePlanar = vi.spyOn(first!.material, 'dispose')
    const disposeVolume = vi.spyOn(volume!.material, 'dispose')
    disposeAvatarResources(roots.pop()!)
    expect(disposeTexture).toHaveBeenCalledTimes(1)
    expect(disposePlanar).toHaveBeenCalledTimes(1)
    expect(disposeVolume).toHaveBeenCalledTimes(1)
  })
})
