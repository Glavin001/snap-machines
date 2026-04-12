# snap-machines

A modular, renderer-agnostic snap-based construction system for building block machines with physics. Click-to-connect blocks, compile to rigid bodies and joints, and simulate with Rapier3D.

## Packages

| Package | Description |
|---------|-------------|
| [`@snap-machines/core`](./packages/snap-machines) | Renderer-agnostic engine: block catalog, graph, snap solver, machine compiler, Rapier3D adapter |
| [`@snap-machines/react`](./packages/react) | Composable React Three Fiber components for building snap-machine editors |
| [`snap-machines-rapier`](./crates/snap-machines-rapier) | Headless Rust crate for consuming serialized machine envelopes in Rapier |
| [`snap-machines-viewer`](./crates/snap-machines-viewer) | Native Bevy viewer for visually validating play-mode machine envelopes |

## Apps

| App | Description |
|-----|-------------|
| [`snap-machines-demo`](./apps/demo) | Interactive demo showcasing build mode, play mode, and preset machines |

## Quick start

```bash
npm install
npm run build
npm run dev -w snap-machines-demo
```

For the Rust side:

```bash
cargo run -p snap-machines-viewer
```

## Install In Another Rust Project

The reusable Rust dependency is `snap-machines-rapier`. The Bevy viewer is a local binary crate for validation and debugging, not the package you would normally depend on.

Install `snap-machines-rapier` from Git:

```toml
[dependencies]
snap-machines-rapier = { git = "https://github.com/glavin001/snap-machines", package = "snap-machines-rapier" }
```

Then import it in code as:

```rust
use snap_machines_rapier::{MachineRuntime, RapierSimulation};
```

Once the crate is published to crates.io, that dependency can be replaced with a normal version requirement.

## Run Both Apps

Start the web builder:

```bash
npm run dev -w snap-machines-demo -- --host 127.0.0.1
```

The Vite app serves the builder and play-mode demo at `http://127.0.0.1:5173/`.

Start the native Rust viewer:

```bash
cargo run -p snap-machines-viewer
```

Or open a machine envelope exported from the web builder:

```bash
cargo run -p snap-machines-viewer -- path/to/machine.envelope.json
```

If no path is provided, the viewer loads the bundled sample fixture.

Checked-in viewer fixtures:

```bash
cargo run -p snap-machines-viewer -- crates/snap-machines-viewer/fixtures/4-wheel-car.envelope.json
cargo run -p snap-machines-viewer -- crates/snap-machines-viewer/fixtures/simple-house.envelope.json
```

## How it works

1. **Define blocks** with geometry, colliders, mass, anchors, and optional joints using the schema layer
2. **Build mode**: use `findBestSnap` to snap blocks together via anchor matching
3. **Play mode**: use `compileMachinePlan` to merge structural components into compound rigid bodies, split at joints
4. **Simulate**: use `buildGraphIntoRapier` to instantiate the compiled plan into a Rapier3D physics world

For headless or server-authoritative runtimes, the core package can also emit a serialized machine envelope via `compileMachineEnvelope(graph, catalog)`, which is intended to be consumed by non-web runtimes such as Rust + Rapier. The demo app now exposes this as an export action, and the Rust viewer crate can open that JSON directly.

## Builder To Viewer Flow

1. Run the web demo with `npm run dev -w snap-machines-demo`.
2. Build or load a machine in the web UI.
3. In build mode or play mode, click `Export Machine JSON`.
4. Open the exported `.envelope.json` in the Rust viewer:

```bash
cargo run -p snap-machines-viewer -- path/to/machine.envelope.json
```

If no file path is provided, the viewer opens the bundled sample fixture at [crates/snap-machines-viewer/fixtures/hinge-thruster-machine.envelope.json](./crates/snap-machines-viewer/fixtures/hinge-thruster-machine.envelope.json).

The viewer renders mount geometry from the compiled machine plan, steps the Rust Rapier runtime, and derives its controls from the machine's runtime action bindings:

- Right mouse drag to orbit the camera
- Mouse wheel to zoom
- Example defaults:
- `Q` / `E` for `hingeSpin` and `motorSpin`
- `A` / `D` for `armYaw`
- `W` / `S` for `armPitch`
- `Space` for `throttle`
- `R` to reset
- `P` to pause
- `F1` to toggle collider/joint debug overlay

For visual validation, the viewer also inserts a static ground collider just below the loaded machine's lowest collider so exported fixtures and builder output have something to rest on. The ground plane is part of the viewer scene, not part of the serialized machine envelope.

## Example

```ts
import {
  BlockCatalog,
  BlockGraph,
  exampleCatalog,
  findBestSnap,
  compileMachinePlan,
  transform,
  vec3,
} from "@snap-machines/core";

const catalog = new BlockCatalog().registerMany(exampleCatalog);
const graph = new BlockGraph();

const root = graph.addNode({
  typeId: "frame.cube.1",
  transform: transform(vec3(0, 0, 0)),
});

const snap = findBestSnap({
  graph,
  catalog,
  candidateTypeId: "frame.cube.1",
  hit: { blockId: root.id, point: vec3(0.5, 0, 0) },
});

if (snap) {
  graph.addNode({ typeId: "frame.cube.1", transform: snap.placement });
}

const plan = compileMachinePlan(graph, catalog);
console.log(plan.bodies.length, "bodies", plan.joints.length, "joints");
```

## With React Three Fiber

```tsx
import { BlockCatalog, BlockGraph } from "@snap-machines/core";
import { SnapScene, PhysicsScene } from "@snap-machines/react";
import { Canvas } from "@react-three/fiber";

function MyEditor() {
  const [graph] = useState(() => new BlockGraph());
  const [catalog] = useState(() => new BlockCatalog().registerMany(myBlocks));

  return (
    <Canvas>
      <SnapScene
        graph={graph}
        catalog={catalog}
        selectedType="frame.cube.1"
      />
    </Canvas>
  );
}
```

## Repository structure

```
packages/
  snap-machines/    @snap-machines/core - engine & compiler
  react/            @snap-machines/react - R3F editor components
apps/
  demo/             Interactive demo application
examples/           Standalone TypeScript example scripts
```

## License

MIT
