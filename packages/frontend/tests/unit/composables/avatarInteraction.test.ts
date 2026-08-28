import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { resolvePetPart } from '@infos/frontend/composables/avatar/useAvatarInteraction'

function createModelWithMesh(name: string): {
  model: THREE.Group
  mesh: THREE.Mesh
  point: THREE.Vector3
} {
  const model = new THREE.Group()
  const bone = new THREE.Group()
  bone.name = name
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  mesh.name = `${name}_Mesh`
  bone.add(mesh)
  model.add(bone)
  model.updateMatrixWorld(true)
  return { model, mesh, point: new THREE.Vector3(0, 0, 0) }
}

describe('resolvePetPart', () => {
  it('应识别大小写不同的腿部骨骼与鞋袜节点', () => {
    for (const name of ['LeftLowerLeg', 'right_foot', 'BootLayer', 'THIGH']) {
      const { model, mesh, point } = createModelWithMesh(name)
      expect(resolvePetPart(mesh, point, model).type).toBe('leg')
    }
  })

  it('无法识别骨骼名时应按模型内点击高度识别腿部', () => {
    const model = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 2))
    mesh.name = 'Mesh_01'
    model.add(mesh)
    model.updateMatrixWorld(true)

    expect(resolvePetPart(mesh, new THREE.Vector3(0, -4, 0), model).type).toBe('leg')
    expect(resolvePetPart(mesh, new THREE.Vector3(0, 1, 0), model).type).toBe('body')
  })
})
