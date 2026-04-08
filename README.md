# snap-machines

Renderer-agnostic snap-based construction system for block machines, with:

- a data-driven block catalog
- a serializable block graph (`nodes + connections`)
- a build-mode snap solver
- a physics-agnostic machine plan compiler
- a first-class Rapier3D runtime adapter
- a lightweight Three.js reference integration

## Main ideas

- **Schema layer**: define blocks with geometry, colliders, mass, anchors, behaviors, and optional two-part joints.
- **Build mode**: use `findBestSnap` to evaluate anchor matches from a raycast hit and preview transform.
- **Play mode**: use `compileMachinePlan` to merge structural components into compound rigid bodies, split at joint blocks, and emit a runtime plan.
- **Rapier runtime**: use `buildGraphIntoRapier` or `new RapierMachineRuntime(...)` to instantiate bodies, colliders, joints, motors, and behaviors.

## Quick example

```ts
import {
  BlockCatalog,
  BlockGraph,
  exampleCatalog,
  findBestSnap,
  compileMachinePlan,
  buildGraphIntoRapier,
  transform,
  vec3,
} from "snap-machines";

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
  previewTransform: transform(vec3(1.2, 0.1, 0.2)),
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

// Later, with a Rapier world:
// const { plan, runtime } = buildGraphIntoRapier(graph, catalog, RAPIER, world, {
//   behaviorFactories: {
//     thruster: createThrusterBehaviorFactory(),
//   },
// });
// runtime.update({ throttle: 1, hingeSpin: 0.5 }, 1 / 60);
// world.step();
```

## Joint blocks

Joint blocks are modeled as **exactly two physical parts**. That keeps partitioning simple and predictable:

- each part becomes part of a structural component
- the compiler merges each structural component into one body
- the joint block inserts a joint between the two compiled bodies
- if an alternate rigid path exists around the joint, the compiler reports a diagnostic and skips the joint because the articulation is effectively braced shut

## Three.js integration

`integrations/three.ts` includes small helpers for:

- mapping raycast intersections to block ids
- copying transforms into `Object3D` instances
- syncing mount transforms into a set of bound objects each frame

## Built-in example behavior

The Rapier adapter ships with one example behavior factory:

- `createThrusterBehaviorFactory()` — reads a scalar input and applies a force at a local point on the owning rigid body

Wheel drive is usually better represented as a joint motor on a revolute joint block, so that path is handled by the compile plan and runtime motor update instead of a bespoke behavior.
