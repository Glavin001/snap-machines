# snap-machines-rapier

Headless Rust + Rapier runtime for machine payloads emitted by the web `snap-machines` builder.

## What it does

- deserializes the serialized machine envelope produced by `compileMachineEnvelope(...)`
- validates body, collider, joint, mount, and behavior references before instantiation
- instantiates rigid bodies, colliders, impulse joints, limits, and motors into Rapier
- applies runtime input bindings with the same `scale`, `invert`, `deadzone`, and `clamp` rules as the JS runtime
- supports the built-in `thruster` behavior for server-authoritative simulation

## Quick start

```rust
use snap_machines_rapier::{MachineRuntime, RapierSimulation, RuntimeInputState, RuntimeInputValue};

let envelope_json = std::fs::read_to_string("machine.json")?;
let mut simulation = RapierSimulation::default();
let mut runtime = MachineRuntime::from_json_str(&mut simulation, &envelope_json)?;

let mut input = RuntimeInputState::new();
input.insert("hingeSpin".into(), RuntimeInputValue::Scalar(0.5));
input.insert("throttle".into(), RuntimeInputValue::Scalar(1.0));

runtime.update(&mut simulation, &input, 1.0 / 60.0);
simulation.step();
# Ok::<(), Box<dyn std::error::Error>>(())
```

## Notes

- This crate consumes the compiled machine plan. It does not re-run the graph compiler or snap solver.
- `collisionGroups` and `solverGroups` are decoded from the packed `u32` format used by Rapier JS payloads.
- Unknown behavior kinds are rejected during validation in this v1 crate; `thruster` is implemented.
