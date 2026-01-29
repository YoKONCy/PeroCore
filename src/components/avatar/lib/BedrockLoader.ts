import * as THREE from 'three';
import { AnimationManager } from './AnimationManager';

export class BedrockLoader {
    boneMap: any = {};
    textureWidth: number = 64;
    textureHeight: number = 64;

    constructor() {
        this.boneMap = {};
    }

    async load(config: any, animManager: AnimationManager): Promise<THREE.Group> {
        this.boneMap = {}; // Reset
        const rootGroup = new THREE.Group();

        // Helper for fetch with timeout
        // 带超时的 fetch 助手
        const fetchWithTimeout = async (url: string, timeout = 10000) => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);
            try {
                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(id);
                return response;
            } catch (error) {
                clearTimeout(id);
                throw error;
            }
        };

        // Load Texture
        // 加载纹理
        const textureLoader = new THREE.TextureLoader();
        const texture = await new Promise<THREE.Texture>((resolve, reject) => {
            // Add timeout for texture loading
            // 为纹理加载添加超时
            const timer = setTimeout(() => reject(new Error(`Texture load timeout: ${config.texture}`)), 10000);
            
            textureLoader.load(
                config.texture, 
                (t) => {
                    clearTimeout(timer);
                    resolve(t);
                }, 
                undefined, 
                (err) => {
                    clearTimeout(timer);
                    reject(err);
                }
            );
        });
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;

        // Use MeshStandardMaterial for more realistic PBR lighting
        // 使用 MeshStandardMaterial 进行更逼真的 PBR 光照
        const material = new THREE.MeshStandardMaterial({
            map: texture,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
            roughness: 0.4, // Lower roughness for more specular highlights (smoother surface) // 较低的粗糙度以获得更多的高光（更光滑的表面）
            metalness: 0.1, // Slight metalness for better light response // 轻微的金属感以获得更好的光照响应
            emissive: 0x000000,
            emissiveIntensity: 0
        });

        rootGroup.traverse((child: any) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        // Load Main Model
        // 加载主模型
        await this.loadJsonModel(config.model, material, rootGroup, true, fetchWithTimeout);
        
        // Load Arm Model
        // 加载手臂模型
        if (config.arm) {
            await this.loadJsonModel(config.arm, material, rootGroup, false, fetchWithTimeout);
        }

        // Pass boneMap to AnimationManager
        // 将 boneMap 传递给 AnimationManager
        animManager.setBoneMap(this.boneMap);
        
        // Load Animation
        // 加载动画
        await animManager.load(config);

        return rootGroup;
    }

    async loadJsonModel(path: string, material: THREE.Material, rootGroup: THREE.Group, isMain: boolean, fetchFn: Function = fetch) {
        try {
            const response = await fetchFn(path);
            if (!response.ok) {
                console.warn(`Failed to load ${path}`);
                return;
            }
            const json = await response.json();

        // Parse Bedrock Model
        // 解析 Bedrock 模型
        const geometryData = json['minecraft:geometry'][0];
        const description = geometryData.description;
        
        if (isMain) {
            this.textureWidth = description.texture_width;
            this.textureHeight = description.texture_height;
        }

        let bones = geometryData.bones;
        const localBoneMap: any = {};

        // Filter GUI bones (Rossi specific)
        // 过滤 GUI 骨骼 (Rossi 专用)
        if (path.includes('Rossi')) {
            const guiBones = ['GUI', 'Hud', 'Panel', 'Button', 'Text', 'Start', 'End', 'background', 'molang'];
            bones = bones.filter((b: any) => {
                const name = b.name;
                if (name === 'Start' || name === 'End') return false;
                if (guiBones.some(gui => name.includes(gui))) return false;
                return true;
            });
        }

        // Pass 1: Create Groups
        // 第一遍: 创建组
        bones.forEach((boneData: any) => {
            let boneGroup;
            
            if (this.boneMap[boneData.name] && this.boneMap[boneData.name].length > 0) {
                boneGroup = this.boneMap[boneData.name][0];
                localBoneMap[boneData.name] = boneGroup;
            } else {
                boneGroup = new THREE.Group();
                boneGroup.name = boneData.name;
                boneGroup.userData = boneData;
                
                localBoneMap[boneData.name] = boneGroup;
                
                if (!this.boneMap[boneData.name]) {
                    this.boneMap[boneData.name] = [];
                }
                this.boneMap[boneData.name].push(boneGroup);
            }
        });

        // Pass 2: Build Hierarchy & Geometry
        // 第二遍: 构建层级和几何体
        bones.forEach((boneData: any) => {
            const boneGroup = localBoneMap[boneData.name];
            const isReused = boneGroup.parent !== null;
            
            if (!isReused) {
                let parentGroup = null;
                if (boneData.parent) {
                    parentGroup = localBoneMap[boneData.parent];
                    if (!parentGroup && this.boneMap[boneData.parent]) {
                        parentGroup = this.boneMap[boneData.parent][0];
                    }
                } else if (!isMain) {
                     // Attach arm/hand to body automatically
                     // 自动将手臂/手附加到身体
                     const bodyBoneNames = ['UpperBody', 'UpBody', 'Body', 'AllBody', 'Torso'];
                     if (boneData.name.includes('Arm') || boneData.name.includes('Hand')) {
                         for (const bodyName of bodyBoneNames) {
                             const target = this.boneMap[bodyName];
                             if (target && target.length > 0) {
                                 parentGroup = target[0];
                                 break;
                             }
                         }
                     }
                }

                if (parentGroup) {
                    parentGroup.add(boneGroup);
                } else {
                    if (isMain && !boneData.parent) {
                         boneGroup.rotation.y = Math.PI;
                    }
                    rootGroup.add(boneGroup);
                }

                const pivot = boneData.pivot || [0, 0, 0];
                const parentPivot = (parentGroup && parentGroup.userData && parentGroup.userData.pivot) 
                                    ? parentGroup.userData.pivot 
                                    : [0, 0, 0];

                boneGroup.position.set(
                    pivot[0] - parentPivot[0],
                    pivot[1] - parentPivot[1],
                    pivot[2] - parentPivot[2]
                );

                if (boneData.rotation) {
                    boneGroup.rotation.order = 'ZXY';
                    boneGroup.rotation.x = THREE.MathUtils.degToRad(-boneData.rotation[0]);
                    boneGroup.rotation.y = THREE.MathUtils.degToRad(-boneData.rotation[1]);
                    boneGroup.rotation.z = THREE.MathUtils.degToRad(-boneData.rotation[2]);
                }
            }

            if (boneData.cubes) {
                const effectivePivot = boneGroup.userData.pivot || [0, 0, 0];
                boneData.cubes.forEach((cubeData: any) => {
                    const mesh = this.createCubeMesh(cubeData, material, effectivePivot);
                    boneGroup.add(mesh);
                });
            }
        });
        } catch (e) {
            console.warn(`Failed to parse model ${path}`, e);
        }
    }

    createCubeMesh(cubeData: any, material: THREE.Material, bonePivot: number[]) {
        const origin = cubeData.origin || [0, 0, 0];
        const size = cubeData.size || [1, 1, 1];
        const inflation = cubeData.inflate || 0;

        const geometry = new THREE.BoxGeometry(
            size[0] + inflation * 2, 
            size[1] + inflation * 2, 
            size[2] + inflation * 2
        );

        if (cubeData.uv) {
            this.applyBedrockUV(geometry, cubeData.uv, size, cubeData.mirror);
        }

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        if (cubeData.rotation) {
            const cubePivot = cubeData.pivot || [0, 0, 0];
            const pivotGroup = new THREE.Group();
            pivotGroup.position.set(
                cubePivot[0] - bonePivot[0],
                cubePivot[1] - bonePivot[1],
                cubePivot[2] - bonePivot[2]
            );
            
            pivotGroup.rotation.order = 'ZXY';
            pivotGroup.rotation.x = THREE.MathUtils.degToRad(-cubeData.rotation[0]);
            pivotGroup.rotation.y = THREE.MathUtils.degToRad(-cubeData.rotation[1]);
            pivotGroup.rotation.z = THREE.MathUtils.degToRad(-cubeData.rotation[2]);

            mesh.position.set(
                origin[0] + size[0] / 2 - cubePivot[0],
                origin[1] + size[1] / 2 - cubePivot[1],
                origin[2] + size[2] / 2 - cubePivot[2]
            );
            
            pivotGroup.add(mesh);
            return pivotGroup;
        } else {
            mesh.position.set(
                origin[0] + size[0] / 2 - bonePivot[0],
                origin[1] + size[1] / 2 - bonePivot[1],
                origin[2] + size[2] / 2 - bonePivot[2]
            );
            return mesh;
        }
    }

    applyBedrockUV(geometry: THREE.BufferGeometry, uvData: any, size: number[], mirror: boolean = false) {
        const uvAttribute = geometry.attributes.uv;
        const textureWidth = this.textureWidth;
        const textureHeight = this.textureHeight;
        
        function setFaceUV(faceIndex: number, u: number, v: number, w: number, h: number) {
            let u0 = u / textureWidth;
            let u1 = (u + w) / textureWidth;
            
            if (mirror) {
                [u0, u1] = [u1, u0];
            }

            const v0 = (textureHeight - v - h) / textureHeight; 
            const v1 = (textureHeight - v) / textureHeight;

            const offset = faceIndex * 4;
            uvAttribute.setXY(offset + 0, u0, v1); 
            uvAttribute.setXY(offset + 1, u1, v1); 
            uvAttribute.setXY(offset + 2, u0, v0); 
            uvAttribute.setXY(offset + 3, u1, v0); 
        }
        
        if (Array.isArray(uvData)) {
            const u = uvData[0];
            const v = uvData[1];
            
            const snap = (val: number) => Math.max(1, Math.floor(val));
            const w = snap(size[0]);
            const h = snap(size[1]);
            const d = snap(size[2]);

            setFaceUV(2, u + d, v, w, d);         // Up
            setFaceUV(3, u + d + w, v, w, d);     // Down
            setFaceUV(1, u, v + d, d, h);         // West
            setFaceUV(5, u + d, v + d, w, h);     // North
            setFaceUV(0, u + d + w, v + d, d, h); // East
            setFaceUV(4, u + d + w + d, v + d, w, h); // South
        } else {
            const map: any = { east: 0, west: 1, up: 2, down: 3, south: 4, north: 5 };
            for (const [faceName, faceData] of Object.entries(uvData) as [string, any][]) {
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
}
