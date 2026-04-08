# @snap-machines/react

Composable, unstyled React Three Fiber components for building snap-machine editors. Provides the 3D building blocks — you bring your own block catalog, UI, and styling.

## Install

```bash
npm install @snap-machines/core @snap-machines/react
```

Peer dependencies:

```bash
npm install react three @react-three/fiber @dimforge/rapier3d-compat
```

## Quick example

```tsx
import { useState } from "react";
import { BlockCatalog, BlockGraph, TRANSFORM_IDENTITY } from "@snap-machines/core";
import { SnapScene, PhysicsScene } from "@snap-machines/react";
import { Canvas } from "@react-three/fiber";

const catalog = new BlockCatalog().registerMany(myBlocks);

function Editor() {
  const [graph] = useState(() => {
    const g = new BlockGraph();
    g.addNode({ id: "origin", typeId: "frame.cube.1", transform: TRANSFORM_IDENTITY });
    return g;
  });

  return (
    <Canvas>
      <ambientLight />
      <SnapScene
        graph={graph}
        catalog={catalog}
        selectedType="frame.cube.1"
        onBlockPlaced={() => console.log("placed!")}
        onBlockRemoved={() => console.log("removed!")}
      />
    </Canvas>
  );
}
```

## Components

### Rendering primitives

| Component | Description |
|-----------|-------------|
| `<BlockMesh>` | Renders a single block's geometry at its transform. Accepts optional `colorMap` prop. |
| `<GeometryMesh>` | Renders a single geometry primitive (box, sphere, capsule, cylinder). |
| `<GhostPreview>` | Transparent snap preview overlay. Disables raycasting to avoid pointer event interference. |

### Editor scenes

| Component | Description |
|-----------|-------------|
| `<SnapScene>` | Interactive build mode. Handles pointer events for snap placement (click) and block removal (right-click). Manages ghost preview via refs for zero-rerender performance. |
| `<PhysicsScene>` | Play/simulate mode. Initializes Rapier3D, compiles the block graph into physics bodies and joints, and steps the simulation each frame. |
| `<PlayerController>` | First-person character controller with WASD movement, mouse look (pointer lock), jumping, and dynamic body pushing. |

### Utilities

| Export | Description |
|--------|-------------|
| `DEFAULT_BLOCK_COLORS` | Default color map (`Record<string, string>`) for common block type IDs. |

## Props

### SnapScene

| Prop | Type | Description |
|------|------|-------------|
| `graph` | `BlockGraph` | The block graph to build on |
| `catalog` | `BlockCatalog` | Block definitions catalog |
| `selectedType` | `string` | Block type ID to place on click |
| `colorMap` | `Record<string, string>` | Optional color overrides per block type |
| `onBlockPlaced` | `() => void` | Called after a block is placed |
| `onBlockRemoved` | `() => void` | Called after a block is removed |

### PhysicsScene

| Prop | Type | Description |
|------|------|-------------|
| `graph` | `BlockGraph` | The block graph to simulate |
| `catalog` | `BlockCatalog` | Block definitions catalog |
| `inputState` | `RuntimeInputState` | Input state for motors and behaviors |
| `colorMap` | `Record<string, string>` | Optional color overrides per block type |
| `firstPerson` | `boolean` | Enable first-person camera mode |
| `gravity` | `number` | Gravity magnitude (default: 9.81) |
| `onReady` | `() => void` | Called when physics is initialized |

### BlockMesh

| Prop | Type | Description |
|------|------|-------------|
| `nodeId` | `string` | Block node ID (stored in `userData.snapBlockId` for hit detection) |
| `typeId` | `string` | Block type ID from the catalog |
| `blockTransform` | `Transform` | World transform for the block |
| `catalog` | `BlockCatalog` | Block definitions catalog |
| `colorMap` | `Record<string, string>` | Optional color overrides |

## Design philosophy

This package is **unstyled and data-focused**. It does NOT include:

- UI chrome (toolbars, panels, mode switchers)
- Styling or themes
- Hardcoded block catalogs or presets

You provide:

- Your own `BlockCatalog` with custom block definitions
- Your own 2D UI around the `<Canvas>`
- Optional custom color maps

## License

MIT
