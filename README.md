# snap-machines

A modular, renderer-agnostic snap-based construction system for building block machines with physics. Click-to-connect blocks, compile to rigid bodies and joints, and simulate with Rapier3D.

## Install

```bash
npm install @snap-machines/core
```

The package includes both the core engine and optional React Three Fiber editor components.

## How it works

1. **Define blocks** with geometry, colliders, mass, anchors, and optional joints using the schema layer
2. **Build mode**: use `findBestSnap` to snap blocks together via anchor matching
3. **Play mode**: use `compileMachinePlan` to merge structural components into compound rigid bodies, split at joints
4. **Simulate**: use `buildGraphIntoRapier` to instantiate the compiled plan into a Rapier3D physics world

## Core engine

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

## React Three Fiber components

Composable, unstyled R3F primitives for building snap-machine editors. You bring your own catalog, UI, and styling.

```tsx
import { BlockCatalog, BlockGraph } from "@snap-machines/core";
import { SnapScene, PhysicsScene } from "@snap-machines/core/react";
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

### Components

| Import from `@snap-machines/core/react` | Description |
|----------------------------------------|-------------|
| `<SnapScene>` | Interactive build mode — snap placement and block removal |
| `<PhysicsScene>` | Play mode — Rapier3D physics simulation |
| `<BlockMesh>` | Renders a single block's geometry |
| `<GhostPreview>` | Transparent snap preview overlay |
| `<GeometryMesh>` | Single geometry primitive renderer |
| `<PlayerController>` | First-person character controller |
| `DEFAULT_BLOCK_COLORS` | Default color map for common block types |

## Repository structure

```
packages/
  snap-machines/    @snap-machines/core
    src/            Core engine (schema, graph, snap, compiler, adapters)
    src/react/      React Three Fiber components
apps/
  demo/             Interactive demo application
examples/           Standalone TypeScript example scripts
```

## Development

```bash
npm install
npm run build
npm run dev -w snap-machines-demo
```

## License

MIT
