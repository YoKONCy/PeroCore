import struct
import json
import os
import sys

def parse_glb_accessors(file_path):
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
        
        # We need to find accessors used by Morph Targets
        # Iterate meshes -> primitives -> targets
        
        if 'meshes' not in data:
            print("No meshes found.")
            return

        print(f"Inspecting {file_path} for Morph Target data...")
        
        for i, mesh in enumerate(data['meshes']):
            print(f"Mesh {i}: {mesh.get('name', 'Unnamed')}")
            if 'primitives' in mesh:
                for j, prim in enumerate(mesh['primitives']):
                    if 'targets' in prim:
                        print(f"  Primitive {j} has {len(prim['targets'])} targets.")
                        
                        # Check the first few targets
                        for k, target in enumerate(prim['targets']):
                            if k > 5: # Only check first 5
                                print("    ... (skipping rest)")
                                break
                                
                            # target is a dict of attributes, e.g. {"POSITION": 123, "NORMAL": 124}
                            if 'POSITION' in target:
                                acc_idx = target['POSITION']
                                if acc_idx < len(data['accessors']):
                                    acc = data['accessors'][acc_idx]
                                    min_val = acc.get('min', ['N/A'])
                                    max_val = acc.get('max', ['N/A'])
                                    print(f"    Target {k} POSITION Accessor {acc_idx}: Min={min_val}, Max={max_val}")
                                    
                                    # Check if empty (all zeros)
                                    is_empty = True
                                    if isinstance(min_val, list) and isinstance(max_val, list):
                                        for v in min_val + max_val:
                                            if abs(v) > 0.0001:
                                                is_empty = False
                                                break
                                    
                                    if is_empty:
                                        print(f"      [WARNING] Target {k} appears to be EMPTY (Zero Delta)!")
                                    else:
                                        print(f"      [OK] Target {k} has data.")
                            else:
                                print(f"    Target {k} has no POSITION attribute.")
                    else:
                        print(f"  Primitive {j} has NO targets.")

if __name__ == "__main__":
    parse_glb_accessors("assets/models/pero_fixed.glb")
