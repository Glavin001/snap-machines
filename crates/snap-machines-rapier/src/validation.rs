use std::collections::HashSet;

use thiserror::Error;

use crate::types::{
    ColliderKind, JointKind, MachineControlProfileKind, MachineInputBinding, MachinePlan,
    PlannedCollider, SERIALIZED_MACHINE_SCHEMA_VERSION, SerializedMachineEnvelope,
};

const MIN_SUPPORTED_SERIALIZED_MACHINE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum MachineValidationError {
    #[error(
        "unsupported schema version {0}, expected between {min_supported} and {expected}",
        min_supported = MIN_SUPPORTED_SERIALIZED_MACHINE_SCHEMA_VERSION,
        expected = SERIALIZED_MACHINE_SCHEMA_VERSION
    )]
    UnsupportedSchemaVersion(u32),
    #[error("plan references non-finite numeric values at {0}")]
    NonFiniteValue(String),
    #[error("duplicate id {0}")]
    DuplicateId(String),
    #[error("joint {joint_id} references unknown body {body_id}")]
    UnknownJointBody { joint_id: String, body_id: String },
    #[error("mount {mount_id} references unknown body {body_id}")]
    UnknownMountBody { mount_id: String, body_id: String },
    #[error("behavior {behavior_id} references unknown body {body_id}")]
    UnknownBehaviorBody {
        behavior_id: String,
        body_id: String,
    },
    #[error("unsupported behavior kind {0}")]
    UnsupportedBehaviorKind(String),
    #[error("collider {collider_id} is missing shape data for kind {kind:?}")]
    MissingColliderShape {
        collider_id: String,
        kind: ColliderKind,
    },
    #[error("joint {joint_id} cannot connect body {body_id} to itself")]
    DegenerateJoint { joint_id: String, body_id: String },
    #[error("joint {joint_id} is missing axis data for kind {kind:?}")]
    MissingJointAxis { joint_id: String, kind: JointKind },
    #[error("controls.defaultProfileId {0} does not match any profile")]
    UnknownDefaultControlProfile(String),
    #[error("control profile {0} uses an unsupported kind")]
    UnsupportedControlProfileKind(String),
    #[error("control binding references unknown joint {0}")]
    UnknownControlJoint(String),
    #[error("control binding references unknown behavior {0}")]
    UnknownControlBehavior(String),
    #[error("control binding uses invalid keyboard code {0}")]
    InvalidKeyboardCode(String),
}

pub fn validate_machine_envelope(
    envelope: &SerializedMachineEnvelope,
) -> Result<(), MachineValidationError> {
    if envelope.schema_version < MIN_SUPPORTED_SERIALIZED_MACHINE_SCHEMA_VERSION
        || envelope.schema_version > SERIALIZED_MACHINE_SCHEMA_VERSION
    {
        return Err(MachineValidationError::UnsupportedSchemaVersion(
            envelope.schema_version,
        ));
    }
    validate_machine_plan(&envelope.plan)?;
    validate_machine_controls(&envelope.plan, envelope.controls.as_ref())
}

pub fn validate_machine_plan(plan: &MachinePlan) -> Result<(), MachineValidationError> {
    let mut body_ids = HashSet::new();
    let mut joint_ids = HashSet::new();
    let mut mount_ids = HashSet::new();
    let mut behavior_ids = HashSet::new();

    for body in &plan.bodies {
        ensure_unique(&mut body_ids, &body.id)?;
        ensure_transform_finite(&format!("body {}", body.id), &body.origin)?;
        for collider in &body.colliders {
            validate_collider(collider)?;
        }
    }

    for joint in &plan.joints {
        ensure_unique(&mut joint_ids, &joint.id)?;
        if !body_ids.contains(&joint.body_a_id) {
            return Err(MachineValidationError::UnknownJointBody {
                joint_id: joint.id.clone(),
                body_id: joint.body_a_id.clone(),
            });
        }
        if !body_ids.contains(&joint.body_b_id) {
            return Err(MachineValidationError::UnknownJointBody {
                joint_id: joint.id.clone(),
                body_id: joint.body_b_id.clone(),
            });
        }
        if joint.body_a_id == joint.body_b_id {
            return Err(MachineValidationError::DegenerateJoint {
                joint_id: joint.id.clone(),
                body_id: joint.body_a_id.clone(),
            });
        }
        ensure_vec3_finite(
            &format!("joint {} localAnchorA", joint.id),
            &joint.local_anchor_a,
        )?;
        ensure_vec3_finite(
            &format!("joint {} localAnchorB", joint.id),
            &joint.local_anchor_b,
        )?;
        if let Some(frame) = &joint.local_frame_a {
            ensure_quat_finite(&format!("joint {} localFrameA", joint.id), frame)?;
        }
        if let Some(frame) = &joint.local_frame_b {
            ensure_quat_finite(&format!("joint {} localFrameB", joint.id), frame)?;
        }
        if let Some(axis) = &joint.local_axis_a {
            ensure_vec3_finite(&format!("joint {} localAxisA", joint.id), axis)?;
        }
        if let Some(axis) = &joint.local_axis_b {
            ensure_vec3_finite(&format!("joint {} localAxisB", joint.id), axis)?;
        }
        match joint.kind {
            JointKind::Revolute | JointKind::Prismatic => {
                if joint.local_axis_a.is_none() {
                    return Err(MachineValidationError::MissingJointAxis {
                        joint_id: joint.id.clone(),
                        kind: joint.kind,
                    });
                }
            }
            JointKind::Fixed | JointKind::Spherical => {}
        }
    }

    for mount in &plan.mounts {
        ensure_unique(&mut mount_ids, &mount.id)?;
        if !body_ids.contains(&mount.body_id) {
            return Err(MachineValidationError::UnknownMountBody {
                mount_id: mount.id.clone(),
                body_id: mount.body_id.clone(),
            });
        }
        ensure_transform_finite(&format!("mount {}", mount.id), &mount.local_transform)?;
    }

    for behavior in &plan.behaviors {
        ensure_unique(&mut behavior_ids, &behavior.id)?;
        if !body_ids.contains(&behavior.body_id) {
            return Err(MachineValidationError::UnknownBehaviorBody {
                behavior_id: behavior.id.clone(),
                body_id: behavior.body_id.clone(),
            });
        }
        if behavior.kind != "thruster" {
            return Err(MachineValidationError::UnsupportedBehaviorKind(
                behavior.kind.clone(),
            ));
        }
    }

    Ok(())
}

fn validate_collider(collider: &PlannedCollider) -> Result<(), MachineValidationError> {
    ensure_transform_finite(
        &format!("collider {} localTransform", collider.id),
        &collider.local_transform,
    )?;
    match collider.kind {
        ColliderKind::Box => {
            if collider.half_extents.is_none() {
                return Err(MachineValidationError::MissingColliderShape {
                    collider_id: collider.id.clone(),
                    kind: collider.kind,
                });
            }
        }
        ColliderKind::Sphere => {
            if collider.radius.is_none() {
                return Err(MachineValidationError::MissingColliderShape {
                    collider_id: collider.id.clone(),
                    kind: collider.kind,
                });
            }
        }
        ColliderKind::Capsule | ColliderKind::Cylinder => {
            if collider.radius.is_none() || collider.half_height.is_none() {
                return Err(MachineValidationError::MissingColliderShape {
                    collider_id: collider.id.clone(),
                    kind: collider.kind,
                });
            }
        }
        ColliderKind::ConvexHull => {
            if collider
                .points
                .as_ref()
                .is_none_or(|points| points.len() < 4)
            {
                return Err(MachineValidationError::MissingColliderShape {
                    collider_id: collider.id.clone(),
                    kind: collider.kind,
                });
            }
        }
        ColliderKind::Trimesh => {
            if collider
                .vertices
                .as_ref()
                .is_none_or(|vertices| vertices.len() < 9)
                || collider
                    .indices
                    .as_ref()
                    .is_none_or(|indices| indices.len() < 3)
            {
                return Err(MachineValidationError::MissingColliderShape {
                    collider_id: collider.id.clone(),
                    kind: collider.kind,
                });
            }
        }
    }
    Ok(())
}

fn validate_machine_controls(
    plan: &MachinePlan,
    controls: Option<&crate::types::MachineControls>,
) -> Result<(), MachineValidationError> {
    let Some(controls) = controls else {
        return Ok(());
    };

    let joint_ids = plan
        .joints
        .iter()
        .map(|joint| format!("joint:{}", joint.id))
        .collect::<HashSet<_>>();
    let behavior_ids = plan
        .behaviors
        .iter()
        .map(|behavior| format!("behavior:{}", behavior.id))
        .collect::<HashSet<_>>();
    let actuator_ids = joint_ids
        .iter()
        .cloned()
        .chain(behavior_ids.iter().cloned())
        .collect::<HashSet<_>>();
    let command_ids = controls
        .controller
        .commands
        .iter()
        .map(|command| command.id.as_str())
        .collect::<HashSet<_>>();

    if !controls
        .bindings
        .profiles
        .iter()
        .any(|profile| profile.id == controls.bindings.default_profile_id)
    {
        return Err(MachineValidationError::UnknownDefaultControlProfile(
            controls.bindings.default_profile_id.clone(),
        ));
    }

    if !controls
        .controller
        .profiles
        .iter()
        .any(|profile| profile.id == controls.controller.default_profile_id)
    {
        return Err(MachineValidationError::UnknownDefaultControlProfile(
            controls.controller.default_profile_id.clone(),
        ));
    }

    for profile in &controls.bindings.profiles {
        if !matches!(
            profile.kind,
            MachineControlProfileKind::Keyboard | MachineControlProfileKind::Gamepad
        ) {
            return Err(MachineValidationError::UnsupportedControlProfileKind(
                profile.id.clone(),
            ));
        }

        for binding in &profile.bindings {
            match binding {
                MachineInputBinding::ButtonPair(button_pair) => {
                    if !actuator_ids.contains(button_pair.target_id.as_str()) {
                        if button_pair.target_id.starts_with("behavior:") {
                            return Err(MachineValidationError::UnknownControlBehavior(
                                button_pair.target_id.clone(),
                            ));
                        }
                        if button_pair.target_id.starts_with("joint:") {
                            return Err(MachineValidationError::UnknownControlJoint(
                                button_pair.target_id.clone(),
                            ));
                        }
                        return Err(MachineValidationError::UnknownControlJoint(
                            button_pair.target_id.clone(),
                        ));
                    }
                    validate_button_source(&button_pair.positive)?;
                    if let Some(negative) = &button_pair.negative {
                        validate_button_source(negative)?;
                    }
                }
                MachineInputBinding::Axis(axis_binding) => {
                    if !actuator_ids.contains(axis_binding.target_id.as_str()) {
                        if axis_binding.target_id.starts_with("behavior:") {
                            return Err(MachineValidationError::UnknownControlBehavior(
                                axis_binding.target_id.clone(),
                            ));
                        }
                        return Err(MachineValidationError::UnknownControlJoint(
                            axis_binding.target_id.clone(),
                        ));
                    }
                    let crate::types::MachineAxisSource::GamepadAxis { axis, .. } =
                        &axis_binding.source;
                    if *axis > 64 {
                        return Err(MachineValidationError::InvalidKeyboardCode(
                            format!("gamepadAxis:{axis}"),
                        ));
                    }
                }
            }
        }
    }

    for profile in &controls.controller.profiles {
        if !matches!(
            profile.kind,
            MachineControlProfileKind::Keyboard | MachineControlProfileKind::Gamepad
        ) {
            return Err(MachineValidationError::UnsupportedControlProfileKind(
                profile.id.clone(),
            ));
        }

        for binding in &profile.bindings {
            match binding {
                MachineInputBinding::ButtonPair(button_pair) => {
                    if !command_ids.contains(button_pair.target_id.as_str()) {
                        return Err(MachineValidationError::UnknownControlJoint(
                            button_pair.target_id.clone(),
                        ));
                    }
                    validate_button_source(&button_pair.positive)?;
                    if let Some(negative) = &button_pair.negative {
                        validate_button_source(negative)?;
                    }
                }
                MachineInputBinding::Axis(axis_binding) => {
                    if !command_ids.contains(axis_binding.target_id.as_str()) {
                        return Err(MachineValidationError::UnknownControlJoint(
                            axis_binding.target_id.clone(),
                        ));
                    }
                }
            }
        }
    }

    for assignment in &controls.controller.actuator_roles {
        if !actuator_ids.contains(assignment.actuator_id.as_str()) {
            return Err(MachineValidationError::UnknownControlJoint(
                assignment.actuator_id.clone(),
            ));
        }
    }

    if let Some(script) = &controls.controller.script {
        if script.language != "javascript" {
            return Err(MachineValidationError::UnsupportedControlProfileKind(
                script.language.clone(),
            ));
        }
    }

    Ok(())
}

fn validate_button_source(source: &crate::types::MachineButtonSource) -> Result<(), MachineValidationError> {
    match source {
        crate::types::MachineButtonSource::Keyboard { code } => validate_keyboard_code(code),
        crate::types::MachineButtonSource::GamepadButton { code, .. } => {
            if code.parse::<u32>().is_err() {
                return Err(MachineValidationError::InvalidKeyboardCode(code.clone()));
            }
            Ok(())
        }
    }
}

fn validate_keyboard_code(code: &str) -> Result<(), MachineValidationError> {
    if !is_valid_keyboard_code(code) {
        return Err(MachineValidationError::InvalidKeyboardCode(code.to_owned()));
    }
    Ok(())
}

fn is_valid_keyboard_code(code: &str) -> bool {
    if code.is_empty() {
        return false;
    }

    matches!(
        code,
        "Space"
            | "Enter"
            | "Tab"
            | "Escape"
            | "Backspace"
            | "Delete"
            | "Insert"
            | "Home"
            | "End"
            | "PageUp"
            | "PageDown"
            | "ArrowUp"
            | "ArrowDown"
            | "ArrowLeft"
            | "ArrowRight"
            | "ShiftLeft"
            | "ShiftRight"
            | "ControlLeft"
            | "ControlRight"
            | "AltLeft"
            | "AltRight"
            | "MetaLeft"
            | "MetaRight"
            | "CapsLock"
            | "Backquote"
            | "Minus"
            | "Equal"
            | "BracketLeft"
            | "BracketRight"
            | "Backslash"
            | "Semicolon"
            | "Quote"
            | "Comma"
            | "Period"
            | "Slash"
            | "Numpad0"
            | "Numpad1"
            | "Numpad2"
            | "Numpad3"
            | "Numpad4"
            | "Numpad5"
            | "Numpad6"
            | "Numpad7"
            | "Numpad8"
            | "Numpad9"
            | "NumpadAdd"
            | "NumpadSubtract"
            | "NumpadMultiply"
            | "NumpadDivide"
            | "NumpadDecimal"
            | "NumpadEnter"
    ) || code
        .strip_prefix("Key")
        .is_some_and(|suffix| suffix.len() == 1 && suffix.chars().all(|ch| ch.is_ascii_uppercase()))
        || code
            .strip_prefix("Digit")
            .is_some_and(|suffix| suffix.len() == 1 && suffix.chars().all(|ch| ch.is_ascii_digit()))
        || code.strip_prefix('F').is_some_and(
            |suffix| matches!(suffix.parse::<u8>(), Ok(value) if (1..=24).contains(&value)),
        )
}

fn ensure_unique(ids: &mut HashSet<String>, id: &str) -> Result<(), MachineValidationError> {
    if !ids.insert(id.to_owned()) {
        return Err(MachineValidationError::DuplicateId(id.to_owned()));
    }
    Ok(())
}

fn ensure_transform_finite(
    label: &str,
    transform: &crate::types::Transform,
) -> Result<(), MachineValidationError> {
    ensure_vec3_finite(&format!("{label}.position"), &transform.position)?;
    ensure_quat_finite(&format!("{label}.rotation"), &transform.rotation)
}

fn ensure_vec3_finite(
    label: &str,
    value: &crate::types::Vec3,
) -> Result<(), MachineValidationError> {
    if !(value.x.is_finite() && value.y.is_finite() && value.z.is_finite()) {
        return Err(MachineValidationError::NonFiniteValue(label.to_owned()));
    }
    Ok(())
}

fn ensure_quat_finite(
    label: &str,
    value: &crate::types::Quat,
) -> Result<(), MachineValidationError> {
    if !(value.x.is_finite() && value.y.is_finite() && value.z.is_finite() && value.w.is_finite()) {
        return Err(MachineValidationError::NonFiniteValue(label.to_owned()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{
        ColliderKind, MachineBehaviorPlan, MachineBindingScheme, MachineBodyPlan,
        MachineButtonPairBinding, MachineButtonSource, MachineControlProfileKind,
        MachineControlScheme, MachineControllerScheme, MachineControls, MachineInputBinding,
        MachineInputProfile, MachinePlan, PlannedCollider, Quat, RigidBodyKind,
        SERIALIZED_MACHINE_SCHEMA_VERSION, SerializedMachineEnvelope, SourcePart, Transform, Vec3,
    };

    fn identity_transform() -> Transform {
        Transform {
            position: Vec3 {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            rotation: Quat {
                x: 0.0,
                y: 0.0,
                z: 0.0,
                w: 1.0,
            },
        }
    }

    fn minimal_plan() -> MachinePlan {
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
                    id: "collider:0".into(),
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
            mounts: vec![],
            behaviors: vec![],
            diagnostics: vec![],
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

    #[test]
    fn rejects_wrong_schema_version() {
        let envelope = SerializedMachineEnvelope {
            schema_version: 99,
            catalog_version: "smcat1-test".into(),
            plan: minimal_plan(),
            controls: None,
            metadata: None,
        };

        let error = validate_machine_envelope(&envelope).unwrap_err();
        assert_eq!(error, MachineValidationError::UnsupportedSchemaVersion(99));
    }

    #[test]
    fn rejects_unknown_behavior_kind() {
        let mut plan = minimal_plan();
        plan.behaviors.push(MachineBehaviorPlan {
            id: "behavior:0".into(),
            block_id: "root".into(),
            block_type_id: "unknown".into(),
            part_id: "main".into(),
            body_id: "body:0".into(),
            kind: "not-supported".into(),
            props: serde_json::Map::new(),
            input: None,
            metadata: None,
        });

        let error = validate_machine_plan(&plan).unwrap_err();
        assert_eq!(
            error,
            MachineValidationError::UnsupportedBehaviorKind("not-supported".into())
        );
    }

    #[test]
    fn accepts_legacy_schema_version_without_controls() {
        let envelope = SerializedMachineEnvelope {
            schema_version: 1,
            catalog_version: "smcat1-test".into(),
            plan: minimal_plan(),
            controls: None,
            metadata: None,
        };

        validate_machine_envelope(&envelope).expect("legacy v1 envelope remains readable");
    }

    #[test]
    fn rejects_control_binding_with_unknown_target() {
        let envelope = SerializedMachineEnvelope {
            schema_version: SERIALIZED_MACHINE_SCHEMA_VERSION,
            catalog_version: "smcat1-test".into(),
            plan: minimal_plan(),
            controls: Some(MachineControls {
                active_scheme: MachineControlScheme::Bindings,
                bindings: MachineBindingScheme {
                    default_profile_id: "keyboard.default".into(),
                    profiles: vec![MachineInputProfile {
                        id: "keyboard.default".into(),
                        kind: MachineControlProfileKind::Keyboard,
                        bindings: vec![MachineInputBinding::ButtonPair(MachineButtonPairBinding {
                            target_id: "joint:missing-joint".into(),
                            positive: MachineButtonSource::Keyboard {
                                code: "KeyE".into(),
                            },
                            negative: Some(MachineButtonSource::Keyboard {
                                code: "KeyQ".into(),
                            }),
                            enabled: true,
                            scale: 1.0,
                        })],
                    }],
                },
                controller: empty_controller_scheme(),
            }),
            metadata: None,
        };

        let error = validate_machine_envelope(&envelope).unwrap_err();
        assert_eq!(
            error,
            MachineValidationError::UnknownControlJoint("joint:missing-joint".into())
        );
    }

    #[test]
    fn rejects_invalid_keyboard_code() {
        let mut plan = minimal_plan();
        plan.behaviors.push(MachineBehaviorPlan {
            id: "behavior:0".into(),
            block_id: "root".into(),
            block_type_id: "utility.thruster.small".into(),
            part_id: "main".into(),
            body_id: "body:0".into(),
            kind: "thruster".into(),
            props: serde_json::Map::new(),
            input: None,
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
                            target_id: "behavior:behavior:0".into(),
                            positive: MachineButtonSource::Keyboard {
                                code: "BadKey".into(),
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

        let error = validate_machine_envelope(&envelope).unwrap_err();
        assert_eq!(
            error,
            MachineValidationError::InvalidKeyboardCode("BadKey".into())
        );
    }
}
