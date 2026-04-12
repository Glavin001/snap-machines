# @snap-machines/core

Renderer-agnostic snap-based construction system for block machines, with:

- a data-driven block catalog
- a serializable block graph (`nodes + connections`)
- a build-mode snap solver
- a physics-agnostic machine plan compiler
- a first-class Rapier3D runtime adapter
- a lightweight Three.js reference integration

## Install

```bash
npm install @snap-machines/core
```

Peer dependencies (install the ones you need):

```bash
npm install @dimforge/rapier3d  # for physics simulation
npm install three               # for Three.js helpers
```

## Quick example

```ts
import {
  BlockCatalog,
  BlockGraph,
  exampleCatalog,
  findBestSnap,
  compileMachinePlan,
  compileMachineEnvelope,
  buildGraphIntoRapier,
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
  hit: {
    blockId: root.id,
    point: vec3(0.5, 0, 0),
  },
});

if (snap) {
  const child = graph.addNode({
    typeId: "frame.cube.1",
    transform: snap.placement,
  });

  graph.addConnection({
    a: { blockId: root.id, anchorId: snap.target.anchor.id },
    b: { blockId: child.id, anchorId: snap.sourceAnchor.id },
  });
}

const plan = compileMachinePlan(graph, catalog);
console.log(plan.bodies.length, plan.joints.length);

const envelope = compileMachineEnvelope(graph, catalog, {
  metadata: {
    builder: "web",
  },
});
console.log(envelope.catalogVersion, envelope.schemaVersion);

// With a Rapier world:
// const { plan, runtime } = buildGraphIntoRapier(graph, catalog, RAPIER, world, {
//   behaviorFactories: {
//     thruster: createThrusterBehaviorFactory(),
//   },
// });
// runtime.update({ throttle: 1, hingeSpin: 0.5 }, 1 / 60);
// world.step();
```

## Main concepts

### Schema layer

Define blocks with geometry, colliders, mass, anchors, behaviors, and optional two-part joints. Register them in a `BlockCatalog`.

### Build mode

Use `findBestSnap` to evaluate anchor matches from a raycast hit point. The snap solver finds the closest compatible anchor pair and returns the placement transform.

### Play mode

Use `compileMachinePlan` to merge structural components into compound rigid bodies, split at joint blocks, and emit a runtime plan with bodies, colliders, joints, motors, and behaviors.

### Rapier runtime

Use `buildGraphIntoRapier` or `new RapierMachineRuntime(...)` to instantiate the compiled plan into a Rapier3D physics world. Call `runtime.update(inputState, dt)` each frame to drive motors and behaviors.

### Headless / Rust integration

Use `compileMachineEnvelope(graph, catalog)` to emit a sanitized machine payload for a non-web runtime such as Rust + Rapier. The returned envelope contains:

- `schemaVersion` — serialized machine schema version
- `catalogVersion` — deterministic version hash derived from the normalized catalog
- `plan` — the compiled `MachinePlan` with bodies, colliders, joints, mounts, motors, and behaviors
- `controls` — portable default input profiles, including the default keyboard starter bindings for each controllable joint or behavior

If you need to ship the block catalog alongside the machine contract, use `serializeBlockCatalog(catalog)`. The serialized `controls` payload is intended as a portable starter layout for interactive clients; runtime input still flows into Rapier as action-value maps, the same way the JS runtime expects `runtime.update({ throttle: 1, hingeSpin: 0.5 }, dt)`.

## Joint blocks

Joint blocks are modeled as **exactly two physical parts**:

- each part becomes part of a structural component
- the compiler merges each structural component into one rigid body
- the joint block inserts a joint between the two compiled bodies
- if an alternate rigid path exists around the joint, the compiler reports a diagnostic and skips the joint

## Three.js integration

`integrations/three.ts` includes helpers for:

- mapping raycast intersections to block ids
- copying transforms into `Object3D` instances
- syncing mount transforms into a set of bound objects each frame

## Built-in example behavior

The Rapier adapter ships with one example behavior factory:

- `createThrusterBehaviorFactory()` — reads a scalar input and applies a force at a local point on the owning rigid body

## License

MIT
