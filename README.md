# snap-machines

A modular, renderer-agnostic snap-based construction system for building block machines with physics. Click-to-connect blocks, compile to rigid bodies and joints, and simulate with Rapier3D.

## Packages

| Package | Description |
|---------|-------------|
| [`@snap-machines/core`](./packages/snap-machines) | Renderer-agnostic engine: block catalog, graph, snap solver, machine compiler, Rapier3D adapter |
| [`@snap-machines/react`](./packages/react) | Composable React Three Fiber components for building snap-machine editors |

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

## How it works

1. **Define blocks** with geometry, colliders, mass, anchors, and optional joints using the schema layer
2. **Build mode**: use `findBestSnap` to snap blocks together via anchor matching
3. **Play mode**: use `compileMachinePlan` to merge structural components into compound rigid bodies, split at joints
4. **Simulate**: use `buildGraphIntoRapier` to instantiate the compiled plan into a Rapier3D physics world

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
