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

// -- Theo Jansen linkage dimensions (from crashcat HingeMotor demo) ----------
//
// These source values define the entire linkage geometry. Bar angles and
// positions are solved analytically at build time from these inputs.

const WALKER_CHASSIS_Y = 5.5;     // chassis center height
const X_UFL   = -2;               // chassis anchor: upper-front-leg pivot
const X_CRANK = -5;               // chassis anchor: crank motor pivot
const X_BACK  =  5;               // chassis anchor: back-leg pivot
const UPPER_HALF = 1.5;           // upper bar half-length (center to yn/yp)
const CRANK_HALF = 0.5;           // crank bar half-length
const LEG_UPPER  = 2.5;           // leg bar center-to-upper-anchor distance
const HORIZ_HALF = 5.0;           // horizontal bar half-length

/**
 * Solve the system `a·sin(α) - b·sin(β) = d, a·cos(α) - b·cos(β) = e`
 * for angles α and β. Returns the solution where legs point downward
 * (the walking configuration). `signHint` selects between the two solutions:
 * +1 for the front linkage, -1 for the rear linkage.
 */
function solveLinkageAngles(
  a: number, b: number, d: number, e: number, signHint: 1 | -1,
): [number, number] {
  // From squaring and adding: a² + b² - 2ab·cos(δ) = d² + e²
  const cosδ = (a * a + b * b - d * d - e * e) / (2 * a * b);
  const δ = signHint * Math.acos(cosδ);

  // Substituting β = α - δ and solving for α:
  const P = a - b * Math.cos(δ);
  const Q = b * Math.sin(δ);
  const α = Math.atan2(d * P - Q * e, e * P + Q * d);
  const β = α - δ;
  return [α, β];
}

/**
 * Compute all bar positions and rotations for one side of the walker.
 * The crank starts pointing straight down (θ = 0). All other angles are
 * derived from the closed-loop constraints at hinges H6 and H7.
 */
function solveWalkerLinkage(chassisY: number) {
  const crankLen = CRANK_HALF * 2;

  // System 1 — upper bar (θ_u) and front leg (θ_f):
  // Constraint at H6 (upper.yp = frontLeg.upper):
  //   2·upperHalf·sin(θ_u) - legUpper·sin(θ_f) = xUfl - xCrank
  //   2·upperHalf·cos(θ_u) - legUpper·cos(θ_f) = -crankLen
  const [θ_u, θ_f] = solveLinkageAngles(
    2 * UPPER_HALF, LEG_UPPER,
    X_UFL - X_CRANK, -crankLen,
    1,
  );

  // System 2 — horiz bar (θ_h) and back leg (θ_b):
  // Constraint at H7 (backLeg.upper = horiz.yp):
  //   2·horizHalf·sin(θ_h) - legUpper·sin(θ_b) = xCrank - xBack
  //   2·horizHalf·cos(θ_h) - legUpper·cos(θ_b) = crankLen
  const [θ_h, θ_b] = solveLinkageAngles(
    2 * HORIZ_HALF, LEG_UPPER,
    X_CRANK - X_BACK, crankLen,
    -1,
  );

  // Bar centers derived from hinge constraints.
  // For a bar at angle θ, local anchor (0, ly) → world (cx - ly·sin(θ), cy + ly·cos(θ)).
  // We pin one anchor to a known hinge and solve for the bar center.

  const crank  = { x: X_CRANK, y: chassisY - CRANK_HALF, θ: 0 };
  const fleg   = { x: X_CRANK, y: chassisY - crankLen,   θ: θ_f };
  // Upper: yn pinned at (X_UFL, chassisY)
  const upper  = {
    x: X_UFL - UPPER_HALF * Math.sin(θ_u),
    y: chassisY + UPPER_HALF * Math.cos(θ_u),
    θ: θ_u,
  };
  const bleg   = { x: X_BACK, y: chassisY, θ: θ_b };
  // Horiz: yn pinned at front leg center (X_CRANK, chassisY - crankLen)
  const hbar   = {
    x: X_CRANK - HORIZ_HALF * Math.sin(θ_h),
    y: (chassisY - crankLen) + HORIZ_HALF * Math.cos(θ_h),
    θ: θ_h,
  };

  // Triangulation hinge positions (where the two connected bars meet)
  const h6 = {
    x: upper.x - UPPER_HALF * Math.sin(θ_u),
    y: upper.y + UPPER_HALF * Math.cos(θ_u),
  };
  const h7 = {
    x: bleg.x - LEG_UPPER * Math.sin(θ_b),
    y: bleg.y + LEG_UPPER * Math.cos(θ_b),
  };

  return { crank, upper, fleg, hbar, bleg, h6, h7 };
}

const LINKAGE = solveWalkerLinkage(WALKER_CHASSIS_Y);

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
  const Y = WALKER_CHASSIS_Y;
  const L = LINKAGE;
  const crankLen = CRANK_HALF * 2;

  const rot = (θ: number) => θ === 0 ? QUAT_IDENTITY : quatFromAxisAngle(VEC3_Z, θ);

  // --- Structural bars (positions and rotations from linkage solver) ---
  g.addNode({ id: `${prefix}-upper`, typeId: "walker.bar.upper",
    transform: { position: vec3(L.upper.x, L.upper.y, legZ), rotation: rot(L.upper.θ) } });
  g.addNode({ id: `${prefix}-crank`, typeId: "walker.bar.crank",
    transform: { position: vec3(L.crank.x, L.crank.y, legZ), rotation: rot(L.crank.θ) } });
  g.addNode({ id: `${prefix}-fleg`, typeId: "walker.bar.leg",
    transform: { position: vec3(L.fleg.x, L.fleg.y, legZ), rotation: rot(L.fleg.θ) } });
  g.addNode({ id: `${prefix}-hbar`, typeId: "walker.bar.horiz",
    transform: { position: vec3(L.hbar.x, L.hbar.y, legZ), rotation: rot(L.hbar.θ) } });
  g.addNode({ id: `${prefix}-bleg`, typeId: "walker.bar.leg",
    transform: { position: vec3(L.bleg.x, L.bleg.y, legZ), rotation: rot(L.bleg.θ) } });

  // --- Hinge blocks at pivot positions ---
  g.addNode({ id: `${prefix}-h1`, typeId: "walker.pivot",
    transform: { position: vec3(X_UFL, Y, legZ), rotation: QUAT_IDENTITY } });
  g.addNode({ id: `${prefix}-h2`, typeId: "walker.motor",
    transform: { position: vec3(X_CRANK, Y, legZ), rotation: QUAT_IDENTITY } });
  g.addNode({ id: `${prefix}-h3`, typeId: "walker.pivot",
    transform: { position: vec3(X_CRANK, Y - crankLen, legZ), rotation: QUAT_IDENTITY } });
  g.addNode({ id: `${prefix}-h4`, typeId: "walker.pivot",
    transform: { position: vec3(X_CRANK, Y - crankLen, legZ), rotation: QUAT_IDENTITY } });
  g.addNode({ id: `${prefix}-h5`, typeId: "walker.pivot",
    transform: { position: vec3(X_BACK, Y, legZ), rotation: QUAT_IDENTITY } });
  g.addNode({ id: `${prefix}-h6`, typeId: "walker.pivot",
    transform: { position: vec3(L.h6.x, L.h6.y, legZ), rotation: QUAT_IDENTITY } });
  g.addNode({ id: `${prefix}-h7`, typeId: "walker.pivot",
    transform: { position: vec3(L.h7.x, L.h7.y, legZ), rotation: QUAT_IDENTITY } });

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
    transform: { position: vec3(0, WALKER_CHASSIS_Y, 0), rotation: QUAT_IDENTITY },
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
