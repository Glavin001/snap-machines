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
  quatFromAxisAngle,
  VEC3_Z,
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
// 2. Hinged Walker – Theo Jansen Linkage
//
// A Theo Jansen walking machine: central chassis with a crank-driven planar
// linkage on each side (+Z and -Z). Each leg set has 5 bar bodies connected
// by 7 revolute joints (all Z-axis). A motor on the crank drives the single
// DOF of the closed-loop linkage, producing a smooth walking gait.
//
// Ported from the crashcat HingeMotor demo dimensions.
// ---------------------------------------------------------------------------

/** Shorthand for adding a structural connection */
function connectBlocks(
  g: BlockGraph,
  blockA: string, anchorA: string,
  blockB: string, anchorB: string,
): void {
  g.addConnection({
    a: { blockId: blockA, anchorId: anchorA },
    b: { blockId: blockB, anchorId: anchorB },
  });
}

/**
 * Create one set of Theo Jansen legs on one side of the chassis.
 *
 * Topology (5 bodies, 7 hinge joints):
 *   chassis ─H1─ upperFrontLeg ─H6─ frontLeg ─H4─ horizontalBar
 *   chassis ─H2─ crank ─────────H3─ frontLeg       │
 *   chassis ─H5─ backLeg ───────H7──────────────────┘
 *
 * H2 is the motor-driven crank hinge; all others are passive.
 */
function createWalkerLegSet(
  g: BlockGraph,
  prefix: string,
  legZ: number,
): void {
  // Chassis center Y (above ground at Y=0)
  const Y = 5.5;

  // Bar rotations computed from closed-loop linkage constraint equations.
  // These ensure all hinge pivot points are consistent at t=0.
  const upperRot = quatFromAxisAngle(VEC3_Z, 1.05863513);   // ~60.7°
  const crankRot = QUAT_IDENTITY;                            // straight down
  const flegRot  = quatFromAxisAngle(VEC3_Z, -0.15459009);  // ~-8.9°
  const hbarRot  = quatFromAxisAngle(VEC3_Z, -1.22114806);  // ~-70.0°
  const blegRot  = quatFromAxisAngle(VEC3_Z, 0.24445437);   // ~14.0°

  // --- Structural bar positions (centers derived from constraint equations) ---
  g.addNode({ id: `${prefix}-upper`, typeId: "walker.bar.upper",
    transform: { position: vec3(-3.307531, Y + 0.735093, legZ), rotation: upperRot } });
  g.addNode({ id: `${prefix}-crank`, typeId: "walker.bar.crank",
    transform: { position: vec3(-5, Y - 0.5, legZ), rotation: crankRot } });
  g.addNode({ id: `${prefix}-fleg`, typeId: "walker.bar.leg",
    transform: { position: vec3(-5, Y - 1, legZ), rotation: flegRot } });
  g.addNode({ id: `${prefix}-hbar`, typeId: "walker.bar.horiz",
    transform: { position: vec3(-0.302534, Y + 0.712837, legZ), rotation: hbarRot } });
  g.addNode({ id: `${prefix}-bleg`, typeId: "walker.bar.leg",
    transform: { position: vec3(5, Y, legZ), rotation: blegRot } });

  // --- Hinge blocks at exact pivot positions ---
  g.addNode({ id: `${prefix}-h1`, typeId: "walker.pivot",
    transform: { position: vec3(-2, Y, legZ), rotation: QUAT_IDENTITY } });
  g.addNode({ id: `${prefix}-h2`, typeId: "walker.motor",
    transform: { position: vec3(-5, Y, legZ), rotation: QUAT_IDENTITY } });
  g.addNode({ id: `${prefix}-h3`, typeId: "walker.pivot",
    transform: { position: vec3(-5, Y - 1, legZ), rotation: QUAT_IDENTITY } });
  g.addNode({ id: `${prefix}-h4`, typeId: "walker.pivot",
    transform: { position: vec3(-5, Y - 1, legZ), rotation: QUAT_IDENTITY } });
  g.addNode({ id: `${prefix}-h5`, typeId: "walker.pivot",
    transform: { position: vec3(5, Y, legZ), rotation: QUAT_IDENTITY } });
  g.addNode({ id: `${prefix}-h6`, typeId: "walker.pivot",
    transform: { position: vec3(-4.615062, Y + 1.470187, legZ), rotation: QUAT_IDENTITY } });
  g.addNode({ id: `${prefix}-h7`, typeId: "walker.pivot",
    transform: { position: vec3(4.394933, Y + 2.425674, legZ), rotation: QUAT_IDENTITY } });

  // --- Structural connections (determines rigid body merging) ---
  const side = legZ > 0 ? "r" : "l";

  // H1: chassis ↔ upperFrontLeg
  connectBlocks(g, "chassis", `${side}.ufl`, `${prefix}-h1`, "base.mount");
  connectBlocks(g, `${prefix}-h1`, "rotor.mount", `${prefix}-upper`, "yn");

  // H2: chassis ↔ crank (MOTOR)
  connectBlocks(g, "chassis", `${side}.crank`, `${prefix}-h2`, "base.mount");
  connectBlocks(g, `${prefix}-h2`, "rotor.mount", `${prefix}-crank`, "yp");

  // H3: crank ↔ frontLeg
  connectBlocks(g, `${prefix}-crank`, "yn", `${prefix}-h3`, "base.mount");
  connectBlocks(g, `${prefix}-h3`, "rotor.mount", `${prefix}-fleg`, "center.a");

  // H4: frontLeg ↔ horizontalBar
  connectBlocks(g, `${prefix}-fleg`, "center.b", `${prefix}-h4`, "base.mount");
  connectBlocks(g, `${prefix}-h4`, "rotor.mount", `${prefix}-hbar`, "yn");

  // H5: chassis ↔ backLeg
  connectBlocks(g, "chassis", `${side}.back`, `${prefix}-h5`, "base.mount");
  connectBlocks(g, `${prefix}-h5`, "rotor.mount", `${prefix}-bleg`, "center.a");

  // H6: upperFrontLeg ↔ frontLeg (triangulation)
  connectBlocks(g, `${prefix}-upper`, "yp", `${prefix}-h6`, "base.mount");
  connectBlocks(g, `${prefix}-h6`, "rotor.mount", `${prefix}-fleg`, "upper");

  // H7: backLeg ↔ horizontalBar (triangulation)
  connectBlocks(g, `${prefix}-bleg`, "upper", `${prefix}-h7`, "base.mount");
  connectBlocks(g, `${prefix}-h7`, "rotor.mount", `${prefix}-hbar`, "yp");
}

function buildWalker(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  // Central chassis body
  g.addNode({
    id: "chassis",
    typeId: "walker.chassis",
    transform: { position: vec3(0, 5.5, 0), rotation: QUAT_IDENTITY },
  });

  // Leg sets on both sides (chassisDepthHalf=3, partDepthHalf=0.15)
  const legZ = 3 + 0.15;
  createWalkerLegSet(g, "r", legZ);
  createWalkerLegSet(g, "l", -legZ);

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
    description: "A Theo Jansen linkage walking machine with motor-driven cranks.",
    build: buildWalker,
    autoInput: { hingeSpin: 1 },
    cameraPosition: [20, 12, 20],
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
