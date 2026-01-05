import bpy
import os

# 配置路径
base_path = "C:/Users/Administrator/Desktop/Perofamily/PeroCore/View3D/assets/models"
input_glb = os.path.join(base_path, "pero.glb")
output_glb = os.path.join(base_path, "pero_fixed.glb")

def fix_mesh_data():
    # 1. 清理场景 (替代 read_factory_settings 以避免上下文丢失问题)
    if bpy.context.active_object and bpy.context.active_object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
        
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    
    # 清理孤立数据
    for mesh in bpy.data.meshes:
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    
    # 2. 导入 GLB
    print(f"Importing {input_glb}...")
    try:
        bpy.ops.import_scene.gltf(filepath=input_glb)
    except Exception as e:
        print(f"Import failed: {e}")
        return
    
    # 3. 查找所有面部网格
    face_objects = []
    for obj in bpy.data.objects:
        if obj.type == 'MESH' and "Face" in obj.name:
            face_objects.append(obj)
            print(f"Found face part: {obj.name}")
            
    if not face_objects:
        print("No face objects found!")
        return
        
    # 4. 选中所有面部对象
    bpy.ops.object.select_all(action='DESELECT')
    for obj in face_objects:
        obj.select_set(True)
        
    # 将其中一个设为活动对象
    bpy.context.view_layer.objects.active = face_objects[0]
    
    # 5. 合并对象 (Shape Keys 会被保留和合并)
    print("Merging face objects...")
    if len(face_objects) > 1:
        bpy.ops.object.join()
    
    merged_face = bpy.context.view_layer.objects.active
    merged_face.name = "Face_Merged"
    print(f"Merged into: {merged_face.name}")
    
    # 6. 验证 Shape Keys
    if merged_face.data.shape_keys:
        print(f"Shape Keys count: {len(merged_face.data.shape_keys.key_blocks)}")
        for key in merged_face.data.shape_keys.key_blocks:
            print(f" - {key.name}")
    else:
        print("WARNING: No shape keys found after merge!")
        
    # 7. 导出修复后的 GLB
    print(f"Exporting to {output_glb}...")
    bpy.ops.export_scene.gltf(
        filepath=output_glb,
        export_format='GLB',
        use_selection=False, # 导出整个场景
        export_morph=True,   # 确保导出 Morph Targets
        export_skins=True,   # 确保导出骨骼蒙皮
        export_animations=True
    )
    print("Done!")

if __name__ == "__main__":
    fix_mesh_data()
