use bevy::prelude::*;
use rand::prelude::*;

#[derive(Component)]
struct HeadBone;

// 找到并标记头部骨骼
fn setup_head_bone(
    mut commands: Commands,
    query: Query<(Entity, &Name), Added<Name>>,
) {
    for (entity, name) in &query {
        if name.as_str() == "J_Bip_C_Head" {
            commands.entity(entity).insert(HeadBone);
            println!("Success: Found Head Bone entity: {:?}", entity);
        }
    }
}

// 头部跟随鼠标旋转
fn head_look_at(
    time: Res<Time>,
    windows: Query<&Window>,
    camera_query: Query<(&Camera, &GlobalTransform)>,
    mut head_query: Query<&mut Transform, With<HeadBone>>,
) {
    let window = windows.single();
    let (camera, camera_transform) = camera_query.single();

    if let Some(cursor_pos) = window.cursor_position() {
        if let Some(ray) = camera.viewport_to_world(camera_transform, cursor_pos) {
            let target = ray.origin + ray.direction * (ray.origin.z / -ray.direction.z);
            
            for mut transform in &mut head_query {
                let head_pos = Vec3::new(0.0, 1.4, 0.0);
                let direction = target - head_pos;
                
                let yaw = (direction.x * 0.4).clamp(-0.6, 0.6);
                let pitch = (-direction.y * 0.4).clamp(-0.4, 0.4);
                
                let target_rotation = Quat::from_euler(EulerRot::YXZ, yaw, pitch, 0.0);
                // 平滑插值
                transform.rotation = transform.rotation.slerp(target_rotation, time.delta_seconds() * 5.0);
            }
        }
    }
}

#[derive(Component)]
struct MaterialReplaced;

// 修复材质渲染问题 (Z-fighting/透明度排序)
// 对于面部，强制替换为全新的 StandardMaterial 以确保 Morph Targets 生效
fn fix_materials(
    mut commands: Commands,
    mut materials: ResMut<Assets<StandardMaterial>>,
    // 移除 With<Handle<Mesh>> 以排除过滤干扰
    query: Query<(Entity, Option<&Handle<StandardMaterial>>, &Name), Without<MaterialReplaced>>,
) {
    for (entity, handle_opt, name) in &query {
        let name_str = name.as_str();
        
        // 只关注 Face 相关的实体进行调试
        if name_str.contains("Face") {
            // println!("DEBUG: fix_materials found Face: {}", name_str);
            
            if let Some(handle) = handle_opt {
                if let Some(mat) = materials.get_mut(handle) {
                    // 通用修复
                    mat.cull_mode = None;
                    if mat.alpha_mode == AlphaMode::Blend {
                        mat.alpha_mode = AlphaMode::Mask(0.5);
                    }
                    mat.perceptual_roughness = 0.8;
                    mat.reflectance = 0.1;

                    // 强制替换逻辑
                    let new_mat = StandardMaterial {
                                base_color: mat.base_color,
                                base_color_texture: mat.base_color_texture.clone(),
                                alpha_mode: AlphaMode::Mask(0.5),
                                cull_mode: None,
                                perceptual_roughness: 0.8,
                                reflectance: 0.1,
                                unlit: false,
                                double_sided: true, 
                                ..default()
                            };
                    
                    let new_handle = materials.add(new_mat);
                    commands.entity(entity).insert(new_handle);
                    println!("System: REPLACED material for Face entity: {}", name_str);
                    
                    commands.entity(entity).insert(MaterialReplaced);
                }
            } else {
                 // println!("DEBUG: Face {} has NO material handle", name_str);
            }
        } else if handle_opt.is_some() {
             // 非 Face 实体也标记为已处理，避免重复检查
             commands.entity(entity).insert(MaterialReplaced);
        }
    }
}

fn main() {
    App::new()
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "Pero View3D".into(),
                resolution: (800.0, 600.0).into(),
                transparent: true,
                decorations: false,
                ..default()
            }),
            ..default()
        }))
        .insert_resource(ClearColor(Color::NONE))
        .init_resource::<FaceAnimationState>() // 初始化面部动画全局状态
        .add_systems(Startup, setup)
        .add_systems(Update, (
            remove_animation_player,
            fix_materials,
            ensure_morphs,
            animate_face,
            animate_breathe,
            setup_head_bone,
            head_look_at,
            debug_hierarchy,
            force_mesh_update_system,
        ))
        .run();
}

#[derive(Component)]
struct PeroModel;

#[derive(Resource)]
struct ViewState {
    rotation_offset: f32,
}

fn setup(mut commands: Commands, asset_server: Res<AssetServer>) {
    // 初始化视角状态 (默认旋转 180 度，因为之前发现是背对的)
    commands.insert_resource(ViewState { rotation_offset: std::f32::consts::PI });

    // Camera
    commands.spawn(Camera3dBundle {
        transform: Transform::from_xyz(0.0, 1.4, 0.8).looking_at(Vec3::new(0.0, 1.2, 0.0), Vec3::Y),
        ..default()
    });

    // Light
    commands.spawn(DirectionalLightBundle {
        directional_light: DirectionalLight {
            shadows_enabled: true,
            illuminance: 3000.0,
            ..default()
        },
        transform: Transform::from_xyz(2.0, 5.0, 5.0).looking_at(Vec3::ZERO, Vec3::Y),
        ..default()
    });
    
    // Ambient Light
    commands.insert_resource(AmbientLight {
        color: Color::WHITE,
        brightness: 800.0,
    });

    // Load GLB
    // 加载修复后的单一网格模型
    commands.spawn(SceneBundle {
        scene: asset_server.load("models/pero_fixed.glb#Scene0"),
        transform: Transform::from_xyz(0.0, -0.2, 0.0), 
        ..default()
    })
    .insert(PeroModel); // 标记根节点，用于旋转/浮动
}

// 呼吸/悬浮效果 + 按键控制旋转
fn animate_breathe(
    time: Res<Time>, 
    mut query: Query<&mut Transform, With<PeroModel>>,
    input: Res<ButtonInput<KeyCode>>,
    mut view_state: ResMut<ViewState>
) {
    // 空格键旋转 180 度
    if input.just_pressed(KeyCode::Space) {
        view_state.rotation_offset += std::f32::consts::PI;
        println!("Action: Rotated model. Current offset: {:.2}", view_state.rotation_offset);
    }

    for mut transform in &mut query {
        transform.translation.y = -0.2 + (time.elapsed_seconds() * 2.0).sin() * 0.03;
        // 基础旋转 + 呼吸摆动
        let wiggle = (time.elapsed_seconds() * 0.5).sin() * 0.05;
        transform.rotation = Quat::from_rotation_y(view_state.rotation_offset + wiggle);
    }
}

// 专门移除 AnimationPlayer 的系统 (全局清理)
fn remove_animation_player(
    mut commands: Commands,
    query: Query<Entity, With<AnimationPlayer>>
) {
    for entity in &query {
        commands.entity(entity).remove::<AnimationPlayer>();
        println!("System: Force removed AnimationPlayer from entity {:?}", entity);
    }
}

#[derive(Component)]
struct FaceControl {
    /// 缓存 Morph Target 索引
    eye_close_indices: Vec<usize>,
    mouth_a_index: Option<usize>,
    joy_indices: Vec<usize>,
}

#[derive(Component)]
struct ForceMeshUpdate;

fn force_mesh_update_system(
    mut commands: Commands,
    mut query: Query<(Entity, &mut Handle<Mesh>), With<ForceMeshUpdate>>,
) {
    for (entity, mut mesh_handle) in &mut query {
        // 通过 clone 和重新赋值来触发变更检测
        let new_handle = mesh_handle.clone();
        *mesh_handle = new_handle;
        
        commands.entity(entity).remove::<ForceMeshUpdate>();
        println!("DEBUG: Forced mesh update for entity {:?}", entity);
    }
}

#[derive(Resource)]
struct FaceAnimationState {
    next_blink: Timer,
    blink_duration: Timer,
    is_blinking: bool,
    blink_weight: f32,
    mouth_weight: f32,
}

impl Default for FaceAnimationState {
    fn default() -> Self {
        Self {
            next_blink: Timer::from_seconds(1.0, TimerMode::Once),
            blink_duration: Timer::from_seconds(0.3, TimerMode::Once),
            is_blinking: false,
            blink_weight: 0.0,
            mouth_weight: 0.0,
        }
    }
}

// 简化版的 ensure_morphs，直接利用 Bevy 自动加载的 MorphWeights
fn ensure_morphs(
    mut commands: Commands,
    // 查询所有带有 Mesh 句柄且还没有 FaceControl 的实体
    // 移除 Option<&MorphWeights>，直接查所有 Mesh 实体进行调试
    query: Query<(Entity, &Name, &Handle<Mesh>, Option<&Handle<StandardMaterial>>), Without<FaceControl>>,
    meshes: Res<Assets<Mesh>>,
) {
    for (entity, name, mesh_handle, mat_handle) in &query {
        let name_str = name.as_str();
        if name_str.contains("Face") {
            println!("DEBUG: ensure_morphs found Face entity: {}. Has Material: {}", name_str, mat_handle.is_some());
        }

        // 如果 Bevy 已经自动加载了 MorphWeights，或者网格有 morph targets
        if let Some(mesh) = meshes.get(mesh_handle) {
            // 如果没有 MorphWeights 组件，但网格本身有 morph targets (可能是加载延迟)
            if let Some(names) = mesh.morph_target_names() {
                if !names.is_empty() {
                    // 无论有没有 MorphWeights，我们都要添加 FaceControl
                    // 如果已经有 FaceControl (被上面的 Without<FaceControl> 过滤了)，就不会进来
                    
                    // println!("DEBUG: ensure_morphs processing Face: {}", name_str);
                    setup_face_control(&mut commands, entity, name, mesh_handle, &meshes);
                }
            }
        }
    }
}

fn setup_face_control(
    commands: &mut Commands,
    entity: Entity,
    name: &Name,
    mesh_handle: &Handle<Mesh>,
    meshes: &Assets<Mesh>,
) {
    if let Some(mesh) = meshes.get(mesh_handle) {
        if let Some(names) = mesh.morph_target_names() {
            let count = names.len();
            if count == 0 { return; }

            let entity_name = name.as_str();
            
            // 针对 pero_fixed.glb 优化：只关注 "Face_Merged"
            // 注意：Blender 导出时可能会保留节点名称，但也可能只是 Mesh 名称变了。
            // 我们放宽一点，只要包含 "Face" 就行，但重点关注 "Merged"
            if !entity_name.contains("Face") {
                return;
            }

            let mut eye_close_indices = Vec::new();
            let mut mouth_a_index = None;
            let mut joy_indices = Vec::new();

            println!("DEBUG: Analyzing morphs for Face entity: {}", entity_name);

            for (i, morph_name) in names.iter().enumerate() {
                let name_lower = morph_name.to_lowercase();
                
                // 眼睛闭合匹配逻辑优化
                if name_lower.contains("eye") && (name_lower.contains("close") || name_lower.contains("joy")) {
                     eye_close_indices.push(i);
                } else if name_lower.contains("blink") || name_lower.contains("闭眼") {
                    eye_close_indices.push(i);
                }
                
                // 嘴巴张开 (A)
                if (name_lower.contains("mth") || name_lower.contains("mouth")) && name_lower.contains("a") && !name_lower.contains("angry") {
                    mouth_a_index = Some(i);
                } else if name_lower == "aa" {
                    mouth_a_index = Some(i);
                }
                
                // 笑脸/开心
                if name_lower.contains("joy") || name_lower.contains("smile") || name_lower.contains("happy") || name_lower.contains("fun") {
                    joy_indices.push(i);
                }
            }

            // 只要是 Face 相关的实体，即使没匹配到（不太可能），也打印出来警告
            if eye_close_indices.is_empty() && mouth_a_index.is_none() && joy_indices.is_empty() {
                println!("WARN: Face entity {} found but NO known morph targets matched! Available: {:?}", entity_name, names);
            } else {
                println!("Success: FaceControl attached to {} (Eyes: {:?}, Mouth: {:?}, Joy: {:?})", 
                    entity_name, eye_close_indices, mouth_a_index, joy_indices);
                
                // 确保 MorphWeights 存在
                // 对于合并后的模型，Bevy 应该会自动添加 MorphWeights
                // 如果没有，我们手动添加。
                
                commands.entity(entity)
                    .insert(FaceControl {
                        eye_close_indices,
                        mouth_a_index,
                        joy_indices,
                    });
                    
                // 只有当没有 MorphWeights 时才添加 (通过 ensure_morphs 逻辑保证)
                // 这里我们不再强制 insert MorphWeights，以免覆盖 Bevy 的状态
            }
        }
    }
}

// 调试工具：打印场景层级，帮助定位是否有遮挡或重复模型
fn debug_hierarchy(
    input: Res<ButtonInput<KeyCode>>,
    query: Query<(Entity, Option<&Name>, Option<&Parent>, Option<&MorphWeights>, Option<&Handle<Mesh>>)>,
) {
    if input.just_pressed(KeyCode::KeyP) {
        println!("--- Scene Hierarchy Dump ---");
        for (entity, name, parent, weights, mesh) in &query {
            let name_str = name.map(|n| n.as_str()).unwrap_or("Unnamed");
            let parent_info = if let Some(p) = parent { format!("Parent: {:?}", p.get()) } else { "Root".to_string() };
            let weight_info = if weights.is_some() { "[Has MorphWeights]" } else { "" };
            let mesh_info = if mesh.is_some() { "[Has Mesh]" } else { "" };
            
            // 只打印有名字的或者有关键组件的，减少刷屏
            if name.is_some() || weights.is_some() || mesh.is_some() {
                 println!("Entity {:?}: '{}' | {} {} {}", entity, name_str, parent_info, mesh_info, weight_info);
            }
        }
        println!("----------------------------");
    }
}

// 面部表情动画系统 (全局同步版)
fn animate_face(
    time: Res<Time>,
    input: Res<ButtonInput<KeyCode>>,
    mut state: ResMut<FaceAnimationState>,
    mut query: Query<(Entity, &Name, &mut MorphWeights, &FaceControl, &mut Transform)>,
) {
    let dt = time.delta();
    let t = time.elapsed_seconds();
    let mut rng = rand::thread_rng();

    // 1. 更新全局动画状态 (确保所有面部碎片同步)
    // 眨眼逻辑
    if state.is_blinking {
        state.blink_duration.tick(dt);
        let progress = state.blink_duration.fraction();
        // 使用 sin 曲线实现闭合->张开 (0 -> 1 -> 0)
        state.blink_weight = (progress * std::f32::consts::PI).sin();

        if state.blink_duration.finished() {
            state.is_blinking = false;
            state.blink_weight = 0.0;
            // 随机下一次眨眼时间 (2~5秒)
            state.next_blink.set_duration(std::time::Duration::from_secs_f32(rng.gen_range(2.0..5.0)));
            state.next_blink.reset();
        }
    } else {
        state.next_blink.tick(dt);
        if state.next_blink.finished() {
            state.is_blinking = true;
            state.blink_duration.reset();
        }
        state.blink_weight = 0.0;
    }

    // 呼吸逻辑 (嘴巴大张大合，便于观察)
    // 频率加快: 5.0, 幅度: 0.0 ~ 1.0
    state.mouth_weight = (t * 5.0).sin() * 0.5 + 0.5;

    // 2. 应用到所有 FaceControl 实体
    let debug_mode = input.pressed(KeyCode::KeyT);
    
    // 限制日志频率
    let should_log = time.elapsed_seconds() % 2.0 < dt.as_secs_f32(); 

    for (entity, name, mut weights, control, _transform) in &mut query {
        let weights_slice = weights.weights_mut();

        if debug_mode {
             // 强制测试模式：最大化所有表情
             for &idx in &control.eye_close_indices { weights_slice[idx] = 1.0; }
             if let Some(idx) = control.mouth_a_index { weights_slice[idx] = 1.0; }
             for &idx in &control.joy_indices { weights_slice[idx] = 1.0; }
             continue;
        }

        // 应用眨眼
        for &idx in &control.eye_close_indices {
            weights_slice[idx] = state.blink_weight;
        }

        // 应用嘴巴呼吸
        if let Some(idx) = control.mouth_a_index {
            weights_slice[idx] = state.mouth_weight;
        }

        // 保持微笑
        for &idx in &control.joy_indices {
            weights_slice[idx] = 0.2;
        }
        
        // 打印调试信息
        if should_log && (state.is_blinking || state.mouth_weight > 0.2) {
            println!("DEBUG: Animating Entity {:?} ({}) | Blink: {:.3}, Mouth: {:.3}", entity, name.as_str(), state.blink_weight, state.mouth_weight);
        }
    }
}


