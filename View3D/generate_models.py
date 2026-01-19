import os
import json

ASSETS_DIR = r"c:\Users\Administrator\Desktop\Perofamily\PeroCore\View3D\assets"
OUTPUT_FILE = r"c:\Users\Administrator\Desktop\Perofamily\PeroCore\View3D\models_list.js"
BASE_DIR = r"c:\Users\Administrator\Desktop\Perofamily\PeroCore\View3D"

models = []

for root, dirs, files in os.walk(ASSETS_DIR):
    if "main.json" in files:
        # Found a model
        model_path = os.path.join(root, "main.json")
        
        # Check for arm
        arm_path = os.path.join(root, "arm.json")
        has_arm = os.path.exists(arm_path)
        
        # Check for texture
        texture_path = None
        # Priority: same dir -> parent dir
        pngs = [f for f in files if f.endswith(".png")]
        if pngs:
            texture_path = os.path.join(root, pngs[0])
        else:
            # Check parent
            parent_dir = os.path.dirname(root)
            parent_files = os.listdir(parent_dir)
            parent_pngs = [f for f in parent_files if f.endswith(".png")]
            if parent_pngs:
                texture_path = os.path.join(parent_dir, parent_pngs[0])
        
        if not texture_path:
            print(f"Skipping {root} - No texture found")
            continue

        # Create relative paths
        rel_model = os.path.relpath(model_path, BASE_DIR).replace("\\", "/")
        rel_arm = os.path.relpath(arm_path, BASE_DIR).replace("\\", "/") if has_arm else None
        rel_texture = os.path.relpath(texture_path, BASE_DIR).replace("\\", "/")
        
        # Extract name (use folder name of the main.json or its parent if generic "models")
        name = os.path.basename(root)
        if name in ["models", "model"]:
            name = os.path.basename(os.path.dirname(root))
            
        # Refine name by checking grand parent if it's generic
        # e.g. assets/ak_chizui/main.json -> ak_chizui
        # e.g. assets/gc_doro2.0/doro/models/main.json -> doro (or gc_doro2.0?)
        
        # Let's try to get a unique id from the path relative to assets
        rel_to_assets = os.path.relpath(root, ASSETS_DIR)
        id_name = rel_to_assets.replace("\\", "_").replace("/", "_").replace("_models", "")

        models.append({
            "name": id_name,
            "model": rel_model,
            "arm": rel_arm,
            "texture": rel_texture
        })

# Write to JS file
js_content = f"export const MODELS = {json.dumps(models, indent=4)};"

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    f.write(js_content)

print(f"Generated {len(models)} models in {OUTPUT_FILE}")
