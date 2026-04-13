use std::collections::HashMap;

use nalgebra::{Isometry3, Point3, Quaternion, Translation3, Unit, UnitQuaternion, Vector3};
use rapier3d::prelude::*;
use serde_json::Value;
use thiserror::Error;

use crate::types::{
    AxisName, ColliderKind, InputBinding, JointKind, JointMotorMode, MachineBehaviorPlan,
    MachineJointPlan, MachinePartMountPlan, MachinePlan, MotorInputTarget, PlannedCollider, Quat,
    RigidBodyKind, SerializedMachineEnvelope, Transform, Vec3,
};
use crate::validation::{MachineValidationError, validate_machine_envelope};

#[derive(Debug, Clone, PartialEq)]
pub enum RuntimeInputValue {
    Scalar(f32),
    Bool(bool),
}

impl From<f32> for RuntimeInputValue {
    fn from(value: f32) -> Self {
        Self::Scalar(value)
    }
}

impl From<bool> for RuntimeInputValue {
    fn from(value: bool) -> Self {
        Self::Bool(value)
    }
}

pub type RuntimeInputState = HashMap<String, RuntimeInputValue>;

pub struct MachineWorldRef<'a> {
    pub bodies: &'a RigidBodySet,
}

pub struct MachineWorldMut<'a> {
    pub bodies: &'a mut RigidBodySet,
    pub colliders: &'a mut ColliderSet,
    pub impulse_joints: &'a mut ImpulseJointSet,
}

pub struct MachineWorldRemove<'a> {
    pub islands: &'a mut IslandManager,
    pub bodies: &'a mut RigidBodySet,
    pub colliders: &'a mut ColliderSet,
    pub impulse_joints: &'a mut ImpulseJointSet,
    pub multibody_joints: &'a mut MultibodyJointSet,
}

pub struct RapierSimulation {
    pub gravity: Vector<Real>,
    pub integration_parameters: IntegrationParameters,
    pub pipeline: PhysicsPipeline,
    pub islands: IslandManager,
    pub broad_phase: DefaultBroadPhase,
    pub narrow_phase: NarrowPhase,
    pub bodies: RigidBodySet,
    pub colliders: ColliderSet,
    pub impulse_joints: ImpulseJointSet,
    pub multibody_joints: MultibodyJointSet,
    pub ccd_solver: CCDSolver,
}

#[derive(Debug)]
pub struct MachineRuntime {
    plan: MachinePlan,
    body_handles: HashMap<String, RigidBodyHandle>,
    joint_handles: HashMap<String, ImpulseJointHandle>,
    mount_map: HashMap<String, MachinePartMountPlan>,
    behavior_states: Vec<MachineBehaviorState>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MachineBehaviorState {
    Thruster(ThrusterState),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ThrusterState {
    pub behavior_id: String,
    pub body_id: String,
    pub local_direction: Vec3,
    pub local_point: Vec3,
    pub force: f32,
    pub input: Option<InputBinding>,
}

#[derive(Debug, Error)]
pub enum RuntimeBuildError {
    #[error(transparent)]
    Validation(#[from] MachineValidationError),
    #[error(transparent)]
    Deserialize(#[from] serde_json::Error),
    #[error("missing body {0} during runtime construction")]
    MissingBody(String),
    #[error("unsupported behavior kind {0}")]
    UnsupportedBehavior(String),
}

#[derive(Debug, Error)]
pub enum RuntimeRemoveError {
    #[error("missing joint {0} during runtime removal")]
    MissingJoint(String),
    #[error("missing body {0} during runtime removal")]
    MissingBody(String),
}

impl Default for RapierSimulation {
    fn default() -> Self {
        Self {
            gravity: vector![0.0, -9.81, 0.0],
            integration_parameters: IntegrationParameters::default(),
            pipeline: PhysicsPipeline::new(),
            islands: IslandManager::new(),
            broad_phase: DefaultBroadPhase::new(),
            narrow_phase: NarrowPhase::new(),
            bodies: RigidBodySet::new(),
            colliders: ColliderSet::new(),
            impulse_joints: ImpulseJointSet::new(),
            multibody_joints: MultibodyJointSet::new(),
            ccd_solver: CCDSolver::new(),
        }
    }
}

impl RapierSimulation {
    pub fn world_ref(&self) -> MachineWorldRef<'_> {
        MachineWorldRef {
            bodies: &self.bodies,
        }
    }

    pub fn world_mut(&mut self) -> MachineWorldMut<'_> {
        MachineWorldMut {
            bodies: &mut self.bodies,
            colliders: &mut self.colliders,
            impulse_joints: &mut self.impulse_joints,
        }
    }

    pub fn world_remove(&mut self) -> MachineWorldRemove<'_> {
        MachineWorldRemove {
            islands: &mut self.islands,
            bodies: &mut self.bodies,
            colliders: &mut self.colliders,
            impulse_joints: &mut self.impulse_joints,
            multibody_joints: &mut self.multibody_joints,
        }
    }

    pub fn step(&mut self) {
        self.pipeline.step(
            &self.gravity,
            &self.integration_parameters,
            &mut self.islands,
            &mut self.broad_phase,
            &mut self.narrow_phase,
            &mut self.bodies,
            &mut self.colliders,
            &mut self.impulse_joints,
            &mut self.multibody_joints,
            &mut self.ccd_solver,
            None,
            &(),
            &(),
        );
    }

    pub fn insert_static_ground(
        &mut self,
        top_y: f32,
        half_extent: f32,
        thickness: f32,
    ) -> (RigidBodyHandle, ColliderHandle) {
        let body = self.bodies.insert(
            RigidBodyBuilder::fixed()
                .translation(vector![0.0, top_y - thickness, 0.0])
                .build(),
        );
        let collider = self.colliders.insert_with_parent(
            ColliderBuilder::cuboid(half_extent, thickness, half_extent)
                .friction(1.0)
                .restitution(0.0)
                .build(),
            body,
            &mut self.bodies,
        );
        (body, collider)
    }
}

impl MachineRuntime {
    pub fn from_envelope(
        simulation: &mut RapierSimulation,
        envelope: SerializedMachineEnvelope,
    ) -> Result<Self, RuntimeBuildError> {
        let mut world = simulation.world_mut();
        Self::install_envelope(&mut world, envelope)
    }

    pub fn from_json_str(
        simulation: &mut RapierSimulation,
        json: &str,
    ) -> Result<Self, RuntimeBuildError> {
        let mut world = simulation.world_mut();
        Self::install_json_str(&mut world, json)
    }

    pub fn from_plan(
        simulation: &mut RapierSimulation,
        plan: MachinePlan,
    ) -> Result<Self, RuntimeBuildError> {
        let mut world = simulation.world_mut();
        Self::install_plan(&mut world, plan)
    }

    pub fn install_envelope(
        world: &mut MachineWorldMut<'_>,
        envelope: SerializedMachineEnvelope,
    ) -> Result<Self, RuntimeBuildError> {
        validate_machine_envelope(&envelope)?;
        Self::install_plan(world, envelope.plan)
    }

    pub fn install_json_str(
        world: &mut MachineWorldMut<'_>,
        json: &str,
    ) -> Result<Self, RuntimeBuildError> {
        let envelope: SerializedMachineEnvelope = serde_json::from_str(json)?;
        Self::install_envelope(world, envelope)
    }

    pub fn install_plan(
        world: &mut MachineWorldMut<'_>,
        plan: MachinePlan,
    ) -> Result<Self, RuntimeBuildError> {
        let mut body_handles = HashMap::new();
        for body_plan in &plan.bodies {
            let body = world.bodies.insert(create_rigid_body(body_plan));
            for collider in &body_plan.colliders {
                let desc = create_collider(collider);
                world
                    .colliders
                    .insert_with_parent(desc, body, world.bodies);
            }
            if let Some(body_ref) = world.bodies.get_mut(body) {
                body_ref.recompute_mass_properties_from_colliders(world.colliders);
            }
            body_handles.insert(body_plan.id.clone(), body);
        }

        let mut joint_handles = HashMap::new();
        for joint_plan in &plan.joints {
            let body_a = *body_handles
                .get(&joint_plan.body_a_id)
                .ok_or_else(|| RuntimeBuildError::MissingBody(joint_plan.body_a_id.clone()))?;
            let body_b = *body_handles
                .get(&joint_plan.body_b_id)
                .ok_or_else(|| RuntimeBuildError::MissingBody(joint_plan.body_b_id.clone()))?;
            let handle = world
                .impulse_joints
                .insert(body_a, body_b, create_joint(joint_plan), true);
            joint_handles.insert(joint_plan.id.clone(), handle);
        }

        let mut behavior_states = Vec::new();
        for behavior in &plan.behaviors {
            behavior_states.push(create_behavior_state(behavior)?);
        }

        let mount_map = plan
            .mounts
            .iter()
            .cloned()
            .map(|mount| (mount.id.clone(), mount))
            .collect();

        Ok(Self {
            plan,
            body_handles,
            joint_handles,
            mount_map,
            behavior_states,
        })
    }

    pub fn plan(&self) -> &MachinePlan {
        &self.plan
    }

    pub fn body_handle(&self, body_id: &str) -> Option<RigidBodyHandle> {
        self.body_handles.get(body_id).copied()
    }

    pub fn joint_handle(&self, joint_id: &str) -> Option<ImpulseJointHandle> {
        self.joint_handles.get(joint_id).copied()
    }

    pub fn mount(&self, mount_id: &str) -> Option<&MachinePartMountPlan> {
        self.mount_map.get(mount_id)
    }

    pub fn body_transform(
        &self,
        simulation: &RapierSimulation,
        body_id: &str,
    ) -> Option<Transform> {
        let world = simulation.world_ref();
        self.body_transform_in_world(&world, body_id)
    }

    pub fn body_transform_in_world(
        &self,
        world: &MachineWorldRef<'_>,
        body_id: &str,
    ) -> Option<Transform> {
        let handle = self.body_handles.get(body_id)?;
        let body = world.bodies.get(*handle)?;
        Some(isometry_to_transform(body.position()))
    }

    pub fn mount_world_transform(
        &self,
        simulation: &RapierSimulation,
        mount_id: &str,
    ) -> Option<Transform> {
        let world = simulation.world_ref();
        self.mount_world_transform_in_world(&world, mount_id)
    }

    pub fn mount_world_transform_in_world(
        &self,
        world: &MachineWorldRef<'_>,
        mount_id: &str,
    ) -> Option<Transform> {
        let mount = self.mount_map.get(mount_id)?;
        let body_transform = self.body_transform_in_world(world, &mount.body_id)?;
        Some(compose_transform(body_transform, mount.local_transform))
    }

    pub fn behavior_states(&self) -> &[MachineBehaviorState] {
        &self.behavior_states
    }

    pub fn update(
        &mut self,
        simulation: &mut RapierSimulation,
        input: &RuntimeInputState,
        dt_seconds: f32,
    ) {
        simulation.integration_parameters.dt = dt_seconds;
        let mut world = simulation.world_mut();
        self.update_in_world(&mut world, input, dt_seconds);
    }

    pub fn update_in_world(
        &mut self,
        world: &mut MachineWorldMut<'_>,
        input: &RuntimeInputState,
        dt_seconds: f32,
    ) {
        let _ = dt_seconds;

        for joint_plan in &self.plan.joints {
            let Some(motor) = &joint_plan.motor else {
                continue;
            };
            let Some(handle) = self.joint_handles.get(&joint_plan.id) else {
                continue;
            };
            let Some(joint) = world.impulse_joints.get_mut(*handle, true) else {
                continue;
            };

            let input_value = motor
                .input
                .as_ref()
                .map(|binding| read_input_binding(input, binding))
                .unwrap_or(0.0);
            let mut target_position = motor.target_position;
            let mut target_velocity = motor.target_velocity;

            match motor.input_target {
                MotorInputTarget::Position => target_position += input_value,
                MotorInputTarget::Velocity => target_velocity += input_value,
                MotorInputTarget::Both => {
                    target_position += input_value;
                    target_velocity += input_value;
                }
            }

            let vff = motor
                .input
                .as_ref()
                .map(|binding| {
                    let action = format!("{}:vff", binding.action);
                    match input.get(&action) {
                        Some(RuntimeInputValue::Bool(value)) => {
                            if *value {
                                1.0
                            } else {
                                0.0
                            }
                        }
                        Some(RuntimeInputValue::Scalar(value)) => *value,
                        None => 0.0,
                    }
                })
                .unwrap_or(0.0);

            let mode = if vff != 0.0
                && matches!(motor.mode, JointMotorMode::Position | JointMotorMode::Full)
            {
                JointMotorMode::Full
            } else {
                motor.mode
            };

            apply_motor(
                &mut joint.data,
                joint_plan.kind,
                mode,
                target_position,
                target_velocity + vff,
                motor.stiffness,
                motor.damping,
                motor.max_force,
            );
        }

        for behavior in &self.behavior_states {
            match behavior {
                MachineBehaviorState::Thruster(thruster) => {
                    let amount = thruster
                        .input
                        .as_ref()
                        .map(|binding| read_input_binding(input, binding))
                        .unwrap_or(1.0);
                    if amount == 0.0 {
                        continue;
                    }

                    let Some(body_handle) = self.body_handles.get(&thruster.body_id) else {
                        continue;
                    };
                    let Some(body) = world.bodies.get_mut(*body_handle) else {
                        continue;
                    };

                    let body_transform = isometry_to_transform(body.position());
                    let rotation = quat_to_unit(body_transform.rotation);
                    let direction =
                        rotation.transform_vector(&vec3_to_vector(thruster.local_direction));
                    let local_point = Point3::from(vec3_to_vector(thruster.local_point));
                    let world_point = body.position().transform_point(&local_point);
                    body.add_force_at_point(
                        direction * (thruster.force * amount),
                        world_point,
                        true,
                    );
                }
            }
        }
    }

    pub fn remove_from_world(
        self,
        world: &mut MachineWorldRemove<'_>,
    ) -> Result<(), RuntimeRemoveError> {
        for (joint_id, handle) in &self.joint_handles {
            if world.impulse_joints.remove(*handle, true).is_none() {
                return Err(RuntimeRemoveError::MissingJoint(joint_id.clone()));
            }
        }

        for (body_id, handle) in &self.body_handles {
            if world
                .bodies
                .remove(
                    *handle,
                    world.islands,
                    world.colliders,
                    world.impulse_joints,
                    world.multibody_joints,
                    true,
                )
                .is_none()
            {
                return Err(RuntimeRemoveError::MissingBody(body_id.clone()));
            }
        }

        Ok(())
    }
}

fn create_behavior_state(
    behavior: &MachineBehaviorPlan,
) -> Result<MachineBehaviorState, RuntimeBuildError> {
    match behavior.kind.as_str() {
        "thruster" => Ok(MachineBehaviorState::Thruster(ThrusterState {
            behavior_id: behavior.id.clone(),
            body_id: behavior.body_id.clone(),
            local_direction: json_vec3(
                behavior.props.get("localDirection"),
                Vec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 1.0,
                },
            ),
            local_point: json_vec3(
                behavior.props.get("localPoint"),
                Vec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            ),
            force: json_number(behavior.props.get("force"), 0.0),
            input: behavior.input.clone(),
        })),
        other => Err(RuntimeBuildError::UnsupportedBehavior(other.to_owned())),
    }
}

fn create_rigid_body(body: &crate::types::MachineBodyPlan) -> RigidBody {
    let builder = match body.kind {
        RigidBodyKind::Dynamic => RigidBodyBuilder::dynamic(),
        RigidBodyKind::Fixed => RigidBodyBuilder::fixed(),
        RigidBodyKind::KinematicPosition => RigidBodyBuilder::kinematic_position_based(),
        RigidBodyKind::KinematicVelocity => RigidBodyBuilder::kinematic_velocity_based(),
    };

    builder.position(transform_to_isometry(body.origin)).build()
}

fn create_collider(collider: &PlannedCollider) -> Collider {
    let builder = match collider.kind {
        ColliderKind::Box => {
            let half_extents = collider.half_extents.expect("validated half extents");
            ColliderBuilder::cuboid(half_extents.x, half_extents.y, half_extents.z)
        }
        ColliderKind::Sphere => ColliderBuilder::ball(collider.radius.expect("validated radius")),
        ColliderKind::Capsule => ColliderBuilder::capsule_y(
            collider.half_height.expect("validated halfHeight"),
            collider.radius.expect("validated radius"),
        ),
        ColliderKind::Cylinder => ColliderBuilder::cylinder(
            collider.half_height.expect("validated halfHeight"),
            collider.radius.expect("validated radius"),
        ),
        ColliderKind::ConvexHull => {
            let points: Vec<Point<Real>> = collider
                .points
                .clone()
                .expect("validated convex hull points")
                .into_iter()
                .map(|point| Point3::from(vec3_to_vector(point)))
                .collect();
            ColliderBuilder::convex_hull(&points).expect("valid convex hull")
        }
        ColliderKind::Trimesh => {
            let vertices = collider.vertices.clone().expect("validated vertices");
            let indices = collider.indices.clone().expect("validated indices");
            let points: Vec<Point<Real>> = vertices
                .chunks_exact(3)
                .map(|chunk| Point3::new(chunk[0], chunk[1], chunk[2]))
                .collect();
            let triangles: Vec<[u32; 3]> = indices
                .chunks_exact(3)
                .map(|chunk| [chunk[0], chunk[1], chunk[2]])
                .collect();
            ColliderBuilder::trimesh(points, triangles).expect("valid trimesh")
        }
    }
    .position(local_shape_isometry(collider))
    .sensor(collider.sensor);

    let builder = if let Some(mass) = collider.mass {
        builder.mass(mass)
    } else {
        builder
    };
    let builder = if let Some(friction) = collider.friction {
        builder.friction(friction)
    } else {
        builder
    };
    let builder = if let Some(restitution) = collider.restitution {
        builder.restitution(restitution)
    } else {
        builder
    };
    let builder = if let Some(groups) = collider.collision_groups {
        builder.collision_groups(decode_interaction_groups(groups))
    } else {
        builder
    };
    let builder = if let Some(groups) = collider.solver_groups {
        builder.solver_groups(decode_interaction_groups(groups))
    } else {
        builder
    };

    builder.build()
}

fn create_joint(joint: &MachineJointPlan) -> GenericJoint {
    match joint.kind {
        JointKind::Fixed => FixedJointBuilder::new()
            .local_frame1(transform_parts_to_isometry(
                joint.local_anchor_a,
                joint.local_frame_a.unwrap_or(identity_quat()),
            ))
            .local_frame2(transform_parts_to_isometry(
                joint.local_anchor_b,
                joint.local_frame_b.unwrap_or(identity_quat()),
            ))
            .contacts_enabled(joint.collide_connected)
            .build()
            .into(),
        JointKind::Spherical => {
            let mut builder = SphericalJointBuilder::new()
                .local_anchor1(point3(joint.local_anchor_a))
                .local_anchor2(point3(joint.local_anchor_b))
                .contacts_enabled(joint.collide_connected);
            if let Some(limits) = &joint.limits {
                builder = builder.limits(JointAxis::AngX, [limits.min, limits.max]);
            }
            builder.build().into()
        }
        JointKind::Revolute => {
            let axis = Unit::new_normalize(vec3_to_vector(
                joint.local_axis_a.expect("validated local axis"),
            ));
            let mut builder = RevoluteJointBuilder::new(axis)
                .local_anchor1(point3(joint.local_anchor_a))
                .local_anchor2(point3(joint.local_anchor_b))
                .contacts_enabled(joint.collide_connected);
            if let Some(limits) = &joint.limits {
                builder = builder.limits([limits.min, limits.max]);
            }
            builder.build().into()
        }
        JointKind::Prismatic => {
            let axis = Unit::new_normalize(vec3_to_vector(
                joint.local_axis_a.expect("validated local axis"),
            ));
            let mut builder = PrismaticJointBuilder::new(axis)
                .local_anchor1(point3(joint.local_anchor_a))
                .local_anchor2(point3(joint.local_anchor_b))
                .contacts_enabled(joint.collide_connected);
            if let Some(limits) = &joint.limits {
                builder = builder.limits([limits.min, limits.max]);
            }
            builder.build().into()
        }
    }
}

fn apply_motor(
    joint: &mut GenericJoint,
    kind: JointKind,
    mode: JointMotorMode,
    target_position: f32,
    target_velocity: f32,
    stiffness: f32,
    damping: f32,
    max_force: Option<f32>,
) {
    let axis = match kind {
        JointKind::Revolute => JointAxis::AngX,
        JointKind::Prismatic => JointAxis::LinX,
        JointKind::Fixed | JointKind::Spherical => return,
    };

    match mode {
        JointMotorMode::Position => {
            joint.set_motor_position(axis, target_position, stiffness, damping);
        }
        JointMotorMode::Velocity => {
            joint.set_motor_velocity(axis, target_velocity, damping);
        }
        JointMotorMode::Full => {
            joint.set_motor(axis, target_position, target_velocity, stiffness, damping);
        }
    }
    if let Some(max_force) = max_force {
        joint.set_motor_max_force(axis, max_force);
    }
}

pub fn read_input_binding(input: &RuntimeInputState, binding: &InputBinding) -> f32 {
    let numeric = match input.get(&binding.action) {
        Some(RuntimeInputValue::Bool(value)) => {
            if *value {
                1.0
            } else {
                0.0
            }
        }
        Some(RuntimeInputValue::Scalar(value)) => *value,
        None => 0.0,
    };

    let mut value = numeric * binding.scale.unwrap_or(1.0);
    if binding.invert.unwrap_or(false) {
        value *= -1.0;
    }
    if let Some(deadzone) = binding.deadzone {
        if value.abs() < deadzone {
            value = 0.0;
        }
    }
    if let Some([min, max]) = binding.clamp {
        value = value.clamp(min, max);
    }
    value
}

fn local_shape_isometry(collider: &PlannedCollider) -> Isometry<Real> {
    let rotation = quat_to_unit(collider.local_transform.rotation)
        * axis_rotation(collider.axis.unwrap_or(AxisName::Y));
    Isometry3::from_parts(
        Translation3::from(vec3_to_vector(collider.local_transform.position)),
        rotation,
    )
}

fn axis_rotation(axis: AxisName) -> UnitQuaternion<Real> {
    match axis {
        AxisName::X => {
            UnitQuaternion::from_axis_angle(&Vector3::z_axis(), -std::f32::consts::FRAC_PI_2)
        }
        AxisName::Y => UnitQuaternion::identity(),
        AxisName::Z => {
            UnitQuaternion::from_axis_angle(&Vector3::x_axis(), std::f32::consts::FRAC_PI_2)
        }
    }
}

fn transform_parts_to_isometry(position: Vec3, rotation: Quat) -> Isometry<Real> {
    Isometry3::from_parts(
        Translation3::from(vec3_to_vector(position)),
        quat_to_unit(rotation),
    )
}

fn compose_transform(a: Transform, b: Transform) -> Transform {
    isometry_to_transform(&(transform_to_isometry(a) * transform_to_isometry(b)))
}

fn transform_to_isometry(transform: Transform) -> Isometry<Real> {
    Isometry3::from_parts(
        Translation3::from(vec3_to_vector(transform.position)),
        quat_to_unit(transform.rotation),
    )
}

fn isometry_to_transform(iso: &Isometry<Real>) -> Transform {
    let quaternion = iso.rotation.quaternion();
    Transform {
        position: Vec3 {
            x: iso.translation.x,
            y: iso.translation.y,
            z: iso.translation.z,
        },
        rotation: Quat {
            x: quaternion.i,
            y: quaternion.j,
            z: quaternion.k,
            w: quaternion.w,
        },
    }
}

fn vec3_to_vector(value: Vec3) -> Vector<Real> {
    vector![value.x, value.y, value.z]
}

fn quat_to_unit(value: Quat) -> UnitQuaternion<Real> {
    UnitQuaternion::from_quaternion(Quaternion::new(value.w, value.x, value.y, value.z))
}

fn point3(value: Vec3) -> Point<Real> {
    Point3::new(value.x, value.y, value.z)
}

fn identity_quat() -> Quat {
    Quat {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        w: 1.0,
    }
}

fn json_number(value: Option<&Value>, fallback: f32) -> f32 {
    value
        .and_then(Value::as_f64)
        .map(|value| value as f32)
        .filter(|value| value.is_finite())
        .unwrap_or(fallback)
}

fn json_vec3(value: Option<&Value>, fallback: Vec3) -> Vec3 {
    let Some(value) = value else {
        return fallback;
    };
    let Value::Object(map) = value else {
        return fallback;
    };
    let x = map
        .get("x")
        .and_then(Value::as_f64)
        .map(|value| value as f32);
    let y = map
        .get("y")
        .and_then(Value::as_f64)
        .map(|value| value as f32);
    let z = map
        .get("z")
        .and_then(Value::as_f64)
        .map(|value| value as f32);
    match (x, y, z) {
        (Some(x), Some(y), Some(z)) if x.is_finite() && y.is_finite() && z.is_finite() => {
            Vec3 { x, y, z }
        }
        _ => fallback,
    }
}

fn decode_interaction_groups(bits: u32) -> InteractionGroups {
    let memberships = Group::from(bits >> 16);
    let filter = Group::from(bits & 0x0000_FFFF);
    InteractionGroups::new(memberships, filter)
}

#[cfg(test)]
mod tests {
    use approx::assert_relative_eq;

    use super::*;
    use crate::types::{
        ColliderKind, CompileDiagnostic, DiagnosticLevel, JointLimits, JointMotorMode::Velocity,
        MachineBindingScheme, MachineBodyPlan, MachineButtonPairBinding, MachineButtonSource,
        MachineControlProfileKind, MachineControlScheme, MachineControllerScheme, MachineControls,
        MachineInputBinding, MachineInputProfile, MachineJointPlan, MachinePartMountPlan,
        MotorInputTarget, PlannedJointMotor, SERIALIZED_MACHINE_SCHEMA_VERSION,
        SerializedMachineEnvelope, SourcePart,
    };

    fn identity_transform() -> Transform {
        Transform {
            position: Vec3 {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            rotation: identity_quat(),
        }
    }

    fn cube_plan() -> MachinePlan {
        MachinePlan {
            bodies: vec![MachineBodyPlan {
                id: "body:0".into(),
                kind: RigidBodyKind::Dynamic,
                origin: identity_transform(),
                source_blocks: vec!["root".into()],
                source_parts: vec![SourcePart {
                    block_id: "root".into(),
                    part_id: "main".into(),
                }],
                colliders: vec![PlannedCollider {
                    id: "cube:collider:0".into(),
                    block_id: "root".into(),
                    part_id: "main".into(),
                    kind: ColliderKind::Box,
                    local_transform: identity_transform(),
                    mass: Some(1.0),
                    sensor: false,
                    include_in_mass: true,
                    friction: None,
                    restitution: None,
                    collision_groups: None,
                    solver_groups: None,
                    half_extents: Some(Vec3 {
                        x: 0.5,
                        y: 0.5,
                        z: 0.5,
                    }),
                    radius: None,
                    half_height: None,
                    axis: None,
                    points: None,
                    vertices: None,
                    indices: None,
                    metadata: None,
                }],
            }],
            joints: vec![],
            mounts: vec![MachinePartMountPlan {
                id: "mount:root::main".into(),
                block_id: "root".into(),
                block_type_id: "frame.cube.1".into(),
                part_id: "main".into(),
                body_id: "body:0".into(),
                local_transform: identity_transform(),
                geometry: vec![],
                metadata: None,
            }],
            behaviors: vec![],
            diagnostics: vec![CompileDiagnostic {
                level: DiagnosticLevel::Info,
                message: "ok".into(),
                block_id: None,
                connection_id: None,
            }],
        }
    }

    fn empty_controller_scheme() -> MachineControllerScheme {
        MachineControllerScheme {
            default_profile_id: "controller.keyboard.default".into(),
            commands: vec![],
            profiles: vec![MachineInputProfile {
                id: "controller.keyboard.default".into(),
                kind: MachineControlProfileKind::Keyboard,
                bindings: vec![],
            }],
            actuator_roles: vec![],
            script: None,
        }
    }

    struct RawWorld {
        gravity: Vector<Real>,
        integration_parameters: IntegrationParameters,
        pipeline: PhysicsPipeline,
        islands: IslandManager,
        broad_phase: DefaultBroadPhase,
        narrow_phase: NarrowPhase,
        bodies: RigidBodySet,
        colliders: ColliderSet,
        impulse_joints: ImpulseJointSet,
        multibody_joints: MultibodyJointSet,
        ccd_solver: CCDSolver,
    }

    impl Default for RawWorld {
        fn default() -> Self {
            Self {
                gravity: vector![0.0, -9.81, 0.0],
                integration_parameters: IntegrationParameters::default(),
                pipeline: PhysicsPipeline::new(),
                islands: IslandManager::new(),
                broad_phase: DefaultBroadPhase::new(),
                narrow_phase: NarrowPhase::new(),
                bodies: RigidBodySet::new(),
                colliders: ColliderSet::new(),
                impulse_joints: ImpulseJointSet::new(),
                multibody_joints: MultibodyJointSet::new(),
                ccd_solver: CCDSolver::new(),
            }
        }
    }

    impl RawWorld {
        fn world_ref(&self) -> MachineWorldRef<'_> {
            MachineWorldRef {
                bodies: &self.bodies,
            }
        }

        fn world_mut(&mut self) -> MachineWorldMut<'_> {
            MachineWorldMut {
                bodies: &mut self.bodies,
                colliders: &mut self.colliders,
                impulse_joints: &mut self.impulse_joints,
            }
        }

        fn world_remove(&mut self) -> MachineWorldRemove<'_> {
            MachineWorldRemove {
                islands: &mut self.islands,
                bodies: &mut self.bodies,
                colliders: &mut self.colliders,
                impulse_joints: &mut self.impulse_joints,
                multibody_joints: &mut self.multibody_joints,
            }
        }

        fn step(&mut self) {
            self.pipeline.step(
                &self.gravity,
                &self.integration_parameters,
                &mut self.islands,
                &mut self.broad_phase,
                &mut self.narrow_phase,
                &mut self.bodies,
                &mut self.colliders,
                &mut self.impulse_joints,
                &mut self.multibody_joints,
                &mut self.ccd_solver,
                None,
                &(),
                &(),
            );
        }

        fn insert_host_ground(&mut self) -> RigidBodyHandle {
            let body = self.bodies.insert(
                RigidBodyBuilder::fixed()
                    .translation(vector![0.0, -0.5, 0.0])
                    .build(),
            );
            self.colliders.insert_with_parent(
                ColliderBuilder::cuboid(50.0, 0.5, 50.0).build(),
                body,
                &mut self.bodies,
            );
            body
        }
    }

    fn thruster_plan(action: &str, x_offset: f32) -> MachinePlan {
        let mut plan = cube_plan();
        plan.bodies[0].origin.position.x = x_offset;
        plan.behaviors.push(MachineBehaviorPlan {
            id: "behavior:thruster".into(),
            block_id: "root".into(),
            block_type_id: "utility.thruster.small".into(),
            part_id: "main".into(),
            body_id: "body:0".into(),
            kind: "thruster".into(),
            props: serde_json::json!({
                "force": 10.0,
                "localDirection": { "x": 1.0, "y": 0.0, "z": 0.0 },
                "localPoint": { "x": 0.0, "y": 0.0, "z": 0.0 }
            })
            .as_object()
            .unwrap()
            .clone(),
            input: Some(InputBinding {
                action: action.into(),
                scale: Some(1.0),
                invert: None,
                deadzone: None,
                clamp: None,
            }),
            metadata: None,
        });
        plan
    }

    #[test]
    fn instantiates_basic_body_and_mount() {
        let mut simulation = RapierSimulation::default();
        let runtime = MachineRuntime::from_plan(&mut simulation, cube_plan()).unwrap();

        assert_eq!(runtime.plan().bodies.len(), 1);
        assert_eq!(simulation.bodies.len(), 1);
        assert_eq!(simulation.colliders.len(), 1);

        let mount = runtime
            .mount_world_transform(&simulation, "mount:root::main")
            .unwrap();
        assert_relative_eq!(mount.position.x, 0.0);
        assert_relative_eq!(mount.position.y, 0.0);
        assert_relative_eq!(mount.position.z, 0.0);
    }

    #[test]
    fn applies_thruster_behavior_force() {
        let mut plan = cube_plan();
        plan.behaviors.push(MachineBehaviorPlan {
            id: "behavior:thruster".into(),
            block_id: "root".into(),
            block_type_id: "utility.thruster.small".into(),
            part_id: "main".into(),
            body_id: "body:0".into(),
            kind: "thruster".into(),
            props: serde_json::json!({
                "force": 10.0,
                "localDirection": { "x": 1.0, "y": 0.0, "z": 0.0 },
                "localPoint": { "x": 0.0, "y": 0.0, "z": 0.0 }
            })
            .as_object()
            .unwrap()
            .clone(),
            input: Some(InputBinding {
                action: "throttle".into(),
                scale: Some(1.0),
                invert: None,
                deadzone: None,
                clamp: None,
            }),
            metadata: None,
        });

        let mut simulation = RapierSimulation::default();
        let mut runtime = MachineRuntime::from_plan(&mut simulation, plan).unwrap();
        let mut input = RuntimeInputState::new();
        input.insert("throttle".into(), RuntimeInputValue::Scalar(1.0));
        runtime.update(&mut simulation, &input, 1.0 / 60.0);
        simulation.step();

        let body_handle = runtime.body_handle("body:0").unwrap();
        let body = simulation.bodies.get(body_handle).unwrap();
        assert!(body.linvel().x > 0.0);
    }

    #[test]
    fn motor_input_binding_matches_js_rules() {
        let binding = InputBinding {
            action: "hingeSpin".into(),
            scale: Some(12.0),
            invert: Some(true),
            deadzone: Some(0.5),
            clamp: Some([-10.0, 10.0]),
        };
        let mut input = RuntimeInputState::new();
        input.insert("hingeSpin".into(), RuntimeInputValue::Scalar(1.0));
        assert_relative_eq!(read_input_binding(&input, &binding), -10.0);
    }

    #[test]
    fn loads_from_serialized_envelope_json() {
        let envelope = SerializedMachineEnvelope {
            schema_version: SERIALIZED_MACHINE_SCHEMA_VERSION,
            catalog_version: "smcat1-test".into(),
            plan: cube_plan(),
            controls: None,
            metadata: None,
        };
        let json = serde_json::to_string(&envelope).unwrap();
        let mut simulation = RapierSimulation::default();

        let runtime = MachineRuntime::from_json_str(&mut simulation, &json).unwrap();

        assert_eq!(runtime.plan().bodies.len(), 1);
    }

    #[test]
    fn loads_serialized_envelope_json_with_controls() {
        let mut plan = cube_plan();
        plan.behaviors.push(MachineBehaviorPlan {
            id: "behavior:thruster".into(),
            block_id: "root".into(),
            block_type_id: "utility.thruster.small".into(),
            part_id: "main".into(),
            body_id: "body:0".into(),
            kind: "thruster".into(),
            props: serde_json::json!({
                "force": 10.0,
                "localDirection": { "x": 1.0, "y": 0.0, "z": 0.0 },
                "localPoint": { "x": 0.0, "y": 0.0, "z": 0.0 }
            })
            .as_object()
            .unwrap()
            .clone(),
            input: Some(InputBinding {
                action: "throttle".into(),
                scale: Some(1.0),
                invert: None,
                deadzone: None,
                clamp: None,
            }),
            metadata: None,
        });

        let envelope = SerializedMachineEnvelope {
            schema_version: SERIALIZED_MACHINE_SCHEMA_VERSION,
            catalog_version: "smcat1-test".into(),
            plan,
            controls: Some(MachineControls {
                active_scheme: MachineControlScheme::Bindings,
                bindings: MachineBindingScheme {
                    default_profile_id: "keyboard.default".into(),
                    profiles: vec![MachineInputProfile {
                        id: "keyboard.default".into(),
                        kind: MachineControlProfileKind::Keyboard,
                        bindings: vec![MachineInputBinding::ButtonPair(MachineButtonPairBinding {
                            target_id: "behavior:behavior:thruster".into(),
                            positive: MachineButtonSource::Keyboard {
                                code: "Space".into(),
                            },
                            negative: None,
                            enabled: true,
                            scale: 1.0,
                        })],
                    }],
                },
                controller: empty_controller_scheme(),
            }),
            metadata: None,
        };
        let json = serde_json::to_string(&envelope).unwrap();
        let mut simulation = RapierSimulation::default();

        let runtime = MachineRuntime::from_json_str(&mut simulation, &json).unwrap();

        assert_eq!(runtime.plan().behaviors.len(), 1);
    }

    #[test]
    fn supports_joint_instantiation_and_updates() {
        let mut plan = cube_plan();
        plan.bodies.push(MachineBodyPlan {
            id: "body:1".into(),
            kind: RigidBodyKind::Dynamic,
            origin: Transform {
                position: Vec3 {
                    x: 1.0,
                    y: 0.0,
                    z: 0.0,
                },
                rotation: identity_quat(),
            },
            source_blocks: vec!["child".into()],
            source_parts: vec![SourcePart {
                block_id: "child".into(),
                part_id: "main".into(),
            }],
            colliders: vec![PlannedCollider {
                id: "cube:collider:1".into(),
                block_id: "child".into(),
                part_id: "main".into(),
                kind: ColliderKind::Box,
                local_transform: identity_transform(),
                mass: Some(1.0),
                sensor: false,
                include_in_mass: true,
                friction: None,
                restitution: None,
                collision_groups: None,
                solver_groups: None,
                half_extents: Some(Vec3 {
                    x: 0.5,
                    y: 0.5,
                    z: 0.5,
                }),
                radius: None,
                half_height: None,
                axis: None,
                points: None,
                vertices: None,
                indices: None,
                metadata: None,
            }],
        });
        plan.joints.push(MachineJointPlan {
            id: "joint:h1".into(),
            block_id: "hinge".into(),
            kind: JointKind::Revolute,
            body_a_id: "body:0".into(),
            body_b_id: "body:1".into(),
            local_anchor_a: Vec3 {
                x: 0.5,
                y: 0.0,
                z: 0.0,
            },
            local_anchor_b: Vec3 {
                x: -0.5,
                y: 0.0,
                z: 0.0,
            },
            local_frame_a: Some(identity_quat()),
            local_frame_b: Some(identity_quat()),
            local_axis_a: Some(Vec3 {
                x: 0.0,
                y: 1.0,
                z: 0.0,
            }),
            local_axis_b: Some(Vec3 {
                x: 0.0,
                y: 1.0,
                z: 0.0,
            }),
            limits: Some(JointLimits {
                min: -1.0,
                max: 1.0,
            }),
            collide_connected: false,
            motor: Some(PlannedJointMotor {
                mode: Velocity,
                target_position: 0.0,
                target_velocity: 0.0,
                stiffness: 10.0,
                damping: 2.0,
                max_force: Some(5.0),
                input: Some(InputBinding {
                    action: "hingeSpin".into(),
                    scale: Some(12.0),
                    invert: None,
                    deadzone: None,
                    clamp: None,
                }),
                input_target: MotorInputTarget::Velocity,
            }),
            metadata: None,
        });

        let mut simulation = RapierSimulation::default();
        let mut runtime = MachineRuntime::from_plan(&mut simulation, plan).unwrap();
        let mut input = RuntimeInputState::new();
        input.insert("hingeSpin".into(), RuntimeInputValue::Scalar(0.5));
        runtime.update(&mut simulation, &input, 1.0 / 60.0);

        assert!(runtime.joint_handle("joint:h1").is_some());
        assert_eq!(simulation.impulse_joints.len(), 1);
    }

    #[test]
    fn installs_machine_into_external_rapier_world() {
        let mut world = RawWorld::default();
        let host_ground = world.insert_host_ground();

        let runtime = {
            let mut install_world = world.world_mut();
            MachineRuntime::install_plan(&mut install_world, cube_plan()).unwrap()
        };

        assert_eq!(world.bodies.len(), 2);
        assert_eq!(world.colliders.len(), 2);
        assert!(world.bodies.get(host_ground).is_some());

        let world_ref = world.world_ref();
        let mount = runtime
            .mount_world_transform_in_world(&world_ref, "mount:root::main")
            .unwrap();
        assert_relative_eq!(mount.position.x, 0.0);
    }

    #[test]
    fn shared_world_updates_are_scoped_per_machine() {
        let mut world = RawWorld::default();
        world.gravity = vector![0.0, 0.0, 0.0];

        let mut machine_a = {
            let mut install_world = world.world_mut();
            MachineRuntime::install_plan(&mut install_world, thruster_plan("throttle", 0.0))
                .unwrap()
        };
        let mut machine_b = {
            let mut install_world = world.world_mut();
            MachineRuntime::install_plan(&mut install_world, thruster_plan("throttle", 5.0))
                .unwrap()
        };

        let mut input_a = RuntimeInputState::new();
        input_a.insert("throttle".into(), RuntimeInputValue::Scalar(1.0));

        {
            let mut update_world = world.world_mut();
            machine_a.update_in_world(&mut update_world, &input_a, 1.0 / 60.0);
        }
        {
            let mut update_world = world.world_mut();
            machine_b.update_in_world(&mut update_world, &RuntimeInputState::new(), 1.0 / 60.0);
        }
        world.step();

        let body_a = world.bodies.get(machine_a.body_handle("body:0").unwrap()).unwrap();
        let body_b = world.bodies.get(machine_b.body_handle("body:0").unwrap()).unwrap();
        assert!(body_a.linvel().x > 0.0);
        assert_relative_eq!(body_b.linvel().x, 0.0);
    }

    #[test]
    fn removing_one_machine_preserves_other_world_content() {
        let mut world = RawWorld::default();
        let host_ground = world.insert_host_ground();

        let machine_a = {
            let mut install_world = world.world_mut();
            MachineRuntime::install_plan(&mut install_world, thruster_plan("throttle", 0.0))
                .unwrap()
        };
        let machine_b = {
            let mut install_world = world.world_mut();
            MachineRuntime::install_plan(&mut install_world, thruster_plan("throttle", 5.0))
                .unwrap()
        };

        {
            let mut remove_world = world.world_remove();
            machine_a.remove_from_world(&mut remove_world).unwrap();
        }

        assert!(world.bodies.get(host_ground).is_some());
        assert_eq!(world.bodies.len(), 2);
        assert_eq!(world.colliders.len(), 2);

        let world_ref = world.world_ref();
        assert!(machine_b
            .body_transform_in_world(&world_ref, "body:0")
            .is_some());
        assert!(machine_b
            .mount_world_transform_in_world(&world_ref, "mount:root::main")
            .is_some());
    }
}
