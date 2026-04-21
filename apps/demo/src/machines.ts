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
  VEC3_X,
  VEC3_Y,
  placeCompound,
  suspensionStrutTemplate,
} from "@snap-machines/core";

export interface MachinePreset {
  name: string;
  description: string;
  build(catalog: BlockCatalog): BlockGraph;
  autoInput: RuntimeInputState;
  cameraPosition: [number, number, number];
  /** Override gravity magnitude (default: 9.81). Crashcat walker uses 40. */
  gravity?: number;
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
 * for angles α and β. Returns [α, β].
 */
function solveLinkagePair(
  a: number, b: number, d: number, e: number, sign: 1 | -1,
): [number, number] {
  // From squaring and adding: a² + b² - 2ab·cos(δ) = d² + e²
  const cosδ = Math.max(-1, Math.min(1, (a * a + b * b - d * d - e * e) / (2 * a * b)));
  const δ = sign * Math.acos(cosδ);

  // Substituting β = α - δ and solving for α:
  const P = a - b * Math.cos(δ);
  const Q = b * Math.sin(δ);
  const α = Math.atan2(d * P - Q * e, e * P + Q * d);
  const β = α - δ;
  return [α, β];
}

/**
 * Solve a linkage pair and pick the solution where the leg foot points
 * downward (lower Y = walking configuration). Tries both sign variants
 * and picks the one with the lower leg foot.
 */
function solveLinkageAngles(
  a: number, b: number, d: number, e: number,
  legCenterY: number, legHalf: number,
): [number, number] {
  const [α1, β1] = solveLinkagePair(a, b, d, e, 1);
  const [α2, β2] = solveLinkagePair(a, b, d, e, -1);
  // β is the leg angle; foot at local y = -legHalf maps to world y = centerY - legHalf·cos(β)
  const footY1 = legCenterY - legHalf * Math.cos(β1);
  const footY2 = legCenterY - legHalf * Math.cos(β2);
  return footY1 < footY2 ? [α1, β1] : [α2, β2];
}

/**
 * Compute all bar positions and rotations for one side of the walker.
 * `phi` is the crank starting angle (0 = pointing down, π = pointing up).
 * Using different phi values for each side creates a phase-offset gait.
 */
function solveWalkerLinkage(chassisY: number, phi: number) {
  const crankLen = CRANK_HALF * 2;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);

  // Crank bottom position (where front leg center is pinned)
  const crankBottomX = X_CRANK + crankLen * sinPhi;
  const crankBottomY = chassisY - crankLen * cosPhi;

  // System 1 — upper bar (θ_u) and front leg (θ_f):
  // Constraint at H6 (upper.yp = frontLeg.upper)
  const [θ_u, θ_f] = solveLinkageAngles(
    2 * UPPER_HALF, LEG_UPPER,
    (X_UFL - X_CRANK) - crankLen * sinPhi,
    -crankLen * cosPhi,
    crankBottomY, 3, // leg half-length = 3 (6-unit bar)
  );

  // System 2 — horiz bar (θ_h) and back leg (θ_b):
  // Constraint at H7 (backLeg.upper = horiz.yp)
  const [θ_h, θ_b] = solveLinkageAngles(
    2 * HORIZ_HALF, LEG_UPPER,
    (X_CRANK - X_BACK) + crankLen * sinPhi,
    crankLen * cosPhi,
    chassisY, 3, // back leg center at chassisY
  );

  // Bar centers derived from hinge constraints.
  // For a bar at angle θ, local anchor (0, ly) → world (cx - ly·sin(θ), cy + ly·cos(θ)).

  const crank = {
    x: X_CRANK + CRANK_HALF * sinPhi,
    y: chassisY - CRANK_HALF * cosPhi,
    θ: phi,
  };
  const fleg = { x: crankBottomX, y: crankBottomY, θ: θ_f };
  // Upper: yn pinned at (X_UFL, chassisY)
  const upper = {
    x: X_UFL - UPPER_HALF * Math.sin(θ_u),
    y: chassisY + UPPER_HALF * Math.cos(θ_u),
    θ: θ_u,
  };
  const bleg = { x: X_BACK, y: chassisY, θ: θ_b };
  // Horiz: yn pinned at front leg center (crank bottom)
  const hbar = {
    x: crankBottomX - HORIZ_HALF * Math.sin(θ_h),
    y: crankBottomY + HORIZ_HALF * Math.cos(θ_h),
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
  L: ReturnType<typeof solveWalkerLinkage>,
): void {
  const Y = WALKER_CHASSIS_Y;

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
    transform: { position: vec3(L.fleg.x, L.fleg.y, legZ), rotation: QUAT_IDENTITY } });
  g.addNode({ id: `${prefix}-h4`, typeId: "walker.pivot",
    transform: { position: vec3(L.fleg.x, L.fleg.y, legZ), rotation: QUAT_IDENTITY } });
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

  // Leg sets on both sides with 180° phase offset for alternating gait.
  // Right side: crank starts pointing down (φ=0, pushing phase)
  // Left side:  crank starts pointing up (φ=π, lifting phase)
  const legZ = 3 + 0.15;
  const linkageR = solveWalkerLinkage(WALKER_CHASSIS_Y, 0);
  const linkageL = solveWalkerLinkage(WALKER_CHASSIS_Y, Math.PI);
  createWalkerLegSet(g, "r", legZ, linkageR);
  createWalkerLegSet(g, "l", -legZ, linkageL);

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
// 6. Plane — Fuselage + Wings + Propeller + Control Surfaces
// ---------------------------------------------------------------------------

function buildPlane(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  // Fuselage — long beam
  g.addNode({
    id: "fuselage",
    typeId: "frame.beam.5x1",
    transform: { position: vec3(0, 3, 0), rotation: QUAT_IDENTITY },
  });

  // Wings — plates on left and right
  snapBlock(g, catalog, {
    id: "wing-l",
    typeId: "primitive.plate.2x1",
    targetBlockId: "fuselage",
    targetAnchorId: "zp",
    sourceAnchorId: "zn",
  });

  snapBlock(g, catalog, {
    id: "wing-r",
    typeId: "primitive.plate.2x1",
    targetBlockId: "fuselage",
    targetAnchorId: "zn",
    sourceAnchorId: "zp",
  });

  // Propeller on the front (+X)
  snapBlock(g, catalog, {
    id: "propeller",
    typeId: "compound.propeller",
    targetBlockId: "fuselage",
    targetAnchorId: "xp",
    sourceAnchorId: "hub.attach",
  });

  // Elevator (control surface on rear top)
  snapBlock(g, catalog, {
    id: "elevator",
    typeId: "compound.flap",
    targetBlockId: "fuselage",
    targetAnchorId: "yp.l",
    sourceAnchorId: "mount.attach",
  });

  // Rudder (control surface on rear, vertical — on top of fuselage at back)
  snapBlock(g, catalog, {
    id: "rudder",
    typeId: "compound.flap",
    targetBlockId: "fuselage",
    targetAnchorId: "yp.r",
    sourceAnchorId: "mount.attach",
  });

  // Thruster on the back for jet-assist
  snapBlock(g, catalog, {
    id: "jet",
    typeId: "compound.jet",
    targetBlockId: "fuselage",
    targetAnchorId: "xn",
    sourceAnchorId: "intake",
  });

  return g;
}

// ---------------------------------------------------------------------------
// 7. Crane — Base + Yaw Arm + Pitch Arm + Gripper
// ---------------------------------------------------------------------------

function buildCrane(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  // Cross-shaped base for stability: main beam + two perpendicular beams
  g.addNode({
    id: "base",
    typeId: "frame.beam.5x1",
    transform: { position: vec3(0, 1, 0), rotation: QUAT_IDENTITY },
  });

  // Perpendicular beam on +Z side (forms the cross)
  snapBlock(g, catalog, {
    id: "base-zp",
    typeId: "frame.beam.5x1",
    targetBlockId: "base",
    targetAnchorId: "zp",
    sourceAnchorId: "zn",
  });

  // Perpendicular beam on -Z side
  snapBlock(g, catalog, {
    id: "base-zn",
    typeId: "frame.beam.5x1",
    targetBlockId: "base",
    targetAnchorId: "zn",
    sourceAnchorId: "zp",
  });

  // Yaw arm on top of base — rotates around Y axis
  snapBlock(g, catalog, {
    id: "yaw",
    typeId: "compound.arm.yaw",
    targetBlockId: "base",
    targetAnchorId: "yp",
    sourceAnchorId: "base.attach",
  });

  // Pitch arm on top of yaw turret — tilts up/down
  snapBlock(g, catalog, {
    id: "pitch",
    typeId: "compound.arm",
    targetBlockId: "yaw",
    targetAnchorId: "turret.top",
    sourceAnchorId: "mount.attach",
  });

  // Second pitch arm at the tip of the first
  snapBlock(g, catalog, {
    id: "pitch2",
    typeId: "compound.arm",
    targetBlockId: "pitch",
    targetAnchorId: "link.tip",
    sourceAnchorId: "mount.attach",
  });

  // Small block as the gripper "palm" at the end
  snapBlock(g, catalog, {
    id: "grip-block",
    typeId: "primitive.block.1x1",
    targetBlockId: "pitch2",
    targetAnchorId: "link.tip",
    sourceAnchorId: "yn",
  });

  return g;
}

// ---------------------------------------------------------------------------
// 8. Helicopter (Quad-Thruster) — Fuselage + 4 thrusters
// ---------------------------------------------------------------------------

function buildHelicopter(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  // Central fuselage
  g.addNode({
    id: "fuselage",
    typeId: "frame.plank.3x1",
    transform: { position: vec3(0, 3, 0), rotation: QUAT_IDENTITY },
  });

  // Cross beam for thruster mounts
  snapBlock(g, catalog, {
    id: "crossbeam",
    typeId: "frame.plank.3x1",
    targetBlockId: "fuselage",
    targetAnchorId: "zp",
    sourceAnchorId: "xn",
  });

  // 4 thrusters — one at each end of the cross
  snapBlock(g, catalog, {
    id: "thruster-fl",
    typeId: "utility.thruster.up",
    targetBlockId: "fuselage",
    targetAnchorId: "yn.l",
    sourceAnchorId: "mount",
  });

  snapBlock(g, catalog, {
    id: "thruster-fr",
    typeId: "utility.thruster.up",
    targetBlockId: "fuselage",
    targetAnchorId: "yn.r",
    sourceAnchorId: "mount",
  });

  snapBlock(g, catalog, {
    id: "thruster-bl",
    typeId: "utility.thruster.up",
    targetBlockId: "crossbeam",
    targetAnchorId: "yn.l",
    sourceAnchorId: "mount",
  });

  snapBlock(g, catalog, {
    id: "thruster-br",
    typeId: "utility.thruster.up",
    targetBlockId: "crossbeam",
    targetAnchorId: "yn.r",
    sourceAnchorId: "mount",
  });

  return g;
}

// ---------------------------------------------------------------------------
// 9. Suspended Car — Chassis with shock absorbers + wheels
// ---------------------------------------------------------------------------

function buildSuspendedCar(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  // Chassis beam
  g.addNode({
    id: "chassis",
    typeId: "frame.beam.5x1",
    transform: { position: vec3(0, 2.5, 0), rotation: QUAT_IDENTITY },
  });

  // 4 suspension struts using the compound template system
  placeCompound(g, catalog, suspensionStrutTemplate, "chassis", "zp.l", "fl/");
  placeCompound(g, catalog, suspensionStrutTemplate, "chassis", "zp.r", "fr/");
  placeCompound(g, catalog, suspensionStrutTemplate, "chassis", "zn.l", "rl/");
  placeCompound(g, catalog, suspensionStrutTemplate, "chassis", "zn.r", "rr/");

  return g;
}

// ---------------------------------------------------------------------------
// 10. Dune Buggy — Full-width 4-post roll cage on twin-beam chassis
//
// Baja-style off-road buggy. Built from ~25 small connected pieces to approach
// the look of real tubular space-frames:
//
//   • Twin parallel 5x1 chassis beams at z=±1, joined by 3 cross-braces.
//     Having two beams gives the cage four proper corner-top anchors instead
//     of a single centreline one.
//   • 4 independent suspension struts extend outboard from the beams' inner
//     Z faces, so the wheels sit clear of the chassis with horizontal axles.
//   • Full 4-post roll cage: 4 pillars, 2 long side rails, 2 front/rear
//     hoops, 3 roof cross-members, 4 corner top cubes, 4 bottom junctions.
//
// All cage pieces are structural primitives (`primitive.block.1x1`,
// `primitive.block.2x1`, `frame.plank.3x1`). Every anchor-to-anchor
// connection is coincident in world space, so `compileMachinePlan` merges
// the entire cage + chassis into a single compound rigid body.
// ---------------------------------------------------------------------------

function buildDuneBuggy(catalog: BlockCatalog): BlockGraph {
  const g = new BlockGraph();

  // -- Chassis ---------------------------------------------------------------
  // Two parallel 5x1 beams at z=-1 and z=+1 (1-unit gap between them), joined
  // by three 1x1 cross-braces at x = -2, 0, +2 in that gap. Each beam is 1
  // unit tall and wide; the two beams together span z=[-1.5, +1.5], a
  // 3-unit-wide chassis — proper truck proportions.
  g.addNode({
    id: "chassis-l",
    typeId: "frame.beam.5x1",
    transform: { position: vec3(0, 2.5, -1), rotation: QUAT_IDENTITY },
  });
  g.addNode({
    id: "chassis-r",
    typeId: "frame.beam.5x1",
    transform: { position: vec3(0, 2.5, 1), rotation: QUAT_IDENTITY },
  });

  // Cross-braces between the two beams at front, middle, rear.
  g.addNode({
    id: "cross-f",
    typeId: "primitive.block.1x1",
    transform: { position: vec3(-2, 2.5, 0), rotation: QUAT_IDENTITY },
  });
  g.addNode({
    id: "cross-m",
    typeId: "primitive.block.1x1",
    transform: { position: vec3(0, 2.5, 0), rotation: QUAT_IDENTITY },
  });
  g.addNode({
    id: "cross-r",
    typeId: "primitive.block.1x1",
    transform: { position: vec3(2, 2.5, 0), rotation: QUAT_IDENTITY },
  });
  // Weld each cross-brace between the beams' inner Z faces.
  connectBlocks(g, "chassis-l", "zp.l", "cross-f", "zn");
  connectBlocks(g, "chassis-r", "zn.l", "cross-f", "zp");
  connectBlocks(g, "chassis-l", "zp",   "cross-m", "zn");
  connectBlocks(g, "chassis-r", "zn",   "cross-m", "zp");
  connectBlocks(g, "chassis-l", "zp.r", "cross-r", "zn");
  connectBlocks(g, "chassis-r", "zn.r", "cross-r", "zp");

  // -- Suspension ------------------------------------------------------------
  // 4 independent struts. Mount points are on each beam's INNER Z face (zp on
  // chassis-l, zn on chassis-r) so the shocks extend OUTWARD in world Z and
  // the wheel axles end up horizontal (verified: axle +Z = world ±Z).
  placeCompound(g, catalog, suspensionStrutTemplate, "chassis-l", "zn.l", "fl/");
  placeCompound(g, catalog, suspensionStrutTemplate, "chassis-l", "zn.r", "rl/");
  placeCompound(g, catalog, suspensionStrutTemplate, "chassis-r", "zp.l", "fr/");
  placeCompound(g, catalog, suspensionStrutTemplate, "chassis-r", "zp.r", "rr/");

  // -- Roll cage ------------------------------------------------------------
  // Four-post layout. The two beams' top-face endpoint anchors (yp.l/yp.r on
  // each beam, at world (±2, 3, ±1)) anchor the 4 corner junctions and 4
  // pillars. Roof rails run along X above each beam; front and rear hoops run
  // along Z between opposite pillars; three short roof cross-members tie the
  // two side rails together across Z.
  //
  // Layout in 3D (looking down -Y onto the roof, +X to the right, +Z out of page):
  //
  //   top-fl─────rail-l────────top-rl     z=-1 (left side roof)
  //     │                         │
  //   end-rail-f     +          end-rail-r
  //     │                         │
  //   top-fr─────rail-r────────top-rr     z=+1 (right side roof)
  //
  //   (roof cross-members at z=0 tie rail-l and rail-r at x=-1, 0, +1)

  const vertical = quatFromAxisAngle(VEC3_Z, Math.PI / 2);

  // 4 bottom junction cubes on top of each beam corner.
  snapBlock(g, catalog, {
    id: "jct-fl", typeId: "primitive.block.1x1",
    targetBlockId: "chassis-l", targetAnchorId: "yp.l", sourceAnchorId: "yn",
  });
  snapBlock(g, catalog, {
    id: "jct-rl", typeId: "primitive.block.1x1",
    targetBlockId: "chassis-l", targetAnchorId: "yp.r", sourceAnchorId: "yn",
  });
  snapBlock(g, catalog, {
    id: "jct-fr", typeId: "primitive.block.1x1",
    targetBlockId: "chassis-r", targetAnchorId: "yp.l", sourceAnchorId: "yn",
  });
  snapBlock(g, catalog, {
    id: "jct-rr", typeId: "primitive.block.1x1",
    targetBlockId: "chassis-r", targetAnchorId: "yp.r", sourceAnchorId: "yn",
  });

  // 4 vertical pillars at chassis-top corners. 2x1 blocks rotated +π/2 around
  // Z so their local +X axis points up; centre at y=5 so xn meets the
  // junction's yp (y=4) and xp meets the corner-cube yn (y=6).
  for (const [id, x, z] of [
    ["pillar-fl", -2, -1],
    ["pillar-rl",  2, -1],
    ["pillar-fr", -2,  1],
    ["pillar-rr",  2,  1],
  ] as const) {
    g.addNode({
      id,
      typeId: "primitive.block.2x1",
      transform: { position: vec3(x, 5, z), rotation: vertical },
    });
  }
  connectBlocks(g, "jct-fl", "yp", "pillar-fl", "xn");
  connectBlocks(g, "jct-rl", "yp", "pillar-rl", "xn");
  connectBlocks(g, "jct-fr", "yp", "pillar-fr", "xn");
  connectBlocks(g, "jct-rr", "yp", "pillar-rr", "xn");

  // 4 corner cubes at the top of each pillar (y=6.5).
  for (const [id, x, z] of [
    ["top-fl", -2, -1],
    ["top-rl",  2, -1],
    ["top-fr", -2,  1],
    ["top-rr",  2,  1],
  ] as const) {
    g.addNode({
      id,
      typeId: "primitive.block.1x1",
      transform: { position: vec3(x, 6.5, z), rotation: QUAT_IDENTITY },
    });
  }
  connectBlocks(g, "pillar-fl", "xp", "top-fl", "yn");
  connectBlocks(g, "pillar-rl", "xp", "top-rl", "yn");
  connectBlocks(g, "pillar-fr", "xp", "top-fr", "yn");
  connectBlocks(g, "pillar-rr", "xp", "top-rr", "yn");

  // Two long side rails (3x1 planks) running along X between the front/rear
  // top cubes. Rail at z=-1 connects top-fl.xp ↔ top-rl.xn (span x=-1.5..1.5).
  g.addNode({
    id: "rail-l",
    typeId: "frame.plank.3x1",
    transform: { position: vec3(0, 6.5, -1), rotation: QUAT_IDENTITY },
  });
  g.addNode({
    id: "rail-r",
    typeId: "frame.plank.3x1",
    transform: { position: vec3(0, 6.5, 1), rotation: QUAT_IDENTITY },
  });
  connectBlocks(g, "top-fl", "xp", "rail-l", "xn");
  connectBlocks(g, "rail-l", "xp", "top-rl", "xn");
  connectBlocks(g, "top-fr", "xp", "rail-r", "xn");
  connectBlocks(g, "rail-r", "xp", "top-rr", "xn");

  // Front and rear end-rails (1x1 cubes) between the left/right top corners.
  // The cubes' zn/zp faces meet the corner cubes' zp/zn faces at z=±0.5.
  g.addNode({
    id: "end-rail-f",
    typeId: "primitive.block.1x1",
    transform: { position: vec3(-2, 6.5, 0), rotation: QUAT_IDENTITY },
  });
  g.addNode({
    id: "end-rail-r",
    typeId: "primitive.block.1x1",
    transform: { position: vec3(2, 6.5, 0), rotation: QUAT_IDENTITY },
  });
  connectBlocks(g, "top-fl", "zp", "end-rail-f", "zn");
  connectBlocks(g, "end-rail-f", "zp", "top-fr", "zn");
  connectBlocks(g, "top-rl", "zp", "end-rail-r", "zn");
  connectBlocks(g, "end-rail-r", "zp", "top-rr", "zn");

  // Three roof cross-members (1x1 cubes) tying the two side rails together
  // at x=-1, 0, +1 (plank `zp` centerline anchor + `zp.l`/`zp.r` endpoint
  // anchors at x=±1).
  g.addNode({
    id: "roof-f",
    typeId: "primitive.block.1x1",
    transform: { position: vec3(-1, 6.5, 0), rotation: QUAT_IDENTITY },
  });
  g.addNode({
    id: "roof-m",
    typeId: "primitive.block.1x1",
    transform: { position: vec3(0, 6.5, 0), rotation: QUAT_IDENTITY },
  });
  g.addNode({
    id: "roof-r",
    typeId: "primitive.block.1x1",
    transform: { position: vec3(1, 6.5, 0), rotation: QUAT_IDENTITY },
  });
  connectBlocks(g, "rail-l", "zp.l", "roof-f", "zn");
  connectBlocks(g, "roof-f", "zp", "rail-r", "zn.l");
  connectBlocks(g, "rail-l", "zp",   "roof-m", "zn");
  connectBlocks(g, "roof-m", "zp",   "rail-r", "zn");
  connectBlocks(g, "rail-l", "zp.r", "roof-r", "zn");
  connectBlocks(g, "roof-r", "zp",   "rail-r", "zn.r");

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
    gravity: 40,  // crashcat reference uses gravity=40 for stable walking
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
  {
    name: "Plane",
    description: "A fuselage with wings, propeller, jet engine, and control surfaces.",
    build: buildPlane,
    autoInput: { throttle: 1, propellerSpin: 1 },
    cameraPosition: [10, 6, 10],
  },
  {
    name: "Crane",
    description: "A heavy base with yaw and pitch arm segments. Demonstrates robotic arm compounds.",
    build: buildCrane,
    autoInput: {},
    cameraPosition: [10, 8, 10],
  },
  {
    name: "Helicopter",
    description: "A cross-frame with 4 upward thrusters for VTOL flight.",
    build: buildHelicopter,
    autoInput: { throttle: 1 },
    cameraPosition: [8, 5, 8],
  },
  {
    name: "Suspended Car",
    description: "A beam chassis with 4 suspension struts (shock absorbers + wheels). Uses the compound template system.",
    build: buildSuspendedCar,
    autoInput: { motorSpin: 1 },
    cameraPosition: [10, 6, 10],
  },
  {
    name: "Dune Buggy",
    description: "Off-road buggy: twin-beam chassis with cross-braces, 4 independent suspension struts, and a 25-piece welded 4-post roll cage.",
    build: buildDuneBuggy,
    autoInput: { motorSpin: 1 },
    cameraPosition: [14, 8, 14],
  },
];
