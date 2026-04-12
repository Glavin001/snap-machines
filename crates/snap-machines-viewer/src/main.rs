use std::{collections::HashMap, env, fs, path::PathBuf};

use bevy::{
    color::Color,
    input::mouse::{MouseMotion, MouseWheel},
    math::{
        Isometry3d, Mat3, Quat as BevyQuat, Vec3,
        primitives::{Capsule3d, Cuboid, Cylinder, Plane3d, Sphere},
    },
    prelude::*,
    window::PrimaryWindow,
};
use snap_machines_rapier::{
    ColliderKind, InputBinding, MachineControlTargetKind, MachineControls, MachinePlan,
    MachineRuntime, MotorInputTarget, PlannedCollider, Quat as SnapQuat, RapierSimulation,
    RuntimeBuildError, RuntimeInputState, RuntimeInputValue, SerializedMachineEnvelope,
    Transform as SnapTransform, Vec3 as SnapVec3, validate_machine_envelope,
};

const DEFAULT_FIXED_DT: f32 = 1.0 / 60.0;
const GROUND_HALF_EXTENT: f32 = 256.0;
const GROUND_THICKNESS: f32 = 0.5;
const GROUND_CLEARANCE: f32 = 0.05;

#[derive(Component)]
struct MainCamera;

#[derive(Component)]
struct HudText;

#[derive(Component)]
struct MountVisual {
    mount_id: String,
}

#[derive(Resource)]
struct CameraOrbit {
    yaw: f32,
    pitch: f32,
    distance: f32,
    target: Vec3,
}

impl Default for CameraOrbit {
    fn default() -> Self {
        Self {
            yaw: 0.7,
            pitch: 0.4,
            distance: 12.0,
            target: Vec3::new(0.0, 1.5, 0.0),
        }
    }
}

#[derive(Resource, Default)]
struct ViewerUiState {
    paused: bool,
    debug_overlay: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ViewerActuatorType {
    Velocity,
    Position,
    Trigger,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ViewerKeyBinding {
    positive_key: KeyCode,
    positive_label: String,
    negative_key: Option<KeyCode>,
    negative_label: Option<String>,
}

#[derive(Clone, Debug)]
struct ViewerControlEntry {
    action_name: String,
    original_action: String,
    actuator_type: ViewerActuatorType,
    binding: ViewerKeyBinding,
    scale: f32,
    default_target: f32,
    current_target: f32,
    limits: Option<(f32, f32)>,
}

#[derive(Clone, Debug)]
struct OriginalViewerBinding {
    action: String,
    scale: f32,
}

#[derive(Resource, Clone, Debug, Default)]
struct ViewerControls {
    entries: Vec<ViewerControlEntry>,
}

impl ViewerControls {
    fn from_plan(
        plan: &MachinePlan,
        controls: Option<&MachineControls>,
        originals: &HashMap<String, OriginalViewerBinding>,
    ) -> Self {
        let mut entries = Vec::<ViewerControlEntry>::new();
        let mut fallback_index = 0usize;
        let exported_bindings = exported_viewer_bindings(controls);

        for joint in &plan.joints {
            let Some(motor) = &joint.motor else {
                continue;
            };
            let Some(binding) = &motor.input else {
                continue;
            };

            let actuator_type = match motor.input_target {
                MotorInputTarget::Position | MotorInputTarget::Both => ViewerActuatorType::Position,
                MotorInputTarget::Velocity => ViewerActuatorType::Velocity,
            };
            entries.push(build_control_entry(
                &mut fallback_index,
                binding,
                originals.get(&binding.action),
                exported_bindings.get(&viewer_binding_key(
                    MachineControlTargetKind::Joint,
                    &joint.id,
                )),
                actuator_type,
                motor.target_position,
                joint.limits.as_ref().map(|limits| (limits.min, limits.max)),
            ));
        }

        for behavior in &plan.behaviors {
            let Some(binding) = &behavior.input else {
                continue;
            };
            entries.push(build_control_entry(
                &mut fallback_index,
                binding,
                originals.get(&binding.action),
                exported_bindings.get(&viewer_binding_key(
                    MachineControlTargetKind::Behavior,
                    &behavior.id,
                )),
                ViewerActuatorType::Trigger,
                0.0,
                None,
            ));
        }

        Self { entries }
    }

    fn reset_targets(&mut self) {
        for entry in &mut self.entries {
            entry.current_target = entry.default_target;
        }
    }

    fn build_runtime_input(&mut self, keys: &ButtonInput<KeyCode>, dt: f32) -> RuntimeInputState {
        let mut input = RuntimeInputState::new();

        for entry in &mut self.entries {
            let positive = keys.pressed(entry.binding.positive_key);
            let negative = entry
                .binding
                .negative_key
                .map(|key| keys.pressed(key))
                .unwrap_or(false);

            match entry.actuator_type {
                ViewerActuatorType::Velocity => {
                    let axis = scalar_axis_input(positive, negative);
                    input.insert(
                        entry.action_name.clone(),
                        RuntimeInputValue::Scalar(axis * entry.scale),
                    );
                }
                ViewerActuatorType::Position => {
                    let axis = scalar_axis_input(positive, negative);
                    entry.current_target += axis * entry.scale * dt;
                    if let Some((min, max)) = entry.limits {
                        entry.current_target = entry.current_target.clamp(min, max);
                    }
                    input.insert(
                        entry.action_name.clone(),
                        RuntimeInputValue::Scalar(entry.current_target),
                    );
                }
                ViewerActuatorType::Trigger => {
                    input.insert(
                        entry.action_name.clone(),
                        RuntimeInputValue::Scalar(if positive { entry.scale } else { 0.0 }),
                    );
                }
            }
        }

        input
    }

    fn hud_lines(&self) -> Vec<String> {
        if self.entries.is_empty() {
            return vec!["No runtime controls".to_string()];
        }

        self.entries
            .iter()
            .map(|entry| {
                let binding = match &entry.binding.negative_label {
                    Some(negative) => format!("{negative} / {}", entry.binding.positive_label),
                    None => entry.binding.positive_label.clone(),
                };
                let kind = match entry.actuator_type {
                    ViewerActuatorType::Velocity => "velocity",
                    ViewerActuatorType::Position => "position",
                    ViewerActuatorType::Trigger => "trigger",
                };
                format!("{binding}: {} ({kind})", entry.original_action)
            })
            .collect()
    }
}

#[derive(Clone, Copy)]
struct SceneFocus {
    target: Vec3,
    distance: f32,
    ground_radius: f32,
}

struct ViewerState {
    source_path: PathBuf,
    runtime_plan: MachinePlan,
    viewer_controls: ViewerControls,
    ground_y: f32,
    simulation: RapierSimulation,
    runtime: MachineRuntime,
}

impl ViewerState {
    fn load(path: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        let json = fs::read_to_string(&path)?;
        let envelope: SerializedMachineEnvelope = serde_json::from_str(&json)?;
        validate_machine_envelope(&envelope)?;
        let mut runtime_plan = envelope.plan.clone();
        let originals = rewrite_viewer_plan_actions(&mut runtime_plan);
        let viewer_controls =
            ViewerControls::from_plan(&runtime_plan, envelope.controls.as_ref(), &originals);
        let mut simulation = RapierSimulation::default();
        let runtime = MachineRuntime::from_plan(&mut simulation, runtime_plan.clone())?;
        let ground_y = compute_ground_plane_y(&runtime, &simulation);
        simulation.insert_static_ground(ground_y, GROUND_HALF_EXTENT, GROUND_THICKNESS);
        Ok(Self {
            source_path: path,
            runtime_plan,
            viewer_controls,
            ground_y,
            simulation,
            runtime,
        })
    }

    fn reset(&mut self) -> Result<(), RuntimeBuildError> {
        let mut simulation = RapierSimulation::default();
        let runtime = MachineRuntime::from_plan(&mut simulation, self.runtime_plan.clone())?;
        let ground_y = compute_ground_plane_y(&runtime, &simulation);
        simulation.insert_static_ground(ground_y, GROUND_HALF_EXTENT, GROUND_THICKNESS);
        self.ground_y = ground_y;
        self.simulation = simulation;
        self.runtime = runtime;
        Ok(())
    }

    fn step(&mut self, input: &RuntimeInputState, dt: f32) {
        self.runtime.update(&mut self.simulation, input, dt);
        self.simulation.step();
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let source_path =
        viewer_source_path_from_args(env::args_os().skip(1)).unwrap_or_else(default_fixture_path);
    let viewer_state = ViewerState::load(source_path)?;
    let viewer_controls = viewer_state.viewer_controls.clone();

    App::new()
        .insert_non_send_resource(viewer_state)
        .insert_resource(ClearColor(Color::srgb(0.80, 0.86, 0.92)))
        .insert_resource(CameraOrbit::default())
        .insert_resource(viewer_controls)
        .insert_resource(ViewerUiState {
            paused: false,
            debug_overlay: false,
        })
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "Snap Machines Viewer".into(),
                ..default()
            }),
            ..default()
        }))
        .add_systems(Startup, (setup_scene, spawn_machine_visuals))
        .add_systems(
            Update,
            (
                camera_orbit_system,
                handle_viewer_hotkeys_system,
                step_machine_system,
                sync_mount_visuals_system,
                draw_debug_overlay_system,
                hud_system,
            )
                .chain(),
        )
        .run();

    Ok(())
}

fn setup_scene(
    mut commands: Commands,
    mut ambient_light: ResMut<GlobalAmbientLight>,
    mut orbit: ResMut<CameraOrbit>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    viewer_state: NonSend<ViewerState>,
) {
    let focus = compute_scene_focus(&viewer_state);

    ambient_light.color = Color::srgb(0.96, 0.97, 1.0);
    ambient_light.brightness = 450.0;

    orbit.target = focus.target;
    orbit.distance = focus.distance;

    commands.spawn((
        Camera3d::default(),
        camera_transform_from_orbit(&orbit),
        MainCamera,
    ));

    commands.spawn((
        DirectionalLight {
            illuminance: 18_000.0,
            shadows_enabled: true,
            ..default()
        },
        Transform::from_translation(focus.target + Vec3::new(6.0, 10.0, 6.0))
            .looking_at(focus.target, Vec3::Y),
    ));

    commands.spawn((
        PointLight {
            color: Color::srgb(0.82, 0.90, 1.0),
            intensity: 8_000_000.0,
            range: focus.ground_radius * 3.0,
            shadows_enabled: true,
            ..default()
        },
        Transform::from_translation(focus.target + Vec3::new(-8.0, 12.0, 10.0)),
    ));

    commands.spawn((
        Mesh3d(
            meshes.add(
                Plane3d::default()
                    .mesh()
                    .size(focus.ground_radius * 2.0, focus.ground_radius * 2.0),
            ),
        ),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.46, 0.17, 0.55),
            perceptual_roughness: 0.92,
            metallic: 0.02,
            ..default()
        })),
        Transform::from_xyz(0.0, viewer_state.ground_y, 0.0),
        Visibility::Visible,
    ));

    commands.spawn((
        Text::new(format!(
            "Snap Machines Viewer\nFile: {}\nRight drag: orbit  |  Wheel: zoom\nQ / E: hinge + motor spin  |  Space: throttle",
            viewer_state
                .source_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("<unknown>")
        )),
        TextFont {
            font_size: 16.0,
            ..default()
        },
        TextColor(Color::WHITE),
        Node {
            position_type: PositionType::Absolute,
            left: Val::Px(12.0),
            top: Val::Px(12.0),
            ..default()
        },
        HudText,
    ));
}

fn spawn_machine_visuals(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    viewer_state: NonSend<ViewerState>,
) {
    let mut material_cache = HashMap::<String, Handle<StandardMaterial>>::new();

    for mount in &viewer_state.runtime.plan().mounts {
        let root = commands
            .spawn((
                Transform::default(),
                Visibility::Visible,
                MountVisual {
                    mount_id: mount.id.clone(),
                },
            ))
            .id();

        let geometry = if mount.geometry.is_empty() {
            fallback_geometry_for_mount(viewer_state.runtime.plan(), mount)
        } else {
            mount.geometry.clone()
        };

        let material = material_cache
            .entry(mount.block_type_id.clone())
            .or_insert_with(|| {
                materials.add(StandardMaterial {
                    base_color: color_for_block_type(&mount.block_type_id),
                    perceptual_roughness: 0.7,
                    metallic: 0.08,
                    ..default()
                })
            })
            .clone();

        commands.entity(root).with_children(|parent| {
            for entry in &geometry {
                if let Some(mesh) = mesh_for_geometry(entry) {
                    parent.spawn((
                        Mesh3d(meshes.add(mesh)),
                        MeshMaterial3d(material.clone()),
                        geometry_local_transform(entry),
                        Visibility::Visible,
                    ));
                }
            }
        });
    }
}

fn handle_viewer_hotkeys_system(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut viewer_ui: ResMut<ViewerUiState>,
    mut viewer_controls: ResMut<ViewerControls>,
    mut viewer_state: NonSendMut<ViewerState>,
) {
    if keyboard.just_pressed(KeyCode::KeyP) {
        viewer_ui.paused = !viewer_ui.paused;
    }
    if keyboard.just_pressed(KeyCode::F1) {
        viewer_ui.debug_overlay = !viewer_ui.debug_overlay;
    }
    if keyboard.just_pressed(KeyCode::KeyR) {
        if let Err(error) = viewer_state.reset() {
            eprintln!("Failed to reset viewer state: {error}");
        } else {
            viewer_controls.reset_targets();
        }
    }
}

fn step_machine_system(
    time: Res<Time>,
    keyboard: Res<ButtonInput<KeyCode>>,
    viewer_ui: Res<ViewerUiState>,
    mut viewer_controls: ResMut<ViewerControls>,
    mut viewer_state: NonSendMut<ViewerState>,
) {
    if viewer_ui.paused {
        return;
    }

    let dt = time.delta_secs().clamp(1.0 / 240.0, 1.0 / 30.0);
    let input = viewer_controls.build_runtime_input(&keyboard, dt.max(DEFAULT_FIXED_DT));
    viewer_state.step(&input, dt.max(DEFAULT_FIXED_DT));
}

fn sync_mount_visuals_system(
    viewer_state: NonSend<ViewerState>,
    mut mounts: Query<(&MountVisual, &mut Transform)>,
) {
    for (mount_visual, mut transform) in &mut mounts {
        let Some(world_transform) = viewer_state
            .runtime
            .mount_world_transform(&viewer_state.simulation, &mount_visual.mount_id)
        else {
            continue;
        };
        *transform = snap_transform_to_bevy(world_transform);
    }
}

fn draw_debug_overlay_system(
    viewer_ui: Res<ViewerUiState>,
    viewer_state: NonSend<ViewerState>,
    mut gizmos: Gizmos,
) {
    if !viewer_ui.debug_overlay {
        return;
    }

    let collider_color = Color::srgba(0.30, 0.95, 0.95, 0.95);
    let joint_color = Color::srgba(0.95, 0.8, 0.2, 0.95);

    for body in &viewer_state.runtime.plan().bodies {
        let Some(body_transform) = viewer_state
            .runtime
            .body_transform(&viewer_state.simulation, &body.id)
        else {
            continue;
        };

        for collider in &body.colliders {
            let world = compose_snap_transform(body_transform, collider.local_transform);
            draw_collider_gizmo(&mut gizmos, collider, world, collider_color);
        }
    }

    for joint in &viewer_state.runtime.plan().joints {
        let Some(body_a) = viewer_state
            .runtime
            .body_transform(&viewer_state.simulation, &joint.body_a_id)
        else {
            continue;
        };
        let Some(body_b) = viewer_state
            .runtime
            .body_transform(&viewer_state.simulation, &joint.body_b_id)
        else {
            continue;
        };

        let anchor_a = compose_snap_transform(
            body_a,
            SnapTransform {
                position: joint.local_anchor_a,
                rotation: joint.local_frame_a.unwrap_or(identity_snap_quat()),
            },
        );
        let anchor_b = compose_snap_transform(
            body_b,
            SnapTransform {
                position: joint.local_anchor_b,
                rotation: joint.local_frame_b.unwrap_or(identity_snap_quat()),
            },
        );

        let a = snap_vec3_to_bevy(anchor_a.position);
        let b = snap_vec3_to_bevy(anchor_b.position);
        gizmos.line(a, b, joint_color);
        gizmos.sphere(Isometry3d::from_translation(a), 0.06, joint_color);
        gizmos.sphere(Isometry3d::from_translation(b), 0.06, joint_color);
    }
}

fn hud_system(
    viewer_ui: Res<ViewerUiState>,
    viewer_controls: Res<ViewerControls>,
    viewer_state: NonSend<ViewerState>,
    mut text_query: Query<&mut Text, With<HudText>>,
) {
    let Ok(mut text) = text_query.single_mut() else {
        return;
    };

    let plan = viewer_state.runtime.plan();
    let controls = viewer_controls.hud_lines().join("\n");
    *text = Text::new(format!(
        "Snap Machines Viewer\nFile: {}\nBodies: {}  |  Joints: {}  |  Mounts: {}\nPaused: {}  |  Debug: {}\nControls:\n{}\nR: reset  |  P: pause  |  F1: debug overlay",
        viewer_state
            .source_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("<unknown>"),
        plan.bodies.len(),
        plan.joints.len(),
        plan.mounts.len(),
        if viewer_ui.paused { "yes" } else { "no" },
        if viewer_ui.debug_overlay { "on" } else { "off" },
        controls,
    ));
}

fn camera_orbit_system(
    mouse_button: Res<ButtonInput<MouseButton>>,
    mut mouse_motion: MessageReader<MouseMotion>,
    mut scroll: MessageReader<MouseWheel>,
    mut orbit: ResMut<CameraOrbit>,
    mut camera_q: Query<&mut Transform, With<MainCamera>>,
    window_q: Query<&Window, With<PrimaryWindow>>,
) {
    let window_has_cursor = window_q
        .single()
        .ok()
        .and_then(Window::cursor_position)
        .is_some();

    if window_has_cursor && mouse_button.pressed(MouseButton::Right) {
        for event in mouse_motion.read() {
            orbit.yaw -= event.delta.x * 0.005;
            orbit.pitch -= event.delta.y * 0.005;
            orbit.pitch = orbit.pitch.clamp(-1.4, 1.4);
        }
    } else {
        for _ in mouse_motion.read() {}
    }

    for event in scroll.read() {
        orbit.distance -= event.y * 0.5;
        orbit.distance = orbit.distance.clamp(3.0, 80.0);
    }

    if let Ok(mut transform) = camera_q.single_mut() {
        *transform = camera_transform_from_orbit(&orbit);
    }
}

fn mesh_for_geometry(
    geometry: &snap_machines_rapier::NormalizedGeometryDefinition,
) -> Option<Mesh> {
    match geometry.kind {
        snap_machines_rapier::GeometryKind::Box => geometry
            .size
            .map(|size| Mesh::from(Cuboid::new(size.x, size.y, size.z))),
        snap_machines_rapier::GeometryKind::Sphere => geometry
            .radius
            .map(|radius| Mesh::from(Sphere::new(radius))),
        snap_machines_rapier::GeometryKind::Capsule => Some(Mesh::from(Capsule3d::new(
            geometry.radius.unwrap_or(0.25),
            geometry.half_height.unwrap_or(0.5) * 2.0,
        ))),
        snap_machines_rapier::GeometryKind::Cylinder => Some(Mesh::from(Cylinder::new(
            geometry.radius.unwrap_or(0.25),
            geometry.half_height.unwrap_or(0.5) * 2.0,
        ))),
        snap_machines_rapier::GeometryKind::Mesh => None,
    }
}

fn geometry_local_transform(
    geometry: &snap_machines_rapier::NormalizedGeometryDefinition,
) -> Transform {
    let mut transform = snap_transform_to_bevy(geometry.transform);
    if matches!(
        geometry.kind,
        snap_machines_rapier::GeometryKind::Cylinder | snap_machines_rapier::GeometryKind::Capsule
    ) {
        transform.rotation *= axis_rotation(geometry.axis);
    }
    transform
}

fn fallback_geometry_for_mount(
    plan: &snap_machines_rapier::MachinePlan,
    mount: &snap_machines_rapier::MachinePartMountPlan,
) -> Vec<snap_machines_rapier::NormalizedGeometryDefinition> {
    let Some(body) = plan.bodies.iter().find(|body| body.id == mount.body_id) else {
        return Vec::new();
    };

    body.colliders
        .iter()
        .filter(|collider| collider.block_id == mount.block_id && collider.part_id == mount.part_id)
        .filter_map(|collider| geometry_from_collider(mount, collider))
        .collect()
}

fn geometry_from_collider(
    mount: &snap_machines_rapier::MachinePartMountPlan,
    collider: &PlannedCollider,
) -> Option<snap_machines_rapier::NormalizedGeometryDefinition> {
    let relative = relative_snap_transform(mount.local_transform, collider.local_transform);
    let base = snap_machines_rapier::NormalizedGeometryDefinition {
        id: format!("fallback:{}", collider.id),
        kind: match collider.kind {
            ColliderKind::Box => snap_machines_rapier::GeometryKind::Box,
            ColliderKind::Sphere => snap_machines_rapier::GeometryKind::Sphere,
            ColliderKind::Capsule => snap_machines_rapier::GeometryKind::Capsule,
            ColliderKind::Cylinder => snap_machines_rapier::GeometryKind::Cylinder,
            ColliderKind::ConvexHull | ColliderKind::Trimesh => return None,
        },
        part_id: mount.part_id.clone(),
        transform: relative,
        size: None,
        radius: None,
        half_height: None,
        axis: collider.axis,
        mesh_id: None,
        material_id: None,
        metadata: collider.metadata.clone(),
    };

    Some(match collider.kind {
        ColliderKind::Box => snap_machines_rapier::NormalizedGeometryDefinition {
            size: collider.half_extents.map(|he| SnapVec3 {
                x: he.x * 2.0,
                y: he.y * 2.0,
                z: he.z * 2.0,
            }),
            ..base
        },
        ColliderKind::Sphere => snap_machines_rapier::NormalizedGeometryDefinition {
            radius: collider.radius,
            ..base
        },
        ColliderKind::Capsule | ColliderKind::Cylinder => {
            snap_machines_rapier::NormalizedGeometryDefinition {
                radius: collider.radius,
                half_height: collider.half_height,
                ..base
            }
        }
        ColliderKind::ConvexHull | ColliderKind::Trimesh => base,
    })
}

fn draw_collider_gizmo(
    gizmos: &mut Gizmos,
    collider: &PlannedCollider,
    transform: SnapTransform,
    color: Color,
) {
    let isometry = snap_transform_to_isometry(transform, collider.axis);
    match collider.kind {
        ColliderKind::Box => {
            let Some(half_extents) = collider.half_extents else {
                return;
            };
            gizmos.primitive_3d(
                &Cuboid::new(
                    half_extents.x * 2.0,
                    half_extents.y * 2.0,
                    half_extents.z * 2.0,
                ),
                isometry,
                color,
            );
        }
        ColliderKind::Sphere => {
            let Some(radius) = collider.radius else {
                return;
            };
            gizmos.primitive_3d(&Sphere::new(radius), isometry, color);
        }
        ColliderKind::Capsule => {
            let Some(radius) = collider.radius else {
                return;
            };
            let Some(half_height) = collider.half_height else {
                return;
            };
            gizmos.primitive_3d(&Capsule3d::new(radius, half_height * 2.0), isometry, color);
        }
        ColliderKind::Cylinder => {
            let Some(radius) = collider.radius else {
                return;
            };
            let Some(half_height) = collider.half_height else {
                return;
            };
            gizmos.primitive_3d(&Cylinder::new(radius, half_height * 2.0), isometry, color);
        }
        ColliderKind::ConvexHull => {
            if let Some(points) = &collider.points {
                gizmos.linestrip(points.iter().copied().map(snap_vec3_to_bevy), color);
            }
        }
        ColliderKind::Trimesh => {
            if let (Some(vertices), Some(indices)) = (&collider.vertices, &collider.indices) {
                for triangle in indices.chunks_exact(3) {
                    let a = vertex_at(vertices, triangle[0] as usize);
                    let b = vertex_at(vertices, triangle[1] as usize);
                    let c = vertex_at(vertices, triangle[2] as usize);
                    gizmos.line(a, b, color);
                    gizmos.line(b, c, color);
                    gizmos.line(c, a, color);
                }
            }
        }
    }
}

fn rewrite_viewer_plan_actions(plan: &mut MachinePlan) -> HashMap<String, OriginalViewerBinding> {
    let mut originals = HashMap::new();

    for joint in &mut plan.joints {
        let Some(binding) = joint.motor.as_mut().and_then(|motor| motor.input.as_mut()) else {
            continue;
        };
        let unique_action = format!("ctrl:joint:{}", joint.id);
        let effective_scale = binding.scale.unwrap_or(1.0)
            * if binding.invert.unwrap_or(false) {
                -1.0
            } else {
                1.0
            };
        originals.insert(
            unique_action.clone(),
            OriginalViewerBinding {
                action: binding.action.clone(),
                scale: effective_scale,
            },
        );
        binding.action = unique_action;
        binding.scale = Some(1.0);
        binding.invert = Some(false);
    }

    for behavior in &mut plan.behaviors {
        let Some(binding) = behavior.input.as_mut() else {
            continue;
        };
        let unique_action = format!("ctrl:behavior:{}", behavior.id);
        let effective_scale = binding.scale.unwrap_or(1.0)
            * if binding.invert.unwrap_or(false) {
                -1.0
            } else {
                1.0
            };
        originals.insert(
            unique_action.clone(),
            OriginalViewerBinding {
                action: binding.action.clone(),
                scale: effective_scale,
            },
        );
        binding.action = unique_action;
        binding.scale = Some(1.0);
        binding.invert = Some(false);
    }

    originals
}

fn exported_viewer_bindings(
    controls: Option<&MachineControls>,
) -> HashMap<String, ViewerKeyBinding> {
    let Some(controls) = controls else {
        return HashMap::new();
    };
    let Some(profile) = controls
        .profiles
        .iter()
        .find(|profile| profile.id == controls.default_profile_id)
        .or_else(|| controls.profiles.first())
    else {
        return HashMap::new();
    };

    profile
        .bindings
        .iter()
        .filter_map(|binding| {
            viewer_key_binding_from_codes(
                &binding.positive.code,
                binding.negative.as_ref().map(|key| key.code.as_str()),
            )
            .map(|viewer_binding| {
                (
                    viewer_binding_key(binding.target.kind, &binding.target.id),
                    viewer_binding,
                )
            })
        })
        .collect()
}

fn viewer_binding_key(kind: MachineControlTargetKind, id: &str) -> String {
    match kind {
        MachineControlTargetKind::Joint => format!("joint:{id}"),
        MachineControlTargetKind::Behavior => format!("behavior:{id}"),
    }
}

fn build_control_entry(
    fallback_index: &mut usize,
    binding: &InputBinding,
    original: Option<&OriginalViewerBinding>,
    exported_binding: Option<&ViewerKeyBinding>,
    actuator_type: ViewerActuatorType,
    default_target: f32,
    limits: Option<(f32, f32)>,
) -> ViewerControlEntry {
    let scale = original.map(|binding| binding.scale).unwrap_or_else(|| {
        binding.scale.unwrap_or(1.0)
            * if binding.invert.unwrap_or(false) {
                -1.0
            } else {
                1.0
            }
    });
    let default_action = original
        .map(|binding| binding.action.as_str())
        .unwrap_or(binding.action.as_str());

    let key_binding = exported_binding
        .cloned()
        .or_else(|| default_key_binding(default_action))
        .unwrap_or_else(|| {
            let binding = fallback_key_binding(*fallback_index);
            *fallback_index += 1;
            binding
        });

    ViewerControlEntry {
        action_name: binding.action.clone(),
        original_action: default_action.to_string(),
        actuator_type,
        binding: key_binding,
        scale,
        default_target,
        current_target: default_target,
        limits,
    }
}

fn default_key_binding(action: &str) -> Option<ViewerKeyBinding> {
    match action {
        "motorSpin" | "hingeSpin" => {
            Some(key_binding(KeyCode::KeyE, "E", Some((KeyCode::KeyQ, "Q"))))
        }
        "sliderPos" => Some(key_binding(KeyCode::KeyE, "E", Some((KeyCode::KeyQ, "Q")))),
        "armPitch" | "flapDeflect" => {
            Some(key_binding(KeyCode::KeyW, "W", Some((KeyCode::KeyS, "S"))))
        }
        "armYaw" => Some(key_binding(KeyCode::KeyD, "D", Some((KeyCode::KeyA, "A")))),
        "throttle" | "propellerSpin" => Some(key_binding(KeyCode::Space, "Space", None)),
        "gripperClose" => Some(key_binding(KeyCode::KeyG, "G", None)),
        _ => None,
    }
}

fn fallback_key_binding(index: usize) -> ViewerKeyBinding {
    const FALLBACKS: &[(KeyCode, &str, Option<(KeyCode, &str)>)] = &[
        (KeyCode::KeyL, "L", Some((KeyCode::KeyJ, "J"))),
        (KeyCode::KeyI, "I", Some((KeyCode::KeyK, "K"))),
        (KeyCode::KeyO, "O", Some((KeyCode::KeyU, "U"))),
        (KeyCode::KeyM, "M", Some((KeyCode::KeyN, "N"))),
        (KeyCode::Digit2, "2", Some((KeyCode::Digit1, "1"))),
        (KeyCode::Digit4, "4", Some((KeyCode::Digit3, "3"))),
    ];

    let (positive, positive_label, negative) = FALLBACKS[index % FALLBACKS.len()];
    key_binding(positive, positive_label, negative)
}

fn key_binding(
    positive_key: KeyCode,
    positive_label: &str,
    negative: Option<(KeyCode, &str)>,
) -> ViewerKeyBinding {
    ViewerKeyBinding {
        positive_key,
        positive_label: positive_label.to_string(),
        negative_key: negative.map(|(key, _)| key),
        negative_label: negative.map(|(_, label)| label.to_string()),
    }
}

fn viewer_key_binding_from_codes(
    positive_code: &str,
    negative_code: Option<&str>,
) -> Option<ViewerKeyBinding> {
    let positive_key = key_code_from_web_code(positive_code)?;
    let positive_label = key_label_from_web_code(positive_code);
    let negative = match negative_code {
        Some(code) => Some((key_code_from_web_code(code)?, key_label_from_web_code(code))),
        None => None,
    };
    Some(ViewerKeyBinding {
        positive_key,
        positive_label,
        negative_key: negative.as_ref().map(|(key, _)| *key),
        negative_label: negative.map(|(_, label)| label),
    })
}

fn key_label_from_web_code(code: &str) -> String {
    match code {
        "Space" => "Space".to_string(),
        "ArrowUp" => "Up".to_string(),
        "ArrowDown" => "Down".to_string(),
        "ArrowLeft" => "Left".to_string(),
        "ArrowRight" => "Right".to_string(),
        "BracketLeft" => "[".to_string(),
        "BracketRight" => "]".to_string(),
        "Backslash" => "\\".to_string(),
        "Semicolon" => ";".to_string(),
        "Quote" => "'".to_string(),
        "Comma" => ",".to_string(),
        "Period" => ".".to_string(),
        "Slash" => "/".to_string(),
        "Minus" => "-".to_string(),
        "Equal" => "=".to_string(),
        "Backquote" => "`".to_string(),
        _ if code.starts_with("Key") && code.len() == 4 => code[3..].to_string(),
        _ if code.starts_with("Digit") && code.len() == 6 => code[5..].to_string(),
        _ => code.to_string(),
    }
}

fn key_code_from_web_code(code: &str) -> Option<KeyCode> {
    Some(match code {
        "Space" => KeyCode::Space,
        "Enter" => KeyCode::Enter,
        "Tab" => KeyCode::Tab,
        "Escape" => KeyCode::Escape,
        "Backspace" => KeyCode::Backspace,
        "Delete" => KeyCode::Delete,
        "Insert" => KeyCode::Insert,
        "Home" => KeyCode::Home,
        "End" => KeyCode::End,
        "PageUp" => KeyCode::PageUp,
        "PageDown" => KeyCode::PageDown,
        "ArrowUp" => KeyCode::ArrowUp,
        "ArrowDown" => KeyCode::ArrowDown,
        "ArrowLeft" => KeyCode::ArrowLeft,
        "ArrowRight" => KeyCode::ArrowRight,
        "ShiftLeft" => KeyCode::ShiftLeft,
        "ShiftRight" => KeyCode::ShiftRight,
        "ControlLeft" => KeyCode::ControlLeft,
        "ControlRight" => KeyCode::ControlRight,
        "AltLeft" => KeyCode::AltLeft,
        "AltRight" => KeyCode::AltRight,
        "MetaLeft" => KeyCode::SuperLeft,
        "MetaRight" => KeyCode::SuperRight,
        "CapsLock" => KeyCode::CapsLock,
        "Backquote" => KeyCode::Backquote,
        "Minus" => KeyCode::Minus,
        "Equal" => KeyCode::Equal,
        "BracketLeft" => KeyCode::BracketLeft,
        "BracketRight" => KeyCode::BracketRight,
        "Backslash" => KeyCode::Backslash,
        "Semicolon" => KeyCode::Semicolon,
        "Quote" => KeyCode::Quote,
        "Comma" => KeyCode::Comma,
        "Period" => KeyCode::Period,
        "Slash" => KeyCode::Slash,
        "Numpad0" => KeyCode::Numpad0,
        "Numpad1" => KeyCode::Numpad1,
        "Numpad2" => KeyCode::Numpad2,
        "Numpad3" => KeyCode::Numpad3,
        "Numpad4" => KeyCode::Numpad4,
        "Numpad5" => KeyCode::Numpad5,
        "Numpad6" => KeyCode::Numpad6,
        "Numpad7" => KeyCode::Numpad7,
        "Numpad8" => KeyCode::Numpad8,
        "Numpad9" => KeyCode::Numpad9,
        "NumpadAdd" => KeyCode::NumpadAdd,
        "NumpadSubtract" => KeyCode::NumpadSubtract,
        "NumpadMultiply" => KeyCode::NumpadMultiply,
        "NumpadDivide" => KeyCode::NumpadDivide,
        "NumpadDecimal" => KeyCode::NumpadDecimal,
        "NumpadEnter" => KeyCode::NumpadEnter,
        _ if code.starts_with("Key") && code.len() == 4 => match &code[3..] {
            "A" => KeyCode::KeyA,
            "B" => KeyCode::KeyB,
            "C" => KeyCode::KeyC,
            "D" => KeyCode::KeyD,
            "E" => KeyCode::KeyE,
            "F" => KeyCode::KeyF,
            "G" => KeyCode::KeyG,
            "H" => KeyCode::KeyH,
            "I" => KeyCode::KeyI,
            "J" => KeyCode::KeyJ,
            "K" => KeyCode::KeyK,
            "L" => KeyCode::KeyL,
            "M" => KeyCode::KeyM,
            "N" => KeyCode::KeyN,
            "O" => KeyCode::KeyO,
            "P" => KeyCode::KeyP,
            "Q" => KeyCode::KeyQ,
            "R" => KeyCode::KeyR,
            "S" => KeyCode::KeyS,
            "T" => KeyCode::KeyT,
            "U" => KeyCode::KeyU,
            "V" => KeyCode::KeyV,
            "W" => KeyCode::KeyW,
            "X" => KeyCode::KeyX,
            "Y" => KeyCode::KeyY,
            "Z" => KeyCode::KeyZ,
            _ => return None,
        },
        _ if code.starts_with("Digit") && code.len() == 6 => match &code[5..] {
            "0" => KeyCode::Digit0,
            "1" => KeyCode::Digit1,
            "2" => KeyCode::Digit2,
            "3" => KeyCode::Digit3,
            "4" => KeyCode::Digit4,
            "5" => KeyCode::Digit5,
            "6" => KeyCode::Digit6,
            "7" => KeyCode::Digit7,
            "8" => KeyCode::Digit8,
            "9" => KeyCode::Digit9,
            _ => return None,
        },
        _ if code.starts_with('F') => match &code[1..] {
            "1" => KeyCode::F1,
            "2" => KeyCode::F2,
            "3" => KeyCode::F3,
            "4" => KeyCode::F4,
            "5" => KeyCode::F5,
            "6" => KeyCode::F6,
            "7" => KeyCode::F7,
            "8" => KeyCode::F8,
            "9" => KeyCode::F9,
            "10" => KeyCode::F10,
            "11" => KeyCode::F11,
            "12" => KeyCode::F12,
            "13" => KeyCode::F13,
            "14" => KeyCode::F14,
            "15" => KeyCode::F15,
            "16" => KeyCode::F16,
            "17" => KeyCode::F17,
            "18" => KeyCode::F18,
            "19" => KeyCode::F19,
            "20" => KeyCode::F20,
            "21" => KeyCode::F21,
            "22" => KeyCode::F22,
            "23" => KeyCode::F23,
            "24" => KeyCode::F24,
            _ => return None,
        },
        _ => return None,
    })
}

fn scalar_axis_input(positive: bool, negative: bool) -> f32 {
    (if positive { 1.0 } else { 0.0 }) - (if negative { 1.0 } else { 0.0 })
}

fn color_for_block_type(block_type_id: &str) -> Color {
    let hue = block_type_id.bytes().fold(0u32, |hash, byte| {
        hash.wrapping_mul(33).wrapping_add(byte as u32)
    }) % 360;
    Color::hsl(hue as f32, 0.62, 0.57)
}

fn camera_transform_from_orbit(orbit: &CameraOrbit) -> Transform {
    let x = orbit.distance * orbit.yaw.cos() * orbit.pitch.cos();
    let y = orbit.distance * orbit.pitch.sin();
    let z = orbit.distance * orbit.yaw.sin() * orbit.pitch.cos();
    Transform::from_translation(orbit.target + Vec3::new(x, y, z)).looking_at(orbit.target, Vec3::Y)
}

fn compute_scene_focus(viewer_state: &ViewerState) -> SceneFocus {
    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = Vec3::splat(f32::NEG_INFINITY);
    let mut found = false;

    for mount in &viewer_state.runtime.plan().mounts {
        let Some(mount_world) = viewer_state
            .runtime
            .mount_world_transform(&viewer_state.simulation, &mount.id)
        else {
            continue;
        };

        let geometry = if mount.geometry.is_empty() {
            fallback_geometry_for_mount(viewer_state.runtime.plan(), mount)
        } else {
            mount.geometry.clone()
        };

        if geometry.is_empty() {
            let point = snap_vec3_to_bevy(mount_world.position);
            min = min.min(point);
            max = max.max(point);
            found = true;
            continue;
        }

        for entry in &geometry {
            let world = compose_snap_transform(mount_world, entry.transform);
            let center = snap_vec3_to_bevy(world.position);
            let radius = geometry_bound_radius(entry).max(0.25);
            let half_extents = Vec3::splat(radius);
            min = min.min(center - half_extents);
            max = max.max(center + half_extents);
            found = true;
        }
    }

    if !found {
        return SceneFocus {
            target: Vec3::ZERO,
            distance: 12.0,
            ground_radius: 30.0,
        };
    }

    let center = (min + max) * 0.5;
    let span = (max - min).max(Vec3::splat(1.0));
    let radius = span.length() * 0.5;
    SceneFocus {
        target: Vec3::new(
            center.x,
            center.y.max(viewer_state.ground_y + 0.75),
            center.z,
        ),
        distance: (radius * 2.2).clamp(6.0, 48.0),
        ground_radius: (span.x.max(span.z) * 1.8).clamp(20.0, 100.0),
    }
}

fn compute_ground_plane_y(runtime: &MachineRuntime, simulation: &RapierSimulation) -> f32 {
    let mut min_y = f32::INFINITY;

    for body in &runtime.plan().bodies {
        let Some(body_transform) = runtime.body_transform(simulation, &body.id) else {
            continue;
        };

        for collider in &body.colliders {
            if collider.sensor {
                continue;
            }

            let world = compose_snap_transform(body_transform, collider.local_transform);
            min_y = min_y.min(collider_bottom_y(collider, world));
        }
    }

    if min_y.is_finite() {
        min_y - GROUND_CLEARANCE
    } else {
        -0.5
    }
}

fn collider_bottom_y(collider: &PlannedCollider, world_transform: SnapTransform) -> f32 {
    let center = snap_vec3_to_bevy(world_transform.position);
    let rotation = snap_quat_to_bevy(world_transform.rotation) * axis_rotation(collider.axis);
    match collider.kind {
        ColliderKind::ConvexHull => {
            return collider
                .points
                .as_ref()
                .and_then(|points| {
                    points
                        .iter()
                        .map(|point| center.y + (rotation * snap_vec3_to_bevy(*point)).y)
                        .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                })
                .unwrap_or(center.y - 0.75);
        }
        ColliderKind::Trimesh => {
            return collider
                .vertices
                .as_ref()
                .map(|vertices| {
                    vertices
                        .chunks_exact(3)
                        .map(|chunk| {
                            center.y + (rotation * Vec3::new(chunk[0], chunk[1], chunk[2])).y
                        })
                        .fold(f32::INFINITY, f32::min)
                })
                .filter(|value| value.is_finite())
                .unwrap_or(center.y - 0.75);
        }
        _ => {}
    }
    center.y - collider_vertical_extent(collider, rotation)
}

fn collider_vertical_extent(collider: &PlannedCollider, rotation: BevyQuat) -> f32 {
    match collider.kind {
        ColliderKind::Box => {
            let Some(half_extents) = collider.half_extents else {
                return 0.5;
            };
            let basis = Mat3::from_quat(rotation);
            basis.x_axis.y.abs() * half_extents.x
                + basis.y_axis.y.abs() * half_extents.y
                + basis.z_axis.y.abs() * half_extents.z
        }
        ColliderKind::Sphere => collider.radius.unwrap_or(0.5),
        ColliderKind::Capsule => {
            let radius = collider.radius.unwrap_or(0.25);
            let half_height = collider.half_height.unwrap_or(0.5);
            let axis = rotation * Vec3::Y;
            axis.y.abs() * half_height + radius
        }
        ColliderKind::Cylinder => {
            let radius = collider.radius.unwrap_or(0.25);
            let half_height = collider.half_height.unwrap_or(0.5);
            let axis = rotation * Vec3::Y;
            axis.y.abs() * half_height + (1.0 - axis.y * axis.y).max(0.0).sqrt() * radius
        }
        ColliderKind::ConvexHull | ColliderKind::Trimesh => 0.75,
    }
}

fn geometry_bound_radius(geometry: &snap_machines_rapier::NormalizedGeometryDefinition) -> f32 {
    match geometry.kind {
        snap_machines_rapier::GeometryKind::Box => geometry
            .size
            .map(|size| snap_vec3_to_bevy(size).length() * 0.5)
            .unwrap_or(0.5),
        snap_machines_rapier::GeometryKind::Sphere => geometry.radius.unwrap_or(0.5),
        snap_machines_rapier::GeometryKind::Capsule
        | snap_machines_rapier::GeometryKind::Cylinder => {
            let radius = geometry.radius.unwrap_or(0.25);
            let half_height = geometry.half_height.unwrap_or(0.5);
            Vec3::new(radius, half_height + radius, radius).length()
        }
        snap_machines_rapier::GeometryKind::Mesh => 0.75,
    }
}

fn snap_transform_to_bevy(transform: SnapTransform) -> Transform {
    Transform {
        translation: snap_vec3_to_bevy(transform.position),
        rotation: snap_quat_to_bevy(transform.rotation),
        scale: Vec3::ONE,
    }
}

fn snap_transform_to_isometry(
    transform: SnapTransform,
    axis: Option<snap_machines_rapier::AxisName>,
) -> Isometry3d {
    Isometry3d::new(
        snap_vec3_to_bevy(transform.position),
        snap_quat_to_bevy(transform.rotation) * axis_rotation(axis),
    )
}

fn snap_vec3_to_bevy(value: SnapVec3) -> Vec3 {
    Vec3::new(value.x, value.y, value.z)
}

fn snap_quat_to_bevy(value: SnapQuat) -> BevyQuat {
    BevyQuat::from_xyzw(value.x, value.y, value.z, value.w)
}

fn axis_rotation(axis: Option<snap_machines_rapier::AxisName>) -> BevyQuat {
    match axis.unwrap_or(snap_machines_rapier::AxisName::Y) {
        snap_machines_rapier::AxisName::X => {
            BevyQuat::from_rotation_z(-std::f32::consts::FRAC_PI_2)
        }
        snap_machines_rapier::AxisName::Y => BevyQuat::IDENTITY,
        snap_machines_rapier::AxisName::Z => BevyQuat::from_rotation_x(std::f32::consts::FRAC_PI_2),
    }
}

fn compose_snap_transform(a: SnapTransform, b: SnapTransform) -> SnapTransform {
    let a_rotation = snap_quat_to_bevy(a.rotation);
    let b_position = snap_vec3_to_bevy(b.position);
    let position = snap_vec3_to_bevy(a.position) + a_rotation * b_position;
    let rotation = a_rotation * snap_quat_to_bevy(b.rotation);
    SnapTransform {
        position: SnapVec3 {
            x: position.x,
            y: position.y,
            z: position.z,
        },
        rotation: SnapQuat {
            x: rotation.x,
            y: rotation.y,
            z: rotation.z,
            w: rotation.w,
        },
    }
}

fn inverse_snap_transform(transform: SnapTransform) -> SnapTransform {
    let rotation = snap_quat_to_bevy(transform.rotation).inverse();
    let position = -(rotation * snap_vec3_to_bevy(transform.position));
    SnapTransform {
        position: SnapVec3 {
            x: position.x,
            y: position.y,
            z: position.z,
        },
        rotation: SnapQuat {
            x: rotation.x,
            y: rotation.y,
            z: rotation.z,
            w: rotation.w,
        },
    }
}

fn relative_snap_transform(origin: SnapTransform, target: SnapTransform) -> SnapTransform {
    compose_snap_transform(inverse_snap_transform(origin), target)
}

fn identity_snap_quat() -> SnapQuat {
    SnapQuat {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        w: 1.0,
    }
}

fn vertex_at(vertices: &[f32], index: usize) -> Vec3 {
    let base = index * 3;
    Vec3::new(vertices[base], vertices[base + 1], vertices[base + 2])
}

fn default_fixture_path() -> PathBuf {
    fixture_path("hinge-thruster-machine.envelope.json")
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(name)
}

fn viewer_source_path_from_args(
    args: impl IntoIterator<Item = impl Into<std::ffi::OsString>>,
) -> Option<PathBuf> {
    let args: Vec<_> = args.into_iter().map(Into::into).collect();
    if args.is_empty() {
        return None;
    }

    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--file" || arg == "-f" {
            return args.get(index + 1).map(PathBuf::from);
        }
        if !arg.to_string_lossy().starts_with('-') {
            return Some(PathBuf::from(arg));
        }
        index += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use snap_machines_rapier::{
        MachineControlProfile, MachineControlProfileKind, MachineControlTarget,
        MachineControlTargetKind, MachineControls, MachineKeyboardBinding, MachineKeyboardKey,
        SERIALIZED_MACHINE_SCHEMA_VERSION,
    };
    use tempfile::NamedTempFile;

    #[test]
    fn default_fixture_path_exists() {
        assert!(default_fixture_path().exists());
    }

    #[test]
    fn viewer_source_path_prefers_flag_value() {
        let path = viewer_source_path_from_args(["--file", "foo.json"]).unwrap();
        assert_eq!(path, PathBuf::from("foo.json"));
    }

    #[test]
    fn viewer_source_path_reads_positional_value() {
        let path = viewer_source_path_from_args(["fixture.json"]).unwrap();
        assert_eq!(path, PathBuf::from("fixture.json"));
    }

    #[test]
    fn color_for_block_type_is_stable() {
        assert_eq!(
            color_for_block_type("frame.cube.1").to_srgba(),
            color_for_block_type("frame.cube.1").to_srgba()
        );
    }

    #[test]
    fn viewer_state_computes_ground_plane_for_fixture() {
        let state = ViewerState::load(default_fixture_path()).expect("fixture loads");
        assert!(state.ground_y.is_finite());
        assert!(state.ground_y < 0.0);
    }

    #[test]
    fn crane_fixture_derives_position_controls() {
        let state =
            ViewerState::load(fixture_path("crane.envelope.json")).expect("crane fixture loads");
        let controls = state.viewer_controls.clone();

        let yaw = controls
            .entries
            .iter()
            .find(|entry| entry.original_action == "armYaw")
            .expect("armYaw control exists");
        assert_eq!(yaw.actuator_type, ViewerActuatorType::Position);
        assert_eq!(yaw.binding.positive_key, KeyCode::KeyD);
        assert_eq!(yaw.binding.negative_key, Some(KeyCode::KeyA));

        let pitch = controls
            .entries
            .iter()
            .find(|entry| entry.original_action == "armPitch")
            .expect("armPitch control exists");
        assert_eq!(pitch.actuator_type, ViewerActuatorType::Position);
        assert_eq!(pitch.binding.positive_key, KeyCode::KeyW);
        assert_eq!(pitch.binding.negative_key, Some(KeyCode::KeyS));
    }

    #[test]
    fn viewer_prefers_exported_controls_from_envelope() {
        let fixture = fixture_path("crane.envelope.json");
        let original_json = fs::read_to_string(&fixture).expect("fixture json");
        let original_envelope: SerializedMachineEnvelope =
            serde_json::from_str(&original_json).expect("fixture envelope");
        let state = ViewerState::load(fixture).expect("crane fixture loads");
        let yaw_entry = state
            .viewer_controls
            .entries
            .iter()
            .find(|entry| entry.original_action == "armYaw")
            .expect("armYaw control exists");
        let yaw_joint_id = yaw_entry
            .action_name
            .strip_prefix("ctrl:joint:")
            .expect("armYaw action uses rewritten joint action");
        let envelope = SerializedMachineEnvelope {
            schema_version: SERIALIZED_MACHINE_SCHEMA_VERSION,
            catalog_version: original_envelope.catalog_version,
            plan: original_envelope.plan,
            controls: Some(MachineControls {
                default_profile_id: "keyboard.custom".into(),
                profiles: vec![MachineControlProfile {
                    id: "keyboard.custom".into(),
                    kind: MachineControlProfileKind::Keyboard,
                    bindings: vec![MachineKeyboardBinding {
                        target: MachineControlTarget {
                            kind: MachineControlTargetKind::Joint,
                            id: yaw_joint_id.into(),
                        },
                        positive: MachineKeyboardKey {
                            code: "ArrowRight".into(),
                        },
                        negative: Some(MachineKeyboardKey {
                            code: "ArrowLeft".into(),
                        }),
                        enabled: true,
                        scale: 1.0,
                    }],
                }],
            }),
            metadata: None,
        };

        let file = NamedTempFile::new().expect("temp file");
        serde_json::to_writer_pretty(file.as_file(), &envelope).expect("write envelope json");

        let loaded = ViewerState::load(file.path().to_path_buf())
            .expect("viewer loads envelope with controls");
        let yaw = loaded
            .viewer_controls
            .entries
            .iter()
            .find(|entry| entry.original_action == "armYaw")
            .expect("armYaw control exists");

        assert_eq!(yaw.binding.positive_key, KeyCode::ArrowRight);
        assert_eq!(yaw.binding.negative_key, Some(KeyCode::ArrowLeft));
    }
}
