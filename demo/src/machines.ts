/**
 * Pre-built machine definitions that demonstrate the snap construction system
 * compiled to Rapier3D physics.
 *
 * Each factory uses the snap alignment math to place blocks at exact positions,
 * ensuring joints and connections resolve correctly during compilation.
 */
import {
  BlockCatalog,
  BlockGraph,
  QUAT_IDENTITY,
  vec3,
  RuntimeInputState,
  alignAnchorPair,
  getWorldAnchorTransform,
} from "snap-construction-system";

export interface MachinePreset {
  name: string;
  description: string;
  build(catalog: BlockCatalog): BlockGraph;
  autoInput: RuntimeInputState;
  cameraPosition: [number, number, number];
}

/**
 * Place a new block so that `sourceAnchorId` on the new block aligns exactly
 * with `targetAnchorId` on the existing `targetBlockId`. Uses the same anchor
 * alignment math as the interactive snap solver.
 */
function snapBlock(
  g: BlockGraph,
  catalog: BlockCatalog,
  opts: {
    id: string;
    typeId: string;
    targetBlockId: string;
    targetAnchorId: string;
    sourceAnchorId: string;
  },
): string {
  const targetNode = g.getNode(opts.targetBlockId)!;
  const targetBlock = catalog.get(targetNode.typeId);
  const targetAnchor = targetBlock.anchors.find((a) => a.id === opts.targetAnchorId)!;
  const targetWorld = getWorldAnchorTransform(targetNode.transform, targetAnchor);

  const sourceBlock = catalog.get(opts.typeId);
  const sourceAnchor = sourceBlock.anchors.find((a) => a.id === opts.sourceAnchorId)!;

  const placement = alignAnchorPair(targetWorld, sourceAnchor);

  g.addNode({ id: opts.id, typeId: opts.typeId, transform: placement });
  g.addConnection({
    a: { blockId: opts.targetBlockId, anchorId: opts.targetAnchorId },
    b: { blockId: opts.id, anchorId: opts.sourceAnchorId },
  });

  return opts.id;
}

// ---------------------------------------------------------------------------
// 1. Simple 4-Wheel Car
//
// Beam chassis (5x1) with 4 motor-wheels on the Z-side faces.
// Wheel radius (0.8) > chassis half-height (0.5), so the car rides
// on wheels without the chassis dragging the ground.
// ---------------------------------------------------------------------------

function buildCar(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  g.addNode({
    id: "chassis",
    typeId: "frame.beam.5x1",
    transform: { position: vec3(0, 2, 0), rotation: QUAT_IDENTITY },
  });

  // Front-left (+Z side, X=-2)
  snapBlock(g, catalog, {
    id: "fl-wheel",
    typeId: "joint.motor.wheel",
    targetBlockId: "chassis",
    targetAnchorId: "zp.l",
    sourceAnchorId: "axle.mount",
  });

  // Front-right (-Z side, X=-2)
  snapBlock(g, catalog, {
    id: "fr-wheel",
    typeId: "joint.motor.wheel",
    targetBlockId: "chassis",
    targetAnchorId: "zn.l",
    sourceAnchorId: "axle.mount",
  });

  // Rear-left (+Z side, X=+2)
  snapBlock(g, catalog, {
    id: "rl-wheel",
    typeId: "joint.motor.wheel",
    targetBlockId: "chassis",
    targetAnchorId: "zp.r",
    sourceAnchorId: "axle.mount",
  });

  // Rear-right (-Z side, X=+2)
  snapBlock(g, catalog, {
    id: "rr-wheel",
    typeId: "joint.motor.wheel",
    targetBlockId: "chassis",
    targetAnchorId: "zn.r",
    sourceAnchorId: "axle.mount",
  });

  return g;
}

// ---------------------------------------------------------------------------
// 2. Hinged Walker
//
// Two planks joined along Z form a wide body. Hinges on the bottom face
// (yn anchors) have axis=Z in world space, so legs swing forward/backward.
// Rotor extends downward (-Y), legs hang below the body.
// ---------------------------------------------------------------------------

function buildWalker(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  // Two planks joined along Z for a 3x1x2 body with 4 bottom corners
  g.addNode({
    id: "body-a",
    typeId: "frame.plank.3x1",
    transform: { position: vec3(0, 3, 0), rotation: QUAT_IDENTITY },
  });
  snapBlock(g, catalog, {
    id: "body-b",
    typeId: "frame.plank.3x1",
    targetBlockId: "body-a",
    targetAnchorId: "zp",
    sourceAnchorId: "zn",
  });

  // Front-left leg: hinge on body-a bottom-left, leg cube on rotor
  snapBlock(g, catalog, {
    id: "hinge-fl",
    typeId: "joint.hinge.small",
    targetBlockId: "body-a",
    targetAnchorId: "yn.l",
    sourceAnchorId: "base.xn",
  });
  snapBlock(g, catalog, {
    id: "leg-fl",
    typeId: "frame.cube.1",
    targetBlockId: "hinge-fl",
    targetAnchorId: "rotor.xp",
    sourceAnchorId: "yp",
  });

  // Front-right leg: hinge on body-b bottom-left
  snapBlock(g, catalog, {
    id: "hinge-fr",
    typeId: "joint.hinge.small",
    targetBlockId: "body-b",
    targetAnchorId: "yn.l",
    sourceAnchorId: "base.xn",
  });
  snapBlock(g, catalog, {
    id: "leg-fr",
    typeId: "frame.cube.1",
    targetBlockId: "hinge-fr",
    targetAnchorId: "rotor.xp",
    sourceAnchorId: "yp",
  });

  // Rear-left leg: hinge on body-a bottom-right
  snapBlock(g, catalog, {
    id: "hinge-rl",
    typeId: "joint.hinge.small",
    targetBlockId: "body-a",
    targetAnchorId: "yn.r",
    sourceAnchorId: "base.xn",
  });
  snapBlock(g, catalog, {
    id: "leg-rl",
    typeId: "frame.cube.1",
    targetBlockId: "hinge-rl",
    targetAnchorId: "rotor.xp",
    sourceAnchorId: "yp",
  });

  // Rear-right leg: hinge on body-b bottom-right
  snapBlock(g, catalog, {
    id: "hinge-rr",
    typeId: "joint.hinge.small",
    targetBlockId: "body-b",
    targetAnchorId: "yn.r",
    sourceAnchorId: "base.xn",
  });
  snapBlock(g, catalog, {
    id: "leg-rr",
    typeId: "frame.cube.1",
    targetBlockId: "hinge-rr",
    targetAnchorId: "rotor.xp",
    sourceAnchorId: "yp",
  });

  return g;
}

// ---------------------------------------------------------------------------
// 3. Spinner – hub with a rotating beam on top
// ---------------------------------------------------------------------------

function buildSpinner(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  g.addNode({
    id: "hub",
    typeId: "frame.cube.1",
    transform: { position: vec3(0, 2, 0), rotation: QUAT_IDENTITY },
  });

  // Hinge on top of hub
  snapBlock(g, catalog, {
    id: "hinge",
    typeId: "joint.hinge.small",
    targetBlockId: "hub",
    targetAnchorId: "yp",
    sourceAnchorId: "base.xn",
  });

  // Long beam on rotor
  snapBlock(g, catalog, {
    id: "arm",
    typeId: "frame.beam.5x1",
    targetBlockId: "hinge",
    targetAnchorId: "rotor.xp",
    sourceAnchorId: "yn",
  });

  return g;
}

// ---------------------------------------------------------------------------
// 4. Thruster Rocket – cube with thruster on bottom
// ---------------------------------------------------------------------------

function buildRocket(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  g.addNode({
    id: "body",
    typeId: "frame.cube.1",
    transform: { position: vec3(0, 2, 0), rotation: QUAT_IDENTITY },
  });

  // Corrected thruster on bottom (force pushes opposite to exhaust)
  snapBlock(g, catalog, {
    id: "thruster",
    typeId: "utility.thruster.up",
    targetBlockId: "body",
    targetAnchorId: "yn",
    sourceAnchorId: "mount",
  });

  return g;
}

// ---------------------------------------------------------------------------
// 5. Simple House – floor, 4 walls (one with a door), roof
//
// Demonstrates structures (static buildings) and compound machines (the
// wall-with-door block has a frame + hinged door that swings freely).
// ---------------------------------------------------------------------------

function buildHouse(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  // Floor sits just above the ground
  g.addNode({
    id: "floor",
    typeId: "structure.floor.4x4",
    transform: { position: vec3(0, 0.1, 0), rotation: QUAT_IDENTITY },
  });

  // Wall on +X edge
  snapBlock(g, catalog, {
    id: "wall-xp",
    typeId: "structure.wall.4x3",
    targetBlockId: "floor",
    targetAnchorId: "edge.xp",
    sourceAnchorId: "bottom",
  });

  // Wall on -X edge
  snapBlock(g, catalog, {
    id: "wall-xn",
    typeId: "structure.wall.4x3",
    targetBlockId: "floor",
    targetAnchorId: "edge.xn",
    sourceAnchorId: "bottom",
  });

  // Wall on -Z edge
  snapBlock(g, catalog, {
    id: "wall-zn",
    typeId: "structure.wall.4x3",
    targetBlockId: "floor",
    targetAnchorId: "edge.zn",
    sourceAnchorId: "bottom",
  });

  // Wall with door on +Z edge
  snapBlock(g, catalog, {
    id: "wall-door",
    typeId: "structure.wall-door.4x3",
    targetBlockId: "floor",
    targetAnchorId: "edge.zp",
    sourceAnchorId: "bottom",
  });

  // Roof snaps to the top of one wall
  snapBlock(g, catalog, {
    id: "roof",
    typeId: "structure.roof.4x4",
    targetBlockId: "wall-xp",
    targetAnchorId: "top",
    sourceAnchorId: "edge.xp",
  });

  return g;
}

// ---------------------------------------------------------------------------
// Export gallery
// ---------------------------------------------------------------------------

export const MACHINE_PRESETS: MachinePreset[] = [
  {
    name: "4-Wheel Car",
    description: "A beam chassis with 4 motor wheels. Wheels extend below chassis.",
    build: buildCar,
    autoInput: { motorSpin: 1 },
    cameraPosition: [8, 5, 8],
  },
  {
    name: "Hinged Walker",
    description: "A wide body with 4 hinged legs driven by motors.",
    build: buildWalker,
    autoInput: { hingeSpin: 3 },
    cameraPosition: [6, 4, 6],
  },
  {
    name: "Spinner",
    description: "A hub with a spinning beam arm on top.",
    build: buildSpinner,
    autoInput: { hingeSpin: 1 },
    cameraPosition: [5, 4, 5],
  },
  {
    name: "Thruster Rocket",
    description: "A cube with a thruster. Fires automatically!",
    build: buildRocket,
    autoInput: { throttle: 1 },
    cameraPosition: [4, 3, 5],
  },
  {
    name: "Simple House",
    description: "A floor, 4 walls (one with a hinged door), and a roof. Demonstrates structures and compound machines.",
    build: buildHouse,
    autoInput: {},
    cameraPosition: [10, 6, 10],
  },
];
