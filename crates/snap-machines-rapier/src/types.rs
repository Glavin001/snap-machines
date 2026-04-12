use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SERIALIZED_MACHINE_SCHEMA_VERSION: u32 = 2;
pub const SERIALIZED_CATALOG_SCHEMA_VERSION: u32 = 1;

pub type JsonValue = Value;
pub type JsonObject = serde_json::Map<String, Value>;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Quat {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    pub position: Vec3,
    pub rotation: Quat,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedMachineEnvelope {
    pub schema_version: u32,
    pub catalog_version: String,
    pub plan: MachinePlan,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub controls: Option<MachineControls>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<JsonObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineControls {
    pub default_profile_id: String,
    pub profiles: Vec<MachineControlProfile>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineControlProfile {
    pub id: String,
    pub kind: MachineControlProfileKind,
    pub bindings: Vec<MachineKeyboardBinding>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineKeyboardBinding {
    pub target: MachineControlTarget,
    pub positive: MachineKeyboardKey,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub negative: Option<MachineKeyboardKey>,
    pub enabled: bool,
    pub scale: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineControlTarget {
    pub kind: MachineControlTargetKind,
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MachineKeyboardKey {
    pub code: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedBlockCatalog {
    pub schema_version: u32,
    pub catalog_version: String,
    pub blocks: Vec<NormalizedBlockDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<JsonObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedBlockDefinition {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mass: Option<f32>,
    #[serde(default)]
    pub geometry: Vec<NormalizedGeometryDefinition>,
    pub colliders: Vec<NormalizedColliderDefinition>,
    pub anchors: Vec<NormalizedAnchorDefinition>,
    #[serde(default)]
    pub parts: Vec<NormalizedBlockPartDefinition>,
    #[serde(default)]
    pub behaviors: Vec<NormalizedBlockBehaviorDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub joint: Option<NormalizedJointDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<JsonObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedGeometryDefinition {
    pub id: String,
    pub kind: GeometryKind,
    pub part_id: String,
    pub transform: Transform,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<Vec3>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radius: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub half_height: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis: Option<AxisName>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mesh_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<JsonObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedColliderDefinition {
    pub id: String,
    pub kind: ColliderKind,
    pub part_id: String,
    pub transform: Transform,
    pub sensor: bool,
    pub include_in_mass: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mass: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub friction: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restitution: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collision_groups: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub solver_groups: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub half_extents: Option<Vec3>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radius: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub half_height: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis: Option<AxisName>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<Vec3>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertices: Option<Vec<f32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indices: Option<Vec<u32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<JsonObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedAnchorDefinition {
    pub id: String,
    pub part_id: String,
    pub position: Vec3,
    pub normal: Vec3,
    pub orientation: Quat,
    #[serde(rename = "type")]
    pub anchor_type: String,
    pub polarity: AnchorPolarity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angle_tolerance_deg: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distance_threshold: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open_check_radius: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation_snap_step_deg: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<JsonObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedBlockPartDefinition {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mass: Option<f32>,
    pub rigid_body_kind: RigidBodyKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<JsonObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedBlockBehaviorDefinition {
    pub kind: String,
    pub part_id: String,
    pub props: JsonObject,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<InputBinding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<JsonObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedJointDefinition {
    pub kind: JointKind,
    pub part_a: String,
    pub part_b: String,
    pub anchor_a: String,
    pub anchor_b: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis: Option<Vec3>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tangent: Option<Vec3>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<JointLimits>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub motor: Option<PlannedJointMotor>,
    pub collide_connected: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<JsonObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePart {
    pub block_id: String,
    pub part_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JointLimits {
    pub min: f32,
    pub max: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachinePlan {
    pub bodies: Vec<MachineBodyPlan>,
    pub joints: Vec<MachineJointPlan>,
    pub mounts: Vec<MachinePartMountPlan>,
    pub behaviors: Vec<MachineBehaviorPlan>,
    pub diagnostics: Vec<CompileDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileDiagnostic {
    pub level: DiagnosticLevel,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachinePartMountPlan {
    pub id: String,
    pub block_id: String,
    pub block_type_id: String,
    pub part_id: String,
    pub body_id: String,
    pub local_transform: Transform,
    pub geometry: Vec<NormalizedGeometryDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<JsonObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedCollider {
    pub id: String,
    pub block_id: String,
    pub part_id: String,
    pub kind: ColliderKind,
    pub local_transform: Transform,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mass: Option<f32>,
    pub sensor: bool,
    pub include_in_mass: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub friction: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restitution: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collision_groups: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub solver_groups: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub half_extents: Option<Vec3>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radius: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub half_height: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis: Option<AxisName>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<Vec3>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertices: Option<Vec<f32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indices: Option<Vec<u32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<JsonObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineBodyPlan {
    pub id: String,
    pub kind: RigidBodyKind,
    pub origin: Transform,
    pub source_blocks: Vec<String>,
    pub source_parts: Vec<SourcePart>,
    pub colliders: Vec<PlannedCollider>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedJointMotor {
    pub mode: JointMotorMode,
    pub target_position: f32,
    pub target_velocity: f32,
    pub stiffness: f32,
    pub damping: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_force: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<InputBinding>,
    pub input_target: MotorInputTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputBinding {
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invert: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deadzone: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clamp: Option<[f32; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineJointPlan {
    pub id: String,
    pub block_id: String,
    pub kind: JointKind,
    pub body_a_id: String,
    pub body_b_id: String,
    pub local_anchor_a: Vec3,
    pub local_anchor_b: Vec3,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_frame_a: Option<Quat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_frame_b: Option<Quat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_axis_a: Option<Vec3>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_axis_b: Option<Vec3>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits: Option<JointLimits>,
    pub collide_connected: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub motor: Option<PlannedJointMotor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<JsonObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineBehaviorPlan {
    pub id: String,
    pub block_id: String,
    pub block_type_id: String,
    pub part_id: String,
    pub body_id: String,
    pub kind: String,
    pub props: JsonObject,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<InputBinding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<JsonObject>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnchorPolarity {
    Positive,
    Negative,
    Neutral,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JointKind {
    Fixed,
    Revolute,
    Prismatic,
    Spherical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RigidBodyKind {
    Dynamic,
    Fixed,
    KinematicPosition,
    KinematicVelocity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticLevel {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JointMotorMode {
    Position,
    Velocity,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MotorInputTarget {
    Position,
    Velocity,
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MachineControlProfileKind {
    Keyboard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MachineControlTargetKind {
    Joint,
    Behavior,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AxisName {
    X,
    Y,
    Z,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GeometryKind {
    Box,
    Sphere,
    Capsule,
    Cylinder,
    Mesh,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColliderKind {
    Box,
    Sphere,
    Capsule,
    Cylinder,
    ConvexHull,
    Trimesh,
}
