import struct
import json
import os

def parse_glb(file_path):
    with open(file_path, 'rb') as f:
        # Header
        magic = f.read(4)
        if magic != b'glTF':
            print(f"Not a valid GLB file: {file_path}")
            return
        
        version = struct.unpack('<I', f.read(4))[0]
        length = struct.unpack('<I', f.read(4))[0]
        
        # Chunk 0: JSON
        chunk_length = struct.unpack('<I', f.read(4))[0]
        chunk_type = f.read(4)
        if chunk_type != b'JSON':
            print("First chunk is not JSON")
            return
        
        json_data = f.read(chunk_length)
        data = json.loads(json_data)
        
        print(f"File: {file_path}")
        print(f"Version: {version}")
        
        if 'nodes' in data:
            print(f"Nodes ({len(data['nodes'])}):")
            for i, node in enumerate(data['nodes']):
                name = node.get('name', 'Unnamed')
                mesh_idx = node.get('mesh')
                mesh_info = f" (Mesh: {mesh_idx})" if mesh_idx is not None else ""
                
                # Check for morph targets in mesh
                morph_info = ""
                if mesh_idx is not None and 'meshes' in data:
                    mesh = data['meshes'][mesh_idx]
                    if 'primitives' in mesh:
                        for prim in mesh['primitives']:
                            if 'targets' in prim:
                                target_count = len(prim['targets'])
                                morph_info = f" [Morph Targets: {target_count}]"
                                if 'extras' in mesh and 'targetNames' in mesh['extras']:
                                     morph_info += f" Names: {mesh['extras']['targetNames']}"
                                break
                
                print(f"  [{i}] {name}{mesh_info}{morph_info}")
        else:
            print("No nodes found.")

if __name__ == "__main__":
    parse_glb("assets/models/pero_fixed.glb")
