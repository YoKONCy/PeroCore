import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MODELS } from './models_list.js';

// Global variables
let scene, camera, renderer, controls;
let textureWidth = 64;
let textureHeight = 64;
let boneMap = {}; // Global bone map to support cross-file parenting
let currentRootGroup = null;

init();

function init() {
    // 1. Setup Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x333333);

    // 2. Setup Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 30, 50);

    // 3. Setup Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    // 4. Setup Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 10, 0);
    controls.update();

    // 5. Add Lights (Mimicking Blockbench Preview)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-10, -10, -10);
    scene.add(dirLight2);

    // 6. Helpers
    const gridHelper = new THREE.GridHelper(100, 100);
    scene.add(gridHelper);
    
    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    // 7. UI Setup & Load Initial Model
    setupUI();
    if (MODELS.length > 0) {
        loadModel(MODELS[0]);
    }

    // 8. Handle Resize
    window.addEventListener('resize', onWindowResize);

    // 9. Start Loop
    animate();
}

function setupUI() {
    const select = document.getElementById('model-select');
    
    MODELS.forEach((model, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.text = model.name;
        select.appendChild(option);
    });

    select.addEventListener('change', (e) => {
        const index = e.target.value;
        const model = MODELS[index];
        if (model) {
            loadModel(model);
        }
    });
    
    // Select first by default
    if (MODELS.length > 0) {
        select.value = 0;
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

async function loadModel(modelConfig) {
    try {
        document.getElementById('info').innerText = `Loading ${modelConfig.name}...`;

        // Clear previous model
        if (currentRootGroup) {
            scene.remove(currentRootGroup);
            // Dispose logic could be added here to free memory
            currentRootGroup = null;
        }
        boneMap = {}; // Reset bone map

        // Load Texture
        const textureLoader = new THREE.TextureLoader();
        const texture = await new Promise((resolve, reject) => {
            textureLoader.load(modelConfig.texture, resolve, undefined, reject);
        });
        texture.magFilter = THREE.NearestFilter; // Pixel art style
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            alphaTest: 0.5, // Handle transparency
            side: THREE.DoubleSide
        });

        const rootGroup = new THREE.Group();
        scene.add(rootGroup);
        currentRootGroup = rootGroup;

        // Load Main Model
        await loadJsonModel(modelConfig.model, material, rootGroup, true);
        
        // Load Arm Model (if exists)
        if (modelConfig.arm) {
            await loadJsonModel(modelConfig.arm, material, rootGroup, false);
        }

        document.getElementById('info').innerText = `Loaded: ${modelConfig.name}`;

    } catch (error) {
        console.error("Error loading model:", error);
        document.getElementById('info').innerText = "Error loading model. See console.";
    }
}

async function loadJsonModel(path, material, rootGroup, isMain) {
    const response = await fetch(path);
    if (!response.ok) {
        console.warn(`Failed to load ${path}`);
        return;
    }
    const json = await response.json();

    // Parse Bedrock Model
    const geometryData = json['minecraft:geometry'][0];
    const description = geometryData.description;
    
    // Only update texture dimensions from main model to avoid overwriting with potentially smaller/different values
    if (isMain) {
        textureWidth = description.texture_width;
        textureHeight = description.texture_height;
        document.getElementById('info').innerText = `Loaded: ${description.identifier}`;
    }

    const bones = geometryData.bones;

    // First pass: Create Bone Groups
    bones.forEach(boneData => {
        const boneGroup = new THREE.Group();
        boneGroup.name = boneData.name;
        boneGroup.userData = boneData; // Store raw data
        boneMap[boneData.name] = boneGroup;
    });

    // Second pass: Build Hierarchy and Geometry
    bones.forEach(boneData => {
        const boneGroup = boneMap[boneData.name];
        
        // Hierarchy
        let parentGroup = null;
        if (boneData.parent) {
            parentGroup = boneMap[boneData.parent];
        } else if (!isMain) {
             // If it's the arm model and has no parent, try to attach to UpBody or AllBody
             if (boneData.name === 'RightArm' || boneData.name === 'LeftArm') {
                 // Try UpBody first, then AllBody
                 parentGroup = boneMap['UpBody'] || boneMap['AllBody'];
             }
        }

        if (parentGroup) {
            parentGroup.add(boneGroup);
        } else {
            // Only add to root if it's the main model's root bones or unattached bones
            // For arm model, if we couldn't find UpBody, we add to root (fallback)
            rootGroup.add(boneGroup);
        }

        // Pivot (Rotation Center)
        // Bedrock pivot is in absolute coordinates.
        // Three.js Group position sets the local origin relative to parent.
        // We need to carefully handle the conversion from absolute pivot to local position.
        
        const pivot = boneData.pivot || [0, 0, 0];
        
        // Find parent pivot
        // If parentGroup exists, check its userData. 
        // Note: parentGroup might come from a different file (boneMap is global now)
        const parentPivot = (parentGroup && parentGroup.userData && parentGroup.userData.pivot) 
                            ? parentGroup.userData.pivot 
                            : [0, 0, 0];

        // Set position relative to parent pivot
        // Note: Bedrock Y is Up. X is Right. Z is Forward (Standard).
        boneGroup.position.set(
            pivot[0] - parentPivot[0],
            pivot[1] - parentPivot[1],
            pivot[2] - parentPivot[2]
        );

        // Rotation
        if (boneData.rotation) {
            // Bedrock rotation is in degrees. Order usually ZXY or XYZ? 
            // Blockbench uses ZXY order for Bedrock.
            boneGroup.rotation.order = 'ZYX'; // Standard Bedrock order seems to be ZYX or ZXY
            boneGroup.rotation.x = THREE.MathUtils.degToRad(-boneData.rotation[0]);
            boneGroup.rotation.y = THREE.MathUtils.degToRad(-boneData.rotation[1]);
            boneGroup.rotation.z = THREE.MathUtils.degToRad(boneData.rotation[2]);
            // Note: Axis directions might need negation depending on coordinate system match
        }

        // Cubes
        if (boneData.cubes) {
            boneData.cubes.forEach(cubeData => {
                const mesh = createCubeMesh(cubeData, material, pivot);
                boneGroup.add(mesh);
            });
        }
    });
}

function createCubeMesh(cubeData, material, bonePivot) {
    const origin = cubeData.origin || [0, 0, 0];
    const size = cubeData.size || [1, 1, 1];
    const inflation = cubeData.inflate || 0;

    // Geometry
    // BoxGeometry expects width, height, depth
    const geometry = new THREE.BoxGeometry(
        size[0] + inflation * 2, 
        size[1] + inflation * 2, 
        size[2] + inflation * 2
    );

    // UV Mapping
    if (cubeData.uv) {
        applyBedrockUV(geometry, cubeData.uv, size);
    }

    const mesh = new THREE.Mesh(geometry, material);

    // Position
    // The geometry is centered at (0,0,0).
    // The cube origin is the min corner (absolute coords).
    // The bonePivot is the center of the BoneGroup (absolute coords).
    // We want the cube to be at 'origin' relative to the world, 
    // BUT it is a child of BoneGroup which is at 'bonePivot'.
    // So local position = Center of Cube - bonePivot.
    // Center of Cube = origin + size / 2.
    
    mesh.position.set(
        origin[0] + size[0] / 2 - bonePivot[0],
        origin[1] + size[1] / 2 - bonePivot[1],
        origin[2] + size[2] / 2 - bonePivot[2]
    );

    // Cube Rotation (if any)
    if (cubeData.rotation) {
        // If cube has its own rotation, it rotates around its OWN pivot.
        const cubePivot = cubeData.pivot || [0, 0, 0];
        
        // This is complex: Box rotation usually requires a wrapper group or geometry offset.
        // For simplicity, let's assume standard cubes first. 
        // If rotation exists, we need to:
        // 1. Move mesh so its center matches rotation pivot.
        // 2. Rotate mesh.
        // 3. Move mesh back to visual position.
        
        // Implementing simple version:
        mesh.rotation.x = THREE.MathUtils.degToRad(-cubeData.rotation[0]);
        mesh.rotation.y = THREE.MathUtils.degToRad(-cubeData.rotation[1]);
        mesh.rotation.z = THREE.MathUtils.degToRad(cubeData.rotation[2]);
        
        // Correct position for pivoted rotation would require a parent Group for the cube.
        // Leaving as TODO for refinement.
    }

    return mesh;
}

function applyBedrockUV(geometry, uvData, size) {
    // uvData can be Box UV ([u, v]) or Per-Face UV ({north:..., south:...})
    
    const uvAttribute = geometry.attributes.uv;
    
    // Helper to set UV for a face (4 vertices)
    // Face indices in BoxGeometry: 
    // 0: +x (Right/East), 1: -x (Left/West), 2: +y (Top/Up), 3: -y (Bottom/Down), 4: +z (Front/North), 5: -z (Back/South)
    // Wait, Three.js BoxGeometry face order:
    // 0, 1: +x (Right)
    // 2, 3: -x (Left)
    // 4, 5: +y (Top)
    // 6, 7: -y (Bottom)
    // 8, 9: +z (Front)
    // 10, 11: -z (Back)
    
    // Standard Minecraft mapping:
    // North: Front, South: Back, East: Right, West: Left, Up: Top, Down: Bottom
    
    // We need to map Minecraft faces to Three.js faces.
    // Three.js +Z is Front. Minecraft North is often -Z.
    // Let's assume standard mapping and fix orientation later.

    function setFaceUV(faceIndex, u, v, w, h, rotate = false) {
        // Normalize
        const u0 = u / textureWidth;
        const v0 = (textureHeight - v - h) / textureHeight; // Flip Y? Bedrock V starts from top. Three.js V starts from bottom.
        const u1 = (u + w) / textureWidth;
        const v1 = (textureHeight - v) / textureHeight;

        // 4 vertices per face in BoxGeometry (since it's not indexed or we treat it as 2 triangles)
        // Actually BoxGeometry is indexed. But non-indexed attribute access works by vertex index.
        // Each face has 4 corners. 
        // Order: BottomLeft, BottomRight, TopLeft, TopRight (usually)
        
        // Let's use a simplified approach assuming standard UV layout
        // For per-face UV, we iterate over faces.
        
        // BoxGeometry has 24 vertices (4 per face * 6 faces).
        const offset = faceIndex * 4;
        
        // Standard Quad: 
        // 0: top-left, 1: top-right, 2: bottom-left, 3: bottom-right (Depends on construction)
        // Three.js PlaneBufferGeometry: 0:TL, 1:TR, 2:BL, 3:BR? No.
        
        // Let's try standard mapping:
        // 0: (0, 1) - Top Left
        // 1: (1, 1) - Top Right
        // 2: (0, 0) - Bottom Left
        // 3: (1, 0) - Bottom Right
        
        // Inverted Y for texture coords usually
        
        uvAttribute.setXY(offset + 0, u0, v1); // top-left?
        uvAttribute.setXY(offset + 1, u1, v1); // top-right?
        uvAttribute.setXY(offset + 2, u0, v0); // bottom-left?
        uvAttribute.setXY(offset + 3, u1, v0); // bottom-right?
    }
    
    // Check format
    if (Array.isArray(uvData)) {
        // Box UV logic (Simplified)
        // Not implemented for this demo as Sakuya uses Per-Face
    } else {
        // Per-Face UV
        // Three.js faces: Right, Left, Top, Bottom, Front, Back
        // MC faces: East, West, Up, Down, North, South
        
        const map = {
            east: 0,  // +x
            west: 1,  // -x
            up: 2,    // +y
            down: 3,  // -y
            south: 4, // +z
            north: 5  // -z
        };
        
        for (const [faceName, faceData] of Object.entries(uvData)) {
            const faceIndex = map[faceName];
            if (faceIndex === undefined) continue;
            
            const u = faceData.uv[0];
            const v = faceData.uv[1];
            const w = faceData.uv_size[0];
            const h = faceData.uv_size[1];
            
            setFaceUV(faceIndex, u, v, w, h);
        }
    }
    
    uvAttribute.needsUpdate = true;
}
