# @snap-machines/core

Snap-based construction system for block machines, with:

- a data-driven block catalog and serializable block graph
- a build-mode snap solver
- a physics-agnostic machine plan compiler
- a first-class Rapier3D runtime adapter
- a lightweight Three.js reference integration
- composable React Three Fiber editor components (via `@snap-machines/core/react`)

## Install

```bash
npm install @snap-machines/core
```

Peer dependencies (install the ones you need):

```bash
npm install three                     # Three.js helpers
npm install @dimforge/rapier3d        # Rapier3D physics (Node.js)
npm install @dimforge/rapier3d-compat # Rapier3D physics (browser)
npm install react @react-three/fiber  # React Three Fiber components
```

## Core usage

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
```

## React Three Fiber components

Composable, unstyled R3F primitives for building snap-machine editors. Import from `@snap-machines/core/react`.

```tsx
import { BlockCatalog, BlockGraph, TRANSFORM_IDENTITY } from "@snap-machines/core";
import { SnapScene, PhysicsScene } from "@snap-machines/core/react";
import { Canvas } from "@react-three/fiber";

function Editor() {
  const [graph] = useState(() => {
    const g = new BlockGraph();
    g.addNode({ id: "origin", typeId: "frame.cube.1", transform: TRANSFORM_IDENTITY });
    return g;
  });

  return (
    <Canvas>
      <SnapScene graph={graph} catalog={catalog} selectedType="frame.cube.1" />
    </Canvas>
  );
}
```

### Components

| Component | Description |
|-----------|-------------|
| `<SnapScene>` | Interactive build mode. Snap placement (click) and block removal (right-click). |
| `<PhysicsScene>` | Play/simulate mode. Rapier3D physics with motor and behavior input. |
| `<BlockMesh>` | Renders a single block's geometry at its transform. |
| `<GhostPreview>` | Transparent snap preview overlay. |
| `<GeometryMesh>` | Single geometry primitive (box, sphere, capsule, cylinder). |
| `<PlayerController>` | First-person character controller (WASD, mouse look, jumping). |
| `DEFAULT_BLOCK_COLORS` | Default color map for common block type IDs. |

### SnapScene props

| Prop | Type | Description |
|------|------|-------------|
| `graph` | `BlockGraph` | The block graph to build on |
| `catalog` | `BlockCatalog` | Block definitions catalog |
| `selectedType` | `string` | Block type ID to place on click |
| `colorMap` | `Record<string, string>` | Optional color overrides per block type |
| `onBlockPlaced` | `() => void` | Called after a block is placed |
| `onBlockRemoved` | `() => void` | Called after a block is removed |

### PhysicsScene props

| Prop | Type | Description |
|------|------|-------------|
| `graph` | `BlockGraph` | The block graph to simulate |
| `catalog` | `BlockCatalog` | Block definitions catalog |
| `inputState` | `RuntimeInputState` | Input state for motors and behaviors |
| `colorMap` | `Record<string, string>` | Optional color overrides per block type |
| `firstPerson` | `boolean` | Enable first-person camera mode |
| `gravity` | `number` | Gravity magnitude (default: 9.81) |
| `onReady` | `() => void` | Called when physics is initialized |

## Main concepts

- **Schema layer**: define blocks with geometry, colliders, mass, anchors, behaviors, and optional two-part joints
- **Build mode**: `findBestSnap` evaluates anchor matches from a raycast hit and returns placement transforms
- **Play mode**: `compileMachinePlan` merges structural components into compound rigid bodies, split at joint blocks
- **Rapier runtime**: `buildGraphIntoRapier` instantiates the compiled plan into a physics world

## Joint blocks

Joint blocks are modeled as **exactly two physical parts**:

- each part merges into a structural component (rigid body)
- the joint block inserts a physics joint between the two bodies
- if an alternate rigid path exists around the joint, the compiler skips it (articulation is braced shut)

## License

MIT
