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
  TRANSFORM_IDENTITY,
  QUAT_IDENTITY,
  vec3,
  transform,
  quatFromAxisAngle,
  RuntimeInputState,
  alignAnchorPair,
  getWorldAnchorTransform,
  NormalizedAnchorDefinition,
  Transform,
} from "snap-construction-system";

export interface MachinePreset {
  name: string;
  description: string;
  build(catalog: BlockCatalog): BlockGraph;
  autoInput: RuntimeInputState;
  cameraPosition: [number, number, number];
}

/**
 * Helper: place a new block so that `sourceAnchorId` on the new block aligns
 * with `targetAnchorId` on the existing `targetBlockId`.
 * Returns the new block's node id.
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
// ---------------------------------------------------------------------------

function buildCar(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  // Chassis: beam at height 2 (above ground at y=-0.5)
  g.addNode({
    id: "chassis",
    typeId: "frame.beam.5x1",
    transform: { position: vec3(0, 2, 0), rotation: QUAT_IDENTITY },
  });

  // 4 motor-wheels snapped to the Z-side anchors of the chassis
  snapBlock(g, catalog, {
    id: "fl-wheel",
    typeId: "joint.motor.wheel",
    targetBlockId: "chassis",
    targetAnchorId: "zp.l",
    sourceAnchorId: "axle.mount",
  });

  snapBlock(g, catalog, {
    id: "fr-wheel",
    typeId: "joint.motor.wheel",
    targetBlockId: "chassis",
    targetAnchorId: "zn.l",
    sourceAnchorId: "axle.mount",
  });

  snapBlock(g, catalog, {
    id: "rl-wheel",
    typeId: "joint.motor.wheel",
    targetBlockId: "chassis",
    targetAnchorId: "zp.r",
    sourceAnchorId: "axle.mount",
  });

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
// 2. Hinged Walker – a body with hinged legs
// ---------------------------------------------------------------------------

function buildWalker(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  // Central body plank at height 3
  g.addNode({
    id: "body",
    typeId: "frame.plank.3x1",
    transform: { position: vec3(0, 3, 0), rotation: QUAT_IDENTITY },
  });

  // Left front: hinge base connects to body's -Z left face, leg on rotor end
  snapBlock(g, catalog, {
    id: "hinge-lf",
    typeId: "joint.hinge.small",
    targetBlockId: "body",
    targetAnchorId: "zn.l",
    sourceAnchorId: "base.xn",
  });
  snapBlock(g, catalog, {
    id: "leg-lf",
    typeId: "frame.cube.1",
    targetBlockId: "hinge-lf",
    targetAnchorId: "rotor.xp",
    sourceAnchorId: "zp",
  });

  // Right front
  snapBlock(g, catalog, {
    id: "hinge-rf",
    typeId: "joint.hinge.small",
    targetBlockId: "body",
    targetAnchorId: "zp.l",
    sourceAnchorId: "base.xn",
  });
  snapBlock(g, catalog, {
    id: "leg-rf",
    typeId: "frame.cube.1",
    targetBlockId: "hinge-rf",
    targetAnchorId: "rotor.xp",
    sourceAnchorId: "zn",
  });

  // Left rear
  snapBlock(g, catalog, {
    id: "hinge-lr",
    typeId: "joint.hinge.small",
    targetBlockId: "body",
    targetAnchorId: "zn.r",
    sourceAnchorId: "base.xn",
  });
  snapBlock(g, catalog, {
    id: "leg-lr",
    typeId: "frame.cube.1",
    targetBlockId: "hinge-lr",
    targetAnchorId: "rotor.xp",
    sourceAnchorId: "zp",
  });

  // Right rear
  snapBlock(g, catalog, {
    id: "hinge-rr",
    typeId: "joint.hinge.small",
    targetBlockId: "body",
    targetAnchorId: "zp.r",
    sourceAnchorId: "base.xn",
  });
  snapBlock(g, catalog, {
    id: "leg-rr",
    typeId: "frame.cube.1",
    targetBlockId: "hinge-rr",
    targetAnchorId: "rotor.xp",
    sourceAnchorId: "zn",
  });

  return g;
}

// ---------------------------------------------------------------------------
// 3. Spinner – hub with a rotating beam on top
// ---------------------------------------------------------------------------

function buildSpinner(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  // Hub
  g.addNode({
    id: "hub",
    typeId: "frame.cube.1",
    transform: { position: vec3(0, 2, 0), rotation: QUAT_IDENTITY },
  });

  // Hinge on top
  snapBlock(g, catalog, {
    id: "hinge",
    typeId: "joint.hinge.small",
    targetBlockId: "hub",
    targetAnchorId: "yp",
    sourceAnchorId: "base.xn",
  });

  // Beam extending from rotor
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
// 4. Thruster Rocket
// ---------------------------------------------------------------------------

function buildRocket(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  // Body cube
  g.addNode({
    id: "body",
    typeId: "frame.cube.1",
    transform: { position: vec3(0, 2, 0), rotation: QUAT_IDENTITY },
  });

  // Thruster snapped to the bottom face
  snapBlock(g, catalog, {
    id: "thruster",
    typeId: "utility.thruster.small",
    targetBlockId: "body",
    targetAnchorId: "yn",
    sourceAnchorId: "mount",
  });

  return g;
}

// ---------------------------------------------------------------------------
// Export gallery
// ---------------------------------------------------------------------------

export const MACHINE_PRESETS: MachinePreset[] = [
  {
    name: "4-Wheel Car",
    description: "A beam chassis with 4 auto-spinning motor wheels.",
    build: buildCar,
    autoInput: { motorSpin: 1 },
    cameraPosition: [8, 5, 8],
  },
  {
    name: "Hinged Walker",
    description: "A body with 4 hinged legs that flail to walk.",
    build: buildWalker,
    autoInput: { hingeSpin: 1 },
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
];
