# snap-machines-rapier

Headless Rust + Rapier runtime for machine payloads emitted by the web `snap-machines` builder.

## Installation

Install directly from Git:

```toml
[dependencies]
snap-machines-rapier = { git = "https://github.com/glavin001/snap-machines", package = "snap-machines-rapier" }
```

To lock to a specific revision or tag:

```toml
[dependencies]
snap-machines-rapier = { git = "https://github.com/glavin001/snap-machines", package = "snap-machines-rapier", rev = "<commit-sha>" }
```

In Rust code, the crate is imported as `snap_machines_rapier`.

## What This Crate Does

This crate consumes a serialized machine envelope exported by the JS builder. It does not compile a block graph or run the snap solver itself.

It provides:

- validation for exported machine envelopes
- installation of a machine into a Rapier world
- per-machine actuator updates using action-value inputs
- transform readback for bodies and mounts
- clean removal of an installed machine from a shared world

## Quick Start With An Existing Rapier World

This is the main integration path for engine or server code that already owns Rapier:

Integration checklist:

1. Create or reuse your Rapier world as usual.
2. Wrap the relevant Rapier sets in `MachineWorldMut` and install a machine.
3. Each tick, build `RuntimeInputState` and call `update_in_world(...)`.
4. Step Rapier in your app.
5. Read back transforms or remove the machine when needed.

```rust
use rapier3d::prelude::*;
use snap_machines_rapier::{
    MachineRuntime, MachineWorldMut, MachineWorldRef, MachineWorldRemove, RuntimeInputState,
    RuntimeInputValue,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // ---------------------------------------------------------------------
    // 1. Normal Rapier setup owned by your app.
    //    This is standard host-side physics initialization, not specific to
    //    snap-machines.
    // ---------------------------------------------------------------------
    let gravity = vector![0.0, -9.81, 0.0];
    let integration_parameters = IntegrationParameters::default();
    let mut pipeline = PhysicsPipeline::new();
    let mut islands = IslandManager::new();
    let mut broad_phase = DefaultBroadPhase::new();
    let mut narrow_phase = NarrowPhase::new();
    let mut bodies = RigidBodySet::new();
    let mut colliders = ColliderSet::new();
    let mut impulse_joints = ImpulseJointSet::new();
    let mut multibody_joints = MultibodyJointSet::new();
    let mut ccd_solver = CCDSolver::new();

    // Your app can also add its own Rapier objects.
    let ground_body = bodies.insert(
        RigidBodyBuilder::fixed()
            .translation(vector![0.0, -0.5, 0.0])
            .build(),
    );
    colliders.insert_with_parent(
        ColliderBuilder::cuboid(50.0, 0.5, 50.0).build(),
        ground_body,
        &mut bodies,
    );

    // ---------------------------------------------------------------------
    // 2. Load a snap-machine envelope.
    //    This JSON comes from the snap-machines builder / compiler.
    // ---------------------------------------------------------------------
    let json = std::fs::read_to_string("machine.envelope.json")?;

    // ---------------------------------------------------------------------
    // 3. IMPORTANT: pass your existing Rapier sets into MachineWorldMut.
    //    This is the snap-machines integration point.
    // ---------------------------------------------------------------------
    let mut install_world = MachineWorldMut {
        bodies: &mut bodies,
        colliders: &mut colliders,
        impulse_joints: &mut impulse_joints,
    };
    let mut machine = MachineRuntime::install_json_str(&mut install_world, &json)?;

    // ---------------------------------------------------------------------
    // 4. Main loop:
    //    - build actuator input for this machine
    //    - let snap-machines apply those inputs into the host Rapier world
    //    - step Rapier once in your app
    // ---------------------------------------------------------------------
    for frame in 0..600 {
        let mut input = RuntimeInputState::new();

        if frame < 180 {
            input.insert("throttle".into(), RuntimeInputValue::Scalar(1.0));
        }

        if (120..300).contains(&frame) {
            input.insert("hingeSpin".into(), RuntimeInputValue::Scalar(0.5));
        }

        // IMPORTANT: this updates only the installed machine.
        // It does not step Rapier.
        let mut update_world = MachineWorldMut {
            bodies: &mut bodies,
            colliders: &mut colliders,
            impulse_joints: &mut impulse_joints,
        };
        machine.update_in_world(&mut update_world, &input, 1.0 / 60.0);

        // Normal host-side Rapier step.
        pipeline.step(
            &gravity,
            &integration_parameters,
            &mut islands,
            &mut broad_phase,
            &mut narrow_phase,
            &mut bodies,
            &mut colliders,
            &mut impulse_joints,
            &mut multibody_joints,
            &mut ccd_solver,
            None,
            &(),
            &(),
        );

        // Optional readback for rendering, networking, logging, etc.
        let read_world = MachineWorldRef { bodies: &bodies };
        if let Some(chassis) = machine.body_transform_in_world(&read_world, "body:0") {
            println!("frame {frame}: body x = {}", chassis.position.x);
        }
    }

    // ---------------------------------------------------------------------
    // 5. IMPORTANT: remove only this machine from the shared Rapier world.
    //    Host-owned Rapier objects remain in place.
    // ---------------------------------------------------------------------
    let mut remove_world = MachineWorldRemove {
        islands: &mut islands,
        bodies: &mut bodies,
        colliders: &mut colliders,
        impulse_joints: &mut impulse_joints,
        multibody_joints: &mut multibody_joints,
    };
    machine.remove_from_world(&mut remove_world)?;

    Ok(())
}
```

The important split is:

- your app owns Rapier
- `MachineRuntime::install_*` inserts only the machine’s bodies, colliders, joints, and behaviors into that world
- `update_in_world(...)` applies actuator inputs only to that machine
- your app still decides when Rapier steps
- `remove_from_world(...)` removes only that machine

## Main Types

- `SerializedMachineEnvelope`: the exported top-level JSON payload
- `MachinePlan`: the compiled rigid-body, collider, joint, mount, and behavior plan
- `MachineRuntime`: one installed snap-machine plus the Rapier handles it owns
- `RuntimeInputState`: per-tick action inputs such as `throttle` or `hingeSpin`
- `MachineWorldMut`: the raw Rapier sets needed to install or update a machine
- `MachineWorldRef`: the raw Rapier sets needed to read transforms back out
- `MachineWorldRemove`: the raw Rapier sets needed to remove a machine cleanly
- `RapierSimulation`: an optional convenience wrapper owned by this crate for simple standalone use

## Construction Paths

Use whichever input form you already have:

- `MachineRuntime::install_json_str(...)`
- `MachineRuntime::install_envelope(...)`
- `MachineRuntime::install_plan(...)`

The legacy convenience constructors still work:

- `MachineRuntime::from_json_str(...)`
- `MachineRuntime::from_envelope(...)`
- `MachineRuntime::from_plan(...)`

Those are built on top of the same runtime logic, but they target this crate’s `RapierSimulation` wrapper instead of raw Rapier sets.

## Programmatic Inputs

Runtime inputs are keyed by action name. Those action names come from the exported machine plan, for example `throttle`, `hingeSpin`, or any custom action your machine uses.

```rust
use snap_machines_rapier::{RuntimeInputState, RuntimeInputValue};

let mut input = RuntimeInputState::new();
input.insert("throttle".into(), RuntimeInputValue::Scalar(1.0));
input.insert("hingeSpin".into(), RuntimeInputValue::Scalar(-0.5));
input.insert("fire".into(), RuntimeInputValue::Bool(true));
```

The runtime applies the exported binding rules automatically, including `scale`, `invert`, `deadzone`, and `clamp`.

For advanced motor control, you can also provide a scalar `"<action>:vff"` input to add velocity feed-forward on motorized joints.

## Discovering Available Actions

If you are driving arbitrary machines, inspect `runtime.plan()`:

```rust
for joint in &machine.plan().joints {
    if let Some(motor) = &joint.motor {
        if let Some(binding) = &motor.input {
            println!("joint {} uses action {}", joint.id, binding.action);
        }
    }
}

for behavior in &machine.plan().behaviors {
    if let Some(binding) = &behavior.input {
        println!("behavior {} uses action {}", behavior.id, binding.action);
    }
}
```

Each installed `MachineRuntime` receives its own `RuntimeInputState`, so multiple machines in one world may reuse the same action names without conflict.

## Reading State Back Out

After the host steps Rapier, read world transforms from bodies or mounts:

```rust
use rapier3d::prelude::RigidBodySet;
use snap_machines_rapier::{MachineRuntime, MachineWorldRef};

# let bodies = RigidBodySet::new();
# let read_world = MachineWorldRef { bodies: &bodies };
# let machine: Option<MachineRuntime> = None;
# let machine = machine.unwrap_or_else(|| unreachable!());
for body in &machine.plan().bodies {
    let world = machine.body_transform_in_world(&read_world, &body.id);
    println!("body {} -> {:?}", body.id, world);
}

for mount in &machine.plan().mounts {
    let world = machine.mount_world_transform_in_world(&read_world, &mount.id);
    println!("mount {} -> {:?}", mount.id, world);
}
```

In practice:

- use `body_transform_in_world(...)` for rigid body poses
- use `mount_world_transform_in_world(...)` for attachment or render-anchor poses
- use `plan()` when you need joints, colliders, mounts, or behaviors

## Building Your Own Viewer

The snap-machines-specific part of a viewer is:

1. Install a machine into a Rapier world.
2. Inspect `runtime.plan().mounts` and create one visual root per mount.
3. Use each mount’s `geometry` as local render data, or substitute your own visuals.
4. After each Rapier step, update each visual root from `runtime.mount_world_transform_in_world(...)`.

For collider or joint debug rendering, use:

- `runtime.plan().bodies[*].colliders` plus `runtime.body_transform_in_world(...)`
- `runtime.plan().joints` plus the connected body transforms

Everything else in the shipped Bevy viewer is camera, UI, input mapping, and rendering policy.

## Convenience Wrapper

If you do not already have a Rapier world, you can still use the crate-owned wrapper:

```rust
use snap_machines_rapier::{MachineRuntime, RapierSimulation, RuntimeInputState};

let json = std::fs::read_to_string("machine.envelope.json")?;
let mut simulation = RapierSimulation::default();
let mut machine = MachineRuntime::from_json_str(&mut simulation, &json)?;

machine.update(&mut simulation, &RuntimeInputState::new(), 1.0 / 60.0);
simulation.step();
# Ok::<(), Box<dyn std::error::Error>>(())
```

`RapierSimulation` also exposes `world_ref()`, `world_mut()`, and `world_remove()` if you want to mix the convenience wrapper with the raw-world API.

## Validation

If you want validation as a separate step before installation:

```rust
use snap_machines_rapier::{SerializedMachineEnvelope, validate_machine_envelope};

let envelope: SerializedMachineEnvelope =
    serde_json::from_str(&std::fs::read_to_string("machine.envelope.json")?)?;
validate_machine_envelope(&envelope)?;
# Ok::<(), Box<dyn std::error::Error>>(())
```

This is optional when using `install_json_str(...)`, `install_envelope(...)`, `from_json_str(...)`, or `from_envelope(...)`, because those validate internally.

## Notes

- This crate consumes the compiled machine plan. It does not re-run the graph compiler or snap solver.
- Exported control profiles are validated when present, but the runtime API itself is driven by `RuntimeInputState`.
- `collisionGroups` and `solverGroups` are decoded from the packed `u32` format used by Rapier JS payloads.
- Unknown behavior kinds are rejected during validation; `thruster` is implemented.
