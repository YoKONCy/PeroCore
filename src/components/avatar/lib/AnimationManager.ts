import * as THREE from 'three';
import { molang, molangContext } from './Molang';

export class AnimationController {
    name: string;
    states: any;
    initialState: string;
    currentStateName: string;
    manager: AnimationManager;
    stateTime: number;

    constructor(name: string, data: any, manager: AnimationManager) {
        this.name = name;
        this.states = data.states;
        this.initialState = data.initial_state;
        this.currentStateName = this.initialState;
        this.manager = manager;
        this.stateTime = 0;
        
        if (!this.currentStateName && this.states) {
            this.currentStateName = Object.keys(this.states)[0];
        }
        
        if (this.currentStateName) {
            this.enterState(this.currentStateName);
        }
    }

    enterState(stateName: string) {
        const state = this.states[stateName];
        if (!state) return;
        
        if (state.on_entry) {
            state.on_entry.forEach((expr: string) => molang.eval(expr));
        }

        this.currentStateName = stateName;
        this.stateTime = 0;
    }
    
    update(dt: number) {
        const state = this.states[this.currentStateName];
        if (!state) return;

        this.stateTime += dt;
        
        if (state.transitions) {
            for (const trans of state.transitions) {
                for (const [target, condition] of Object.entries(trans)) {
                    if (molang.eval(condition)) {
                        if (state.on_exit) {
                            state.on_exit.forEach((expr: string) => molang.eval(expr));
                        }
                        this.enterState(target);
                        return;
                    }
                }
            }
        }
        
        if (state.animations) {
            state.animations.forEach((animEntry: any) => {
                let animName = null;
                if (typeof animEntry === 'string') {
                    animName = animEntry;
                } else {
                    for (const [name, cond] of Object.entries(animEntry)) {
                        if (molang.eval(cond)) {
                            animName = name;
                            break;
                        }
                    }
                }
                
                if (animName) {
                    this.manager.playLayerAnimation(animName, this.stateTime);
                }
            });
        }
    }
}

export class AnimationManager {
    animations: any = {};
    controllers: AnimationController[] = [];
    legacyAnim: any = null;
    startTime: number = 0;
    isPlaying: boolean = false;
    boneMap: any = {}; // Passed from loader
    // Passed from loader
    // 从 loader 传递
    debugAnim: any = null; // For forced debug playback
    // For forced debug playback
    // 用于强制调试播放
    debugStartTime: number = 0;
    headBones: any[] | null = null;

    constructor() {
        this.animations = {};
        this.controllers = [];
    }

    setBoneMap(map: any) {
        this.boneMap = map;
        this.headBones = null; // Reset cache
    }

    async load(config: any) {
        this.stop();
        this.animations = {};
        this.controllers = [];
        this.legacyAnim = null;
        
        // Helper for fetch with timeout
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

        // 1. Load Animations (Parallel)
        let animPaths: string[] = [];
        if (config.animation) {
             animPaths = Array.isArray(config.animation) ? config.animation : [config.animation];
        } else if (config.model && config.model.endsWith('.json')) {
            animPaths = [config.model.replace('.json', '.animation.json')];
        }

        const animPromises = animPaths.map(async (path) => {
            try {
                // Remove cache busting to allow browser caching
                // 移除缓存破坏以允许浏览器缓存
                const response = await fetchWithTimeout(path);
                if (!response.ok) {
                    console.warn(`获取动画失败 ${path}: ${response.statusText}`);
                    return;
                }
                const json = await response.json();
                const anims = json.animations;
                if (!anims) return;

                for (const [name, data] of Object.entries(anims)) {
                    this.animations[name] = this.parseAnimation(data);
                }
            } catch (e) {
                console.warn(`动画加载失败 ${path}`, e);
            }
        });
        await Promise.all(animPromises);
        
        // 2. Load Controllers (Parallel)
        // 2. 加载控制器 (并行)
        if (config.animation_controllers) {
            const ctrlPaths = Array.isArray(config.animation_controllers) ? config.animation_controllers : [config.animation_controllers];
            const ctrlPromises = ctrlPaths.map(async (path: string) => {
                 try {
                    const response = await fetchWithTimeout(path);
                    if (!response.ok) {
                        console.warn(`获取控制器失败 ${path}: ${response.statusText}`);
                        return;
                    }
                    const json = await response.json();
                    const ctrls = json.animation_controllers;
                    if (!ctrls) return;

                    for (const [name, data] of Object.entries(ctrls)) {
                        this.controllers.push(new AnimationController(name, data, this));
                    }
                } catch (e) {
                    console.error(`控制器加载失败 ${path}`, e);
                }
            });
            await Promise.all(ctrlPromises);
        }

        // Auto-start
        if (this.controllers.length > 0) {
            this.isPlaying = true;
            this.startTime = Date.now() / 1000;
        } else {
            // Legacy Mode
            // 遗留模式
            const animNames = Object.keys(this.animations);
            if (animNames.length > 0) {
                // Prioritize 'idle' over 'tac:idle'
                // 优先于 'tac:idle' 选择 'idle'
                let idleAnim: string | undefined = animNames.find(n => n === 'idle');
                
                if (!idleAnim) {
                    idleAnim = animNames.find(n => n === 'tac:idle');
                }
                
                if (!idleAnim) {
                    idleAnim = animNames.find(n => n.toLowerCase().includes('idle') || n.toLowerCase().includes('wait')) || animNames[0];
                }
                
                // Check if idleAnim is defined before passing it
                // 传递前检查 idleAnim 是否已定义
                if (idleAnim) {
                    this.playLegacy(idleAnim);
                }
            }
        }
    }

    parseAnimation(data: any) {
        const parsedBones: any = {};
        if (!data.bones) return null;

        for (const [boneName, tracks] of Object.entries(data.bones) as [string, any][]) {
            parsedBones[boneName] = {};
            if (tracks.rotation) parsedBones[boneName].rotation = this.parseTrack(tracks.rotation);
            if (tracks.position) parsedBones[boneName].position = this.parseTrack(tracks.position);
            if (tracks.scale) parsedBones[boneName].scale = this.parseTrack(tracks.scale);
        }

        return {
            loop: data.loop !== false,
            length: data.animation_length || 0,
            bones: parsedBones
        };
    }

    parseTrack(trackData: any) {
        if (typeof trackData === 'string' || typeof trackData === 'number') {
            return [{ time: 0, value: [trackData, trackData, trackData] }];
        }
        if (Array.isArray(trackData)) {
            return [{ time: 0, value: trackData }];
        } else if (typeof trackData === 'object') {
            const keyframes = [];
            for (const [timeStr, value] of Object.entries(trackData) as [string, any][]) {
                let vec = value;
                let lerpMode = 'linear';

                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    if (value.post) vec = value.post;
                    if (value.lerp_mode) lerpMode = value.lerp_mode;
                }

                if (Array.isArray(vec)) {
                    keyframes.push({
                        time: parseFloat(timeStr),
                        value: vec,
                        lerpMode: lerpMode
                    });
                }
            }
            keyframes.sort((a, b) => a.time - b.time);
            return keyframes;
        }
        return [];
    }

    playLegacy(name: string) {
        if (!name) {
            this.legacyAnim = null;
            return;
        }
        if (this.animations[name]) {
            this.legacyAnim = this.animations[name];
            this.startTime = Date.now() / 1000;
            this.isPlaying = true;
            
            const lowerName = name.toLowerCase();
            molangContext.query.is_moving = (lowerName.includes('walk') || lowerName.includes('run') || lowerName.includes('move')) ? 1 : 0;
            molangContext.query.ground_speed = molangContext.query.is_moving ? 0.2 : 0;
        }
    }
    
    playLayerAnimation(animName: string, stateTime: number) {
        const anim = this.animations[animName];
        if (!anim) return;
        this.applyAnimationToBones(anim, stateTime);
    }

    stop() {
        this.isPlaying = false;
        this.legacyAnim = null;
        this.debugAnim = null;
        this.controllers = [];
    }

    update() {
        if (!this.isPlaying) return;

        const now = Date.now() / 1000;
        const dt = 1/60; 
        molangContext.query.life_time += dt;

        this.resetBones();

        if (this.debugAnim) {
            // Debug mode: play forced animation
            let time = now - this.debugStartTime;
            if (this.debugAnim.loop && this.debugAnim.length > 0) {
                 time = time % this.debugAnim.length;
            } else if (!this.debugAnim.loop && time > this.debugAnim.length) {
                time = this.debugAnim.length;
            }
            molangContext.query.anim_time = time;
            this.applyAnimationToBones(this.debugAnim, time);
        } else if (this.legacyAnim) {
            let time = now - this.startTime;
            if (this.legacyAnim.length > 0) {
                 time = time % this.legacyAnim.length;
            }
            molangContext.query.anim_time = time;
            
            molangContext.temp = new Proxy({}, {
                get: (target: any, prop: string) => {
                    return prop in target ? target[prop] : 0;
                }
            });
            
            this.applyAnimationToBones(this.legacyAnim, time);
        } else if (this.controllers.length > 0) {
            this.controllers.forEach(ctrl => ctrl.update(dt));
        }

        this.applyHeadRotation();
    }
    
    applyHeadRotation() {
        const headX = molangContext.query.head_x_rotation;
        const headY = molangContext.query.head_y_rotation;
        
        // Always cache head bones if not done yet
        // 如果尚未完成，始终缓存头部骨骼
        if (!this.headBones) {
            this.headBones = [];
            for (const name in this.boneMap) {
                if (name.toLowerCase() === 'head') {
                    this.headBones.push(...this.boneMap[name]);
                }
            }
        }

        if (headX === 0 && headY === 0) return;

        this.headBones.forEach(g => {
             g.userData.animRot = true;
             // Apply rotation on top of existing animation
             // Using same coordinate convention as applyAnimationToBones (-x, -y)
             g.rotation.x += THREE.MathUtils.degToRad(-headX);
             g.rotation.y += THREE.MathUtils.degToRad(-headY);
        });
    }

    playDebug(name: string) {
        if (!this.animations[name]) {
            console.warn(`未找到动画 ${name}`);
            return;
        }
        this.debugAnim = this.animations[name];
        this.debugStartTime = Date.now() / 1000;
        this.isPlaying = true;
        console.log(`[调试] 播放 ${name}`);
    }

    resetBones() {
        for (const name in this.boneMap) {
            const groups = this.boneMap[name];
            groups.forEach((g: any) => {
                if (g.userData.animRot) {
                    const base = g.userData.rotation || [0, 0, 0];
                    g.rotation.x = THREE.MathUtils.degToRad(-base[0]);
                    g.rotation.y = THREE.MathUtils.degToRad(-base[1]);
                    g.rotation.z = THREE.MathUtils.degToRad(-base[2]);
                    g.userData.animRot = false; 
                }
                if (g.userData.initialPos) {
                     g.position.copy(g.userData.initialPos);
                }
                g.scale.set(1, 1, 1);
            });
        }
    }

    applyAnimationToBones(anim: any, time: number, weight: number = 1.0) {
        let t = time;
        if (anim.loop && anim.length > 0) {
            t = time % anim.length;
        } else if (!anim.loop && t > anim.length) {
            t = anim.length;
        }

        for (const [boneName, tracks] of Object.entries(anim.bones) as [string, any][]) {
            const boneGroups = this.boneMap[boneName];
            if (!boneGroups) continue;

            boneGroups.forEach((boneGroup: any) => {
                // Rotation
                if (tracks.rotation) {
                    const val = this.evaluateTrack(tracks.rotation, t);
                    if (val) {
                        boneGroup.userData.animRot = true;
                        const targetX = -val[0];
                        const targetY = -val[1];
                        const targetZ = val[2];

                        if (weight >= 1.0) {
                            boneGroup.rotation.x = THREE.MathUtils.degToRad(targetX);
                            boneGroup.rotation.y = THREE.MathUtils.degToRad(targetY);
                            boneGroup.rotation.z = THREE.MathUtils.degToRad(targetZ);
                        } else {
                            const currentX = THREE.MathUtils.radToDeg(boneGroup.rotation.x);
                            const currentY = THREE.MathUtils.radToDeg(boneGroup.rotation.y);
                            const currentZ = THREE.MathUtils.radToDeg(boneGroup.rotation.z);
                            
                            const newX = molangContext.math.lerprotate(currentX, targetX, weight);
                            const newY = molangContext.math.lerprotate(currentY, targetY, weight);
                            const newZ = molangContext.math.lerprotate(currentZ, targetZ, weight);
                            
                            boneGroup.rotation.x = THREE.MathUtils.degToRad(newX);
                            boneGroup.rotation.y = THREE.MathUtils.degToRad(newY);
                            boneGroup.rotation.z = THREE.MathUtils.degToRad(newZ);
                        }
                    }
                }

                // Position
                // 位置
                if (tracks.position) {
                    const val = this.evaluateTrack(tracks.position, t);
                    if (val) {
                        if (!boneGroup.userData.initialPos) {
                            boneGroup.userData.initialPos = boneGroup.position.clone();
                        }
                        const init = boneGroup.userData.initialPos;
                        const offX = val[0];
                        const offY = val[1];
                        const offZ = val[2];
                        
                        if (weight >= 1.0) {
                            boneGroup.position.set(init.x + offX, init.y + offY, init.z + offZ);
                        } else {
                            const currentPos = boneGroup.position;
                            const targetX = init.x + offX;
                            const targetY = init.y + offY;
                            const targetZ = init.z + offZ;
                            
                            boneGroup.position.x = molangContext.math.lerp(currentPos.x, targetX, weight);
                            boneGroup.position.y = molangContext.math.lerp(currentPos.y, targetY, weight);
                            boneGroup.position.z = molangContext.math.lerp(currentPos.z, targetZ, weight);
                        }
                    }
                }

                // Scale
                // 缩放
                if (tracks.scale) {
                    const val = this.evaluateTrack(tracks.scale, t);
                    if (val) {
                        if (weight >= 1.0) {
                            boneGroup.scale.set(val[0], val[1], val[2]);
                        } else {
                            boneGroup.scale.x = molangContext.math.lerp(boneGroup.scale.x, val[0], weight);
                            boneGroup.scale.y = molangContext.math.lerp(boneGroup.scale.y, val[1], weight);
                            boneGroup.scale.z = molangContext.math.lerp(boneGroup.scale.z, val[2], weight);
                        }
                    }
                }
            });
        }
    }

    evaluateTrack(keyframes: any[], time: number) {
        if (keyframes.length === 0) return null;
        
        const resolve = (vec: any) => [
            molang.eval(vec[0]),
            molang.eval(vec[1]),
            molang.eval(vec[2])
        ];

        const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number) => {
            const v0 = (p2 - p0) * 0.5;
            const v1 = (p3 - p1) * 0.5;
            const t2 = t * t;
            const t3 = t * t2;
            return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
        };

        if (keyframes.length === 1) return resolve(keyframes[0].value);

        let nextIdx = keyframes.findIndex(k => k.time > time);
        
        if (nextIdx === -1) return resolve(keyframes[keyframes.length - 1].value);
        if (nextIdx === 0) return resolve(keyframes[0].value);

        const prev = keyframes[nextIdx - 1];
        const next = keyframes[nextIdx];
        
        const range = next.time - prev.time;
        const t = range > 0 ? (time - prev.time) / range : 0;
        
        const v1 = resolve(prev.value);
        const v2 = resolve(next.value);
        
        if (prev.lerpMode === 'catmullrom') {
            const prevPrev = keyframes[nextIdx - 2] || prev;
            const nextNext = keyframes[nextIdx + 1] || next;
            
            const v0 = resolve(prevPrev.value);
            const v3 = resolve(nextNext.value);
            
            return [
                catmullRom(v0[0], v1[0], v2[0], v3[0], t),
                catmullRom(v0[1], v1[1], v2[1], v3[1], t),
                catmullRom(v0[2], v1[2], v2[2], v3[2], t)
            ];
        }

        return [
            v1[0] + (v2[0] - v1[0]) * t,
            v1[1] + (v2[1] - v1[1]) * t,
            v1[2] + (v2[2] - v1[2]) * t
        ];
    }
}
