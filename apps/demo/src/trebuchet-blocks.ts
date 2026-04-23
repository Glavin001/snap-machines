/**
 * Trebuchet block definitions.
 *
 * Implements a gravity-powered trebuchet using 6 custom block types:
 *   trebuchet.frame        — fixed A-frame support structure
 *   trebuchet.pivot        — motorized Z-axis revolute joint (arm pivot)
 *   trebuchet.arm          — asymmetric throwing arm (3:6 from pivot)
 *   trebuchet.ball.joint   — passive spherical joint (used for CW + sling)
 *   trebuchet.counterweight — heavy hanging mass (80 kg)
 *   trebuchet.projectile   — the projectile sphere (5 kg)
 */
import { BlockDefinition } from "@snap-machines/core";
import { VEC3_Y, VEC3_Z, QUAT_IDENTITY, lookRotation, vec3, quatFromAxisAngle } from "@snap-machines/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function structAnchor(
  id: string,
  position: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  partId?: string,
) {
  return {
    id,
    ...(partId ? { partId } : {}),
    position,
    normal,
    orientation: lookRotation(normal, Math.abs(normal.y) > 0.99 ? VEC3_Z : VEC3_Y),
    type: "struct",
  } as const;
}

function jointAnchor(
  id: string,
  partId: string,
  position: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  polarity: "positive" | "negative",
) {
  return {
    id,
    partId,
    position,
    normal,
    orientation: lookRotation(normal, Math.abs(normal.y) > 0.99 ? VEC3_Z : VEC3_Y),
    type: "joint",
    polarity,
  } as const;
}

// ---------------------------------------------------------------------------
// 1. Trebuchet Frame — fixed A-frame support
//
// Uses rigidBodyKind: "fixed" so it never moves regardless of forces.
// Geometry approximates an A-frame: two angled legs, a base beam, a mid
// crossbar, and a top cap that positions the pivot point.
//
// Block origin at ground level (y=0). Pivot anchor at y=6 (world space
// when block is placed at origin).
// ---------------------------------------------------------------------------

export const trebuchetFrameBlock: BlockDefinition = {
  id: "trebuchet.frame",
  name: "Trebuchet Frame",
  category: "trebuchet",
  parts: [{ id: "body", rigidBodyKind: "fixed" }],
  geometry: [
    // Left angled leg
    {
      kind: "box",
      partId: "body",
      size: vec3(0.4, 6.5, 0.6),
      transform: { position: vec3(-2.0, 3.0, 0), rotation: quatFromAxisAngle(VEC3_Z, 0.32) },
    },
    // Right angled leg
    {
      kind: "box",
      partId: "body",
      size: vec3(0.4, 6.5, 0.6),
      transform: { position: vec3(2.0, 3.0, 0), rotation: quatFromAxisAngle(VEC3_Z, -0.32) },
    },
    // Base crossbeam
    {
      kind: "box",
      partId: "body",
      size: vec3(5.5, 0.4, 0.6),
      transform: { position: vec3(0, 0.2, 0), rotation: QUAT_IDENTITY },
    },
    // Mid crossbar (A crossbar for rigidity)
    {
      kind: "box",
      partId: "body",
      size: vec3(2.8, 0.35, 0.5),
      transform: { position: vec3(0, 2.6, 0), rotation: QUAT_IDENTITY },
    },
    // Top pivot cap
    {
      kind: "box",
      partId: "body",
      size: vec3(1.0, 0.5, 0.7),
      transform: { position: vec3(0, 5.85, 0), rotation: QUAT_IDENTITY },
    },
  ],
  colliders: [
    // Base
    {
      kind: "box",
      partId: "body",
      halfExtents: vec3(2.75, 0.2, 0.3),
      transform: { position: vec3(0, 0.2, 0), rotation: QUAT_IDENTITY },
    },
    // Left leg
    {
      kind: "box",
      partId: "body",
      halfExtents: vec3(0.2, 3.25, 0.3),
      transform: { position: vec3(-2.0, 3.0, 0), rotation: quatFromAxisAngle(VEC3_Z, 0.32) },
    },
    // Right leg
    {
      kind: "box",
      partId: "body",
      halfExtents: vec3(0.2, 3.25, 0.3),
      transform: { position: vec3(2.0, 3.0, 0), rotation: quatFromAxisAngle(VEC3_Z, -0.32) },
    },
    // Top cap
    {
      kind: "box",
      partId: "body",
      halfExtents: vec3(0.5, 0.25, 0.35),
      transform: { position: vec3(0, 5.85, 0), rotation: QUAT_IDENTITY },
    },
  ],
  anchors: [
    structAnchor("pivot.top", vec3(0, 6.1, 0), vec3(0, 1, 0), "body"),
  ],
};

// ---------------------------------------------------------------------------
// 2. Trebuchet Pivot — motorized Z-axis revolute joint
//
// base part merges (struct) with the fixed frame; rotor part merges (struct)
// with the arm. The revolute joint between them is the arm's rotation axis.
//
// Motor: velocity mode driven by "trebuchetWind" input.
//   negative scale → holding key winds arm back (cocks the trebuchet);
//   releasing key → motor idles, gravity takes over and fires.
// ---------------------------------------------------------------------------

export const trebuchetPivotBlock: BlockDefinition = {
  id: "trebuchet.pivot",
  name: "Trebuchet Pivot",
  category: "trebuchet",
  parts: [
    { id: "base", mass: 0.2 },
    { id: "rotor", mass: 0.2 },
  ],
  geometry: [
    {
      kind: "cylinder",
      partId: "base",
      radius: 0.25,
      halfHeight: 0.12,
      axis: "z",
      transform: { position: vec3(0, 0, -0.12), rotation: QUAT_IDENTITY },
    },
    {
      kind: "cylinder",
      partId: "rotor",
      radius: 0.25,
      halfHeight: 0.12,
      axis: "z",
      transform: { position: vec3(0, 0, 0.12), rotation: QUAT_IDENTITY },
    },
  ],
  colliders: [
    {
      kind: "cylinder",
      partId: "base",
      radius: 0.25,
      halfHeight: 0.12,
      axis: "z",
      sensor: true,
      transform: { position: vec3(0, 0, -0.12), rotation: QUAT_IDENTITY },
    },
    {
      kind: "cylinder",
      partId: "rotor",
      radius: 0.25,
      halfHeight: 0.12,
      axis: "z",
      sensor: true,
      transform: { position: vec3(0, 0, 0.12), rotation: QUAT_IDENTITY },
    },
  ],
  anchors: [
    // Connects down to frame's pivot.top (normal 0,1,0 → opposite 0,-1,0 here)
    {
      id: "base.mount",
      partId: "base",
      position: vec3(0, 0, 0),
      normal: vec3(0, -1, 0),
      orientation: lookRotation(vec3(0, -1, 0), VEC3_Z),
      type: "struct",
    },
    jointAnchor("base.joint", "base", vec3(0, 0, 0), vec3(0, 1, 0), "positive"),
    jointAnchor("rotor.joint", "rotor", vec3(0, 0, 0), vec3(0, -1, 0), "negative"),
    // Connects up to arm's pivot.attach (normal 0,1,0 → opposite 0,-1,0 here)
    {
      id: "rotor.mount",
      partId: "rotor",
      position: vec3(0, 0, 0),
      normal: vec3(0, 1, 0),
      orientation: lookRotation(vec3(0, 1, 0), VEC3_Z),
      type: "struct",
    },
  ],
  joint: {
    kind: "revolute",
    partA: "base",
    partB: "rotor",
    anchorA: "base.joint",
    anchorB: "rotor.joint",
    axis: vec3(0, 0, 1),
    motor: {
      mode: "velocity",
      targetVelocity: 0,
      damping: 10,
      stiffness: 0,
      maxForce: 8000,
      // Negative scale: pressing key drives arm clockwise (winds long arm down = cocking)
      input: { action: "trebuchetWind", scale: -4 },
      inputTarget: "velocity",
    },
    collideConnected: false,
  },
};

// ---------------------------------------------------------------------------
// 3. Trebuchet Arm — 9-unit asymmetric throwing beam
//
// Total length: 9 units (x: -4.5 to +4.5 in local space).
// Pivot point is at x=-1.5 local, so:
//   short side (counterweight): 3 units  (local x = -4.5 to -1.5)
//   long  side (sling):         6 units  (local x = -1.5 to +4.5)
//
// When positioned with center at (1.5, pivotY, 0), the pivot.attach anchor
// lands exactly at world (0, pivotY, 0) — the revolute joint location.
// ---------------------------------------------------------------------------

export const trebuchetArmBlock: BlockDefinition = {
  id: "trebuchet.arm",
  name: "Trebuchet Arm",
  category: "trebuchet",
  mass: 5,
  geometry: [
    { kind: "box", size: vec3(9, 0.35, 0.35) },
  ],
  colliders: [
    { kind: "box", halfExtents: vec3(4.5, 0.175, 0.175) },
  ],
  anchors: [
    // Pivot attachment point (where the revolute joint lives)
    structAnchor("pivot.attach", vec3(-1.5, 0, 0), vec3(0, 1, 0)),
    // Short-side end (counterweight hangs here, 3 units from pivot)
    structAnchor("short.end", vec3(-4.5, 0, 0), vec3(-1, 0, 0)),
    // Long-side end (sling attaches here, 6 units from pivot)
    structAnchor("long.end", vec3(4.5, 0, 0), vec3(1, 0, 0)),
  ],
};

// ---------------------------------------------------------------------------
// 4. Trebuchet Ball Joint — passive spherical joint (reused 3×)
//
// Used for:
//   - counterweight swing joint (at short arm end)
//   - sling link 1 (at long arm end)
//   - sling link 2 (mid-sling chain)
//
// arm-side part merges structurally with the upstream body (arm or previous
// link's free-side). free-side part merges with the downstream body (CW or
// next link's arm-side). The spherical joint between them gives free 3-DOF
// rotation, approximating a rope/chain segment.
// ---------------------------------------------------------------------------

export const trebuchetBallJointBlock: BlockDefinition = {
  id: "trebuchet.ball.joint",
  name: "Trebuchet Ball Joint",
  category: "trebuchet",
  parts: [
    { id: "arm-side", mass: 0.05 },
    { id: "free-side", mass: 0.05 },
  ],
  geometry: [],
  colliders: [
    {
      kind: "sphere",
      partId: "arm-side",
      radius: 0.08,
      sensor: true,
      mass: 0.05,
    },
    {
      kind: "sphere",
      partId: "free-side",
      radius: 0.08,
      sensor: true,
      mass: 0.05,
    },
  ],
  anchors: [
    // External: connects to the upstream body (arm short.end / long.end / prev free.mount)
    {
      id: "arm.mount",
      partId: "arm-side",
      position: vec3(0, 0, 0),
      normal: vec3(0, 1, 0),
      orientation: lookRotation(vec3(0, 1, 0), VEC3_Z),
      type: "struct",
    },
    // Internal joint anchors
    jointAnchor("arm.joint", "arm-side", vec3(0, 0, 0), vec3(0, 1, 0), "positive"),
    jointAnchor("free.joint", "free-side", vec3(0, 0, 0), vec3(0, -1, 0), "negative"),
    // External: connects to the downstream body (counterweight / next link arm.mount)
    {
      id: "free.mount",
      partId: "free-side",
      position: vec3(0, 0, 0),
      normal: vec3(0, -1, 0),
      orientation: lookRotation(vec3(0, -1, 0), VEC3_Z),
      type: "struct",
    },
  ],
  joint: {
    kind: "spherical",
    partA: "arm-side",
    partB: "free-side",
    anchorA: "arm.joint",
    anchorB: "free.joint",
    collideConnected: false,
  },
};

// ---------------------------------------------------------------------------
// 5. Trebuchet Counterweight — heavy hanging mass
//
// 80 kg box. Hangs from the short arm end via a trebuchet.ball.joint so it
// can swing freely. The weight ratio (CW 80 kg vs projectile 5 kg, arm
// lever 1:2) provides the launch energy.
// ---------------------------------------------------------------------------

export const trebuchetCounterweightBlock: BlockDefinition = {
  id: "trebuchet.counterweight",
  name: "Trebuchet Counterweight",
  category: "trebuchet",
  mass: 80,
  geometry: [
    { kind: "box", size: vec3(1.4, 1.4, 1.4) },
  ],
  colliders: [
    { kind: "box", halfExtents: vec3(0.7, 0.7, 0.7) },
  ],
  anchors: [
    // Top face — connects to ball joint's free.mount
    structAnchor("attach", vec3(0, 0.7, 0), vec3(0, 1, 0)),
  ],
};

// ---------------------------------------------------------------------------
// 6. Trebuchet Projectile — the thing being launched
//
// 5 kg sphere. Hangs at the end of the 2-link sling chain. When the arm
// swings the sling fully outward the projectile separates on its ballistic
// trajectory (joint stays, but the pendulum physics naturally carries it).
// ---------------------------------------------------------------------------

export const trebuchetProjectileBlock: BlockDefinition = {
  id: "trebuchet.projectile",
  name: "Trebuchet Projectile",
  category: "trebuchet",
  mass: 5,
  geometry: [
    { kind: "sphere", radius: 0.55 },
  ],
  colliders: [
    { kind: "sphere", radius: 0.55, restitution: 0.4 },
  ],
  anchors: [
    // Top — connects to sling chain's free.mount
    structAnchor("attach", vec3(0, 0.55, 0), vec3(0, 1, 0)),
  ],
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const trebuchetBlocks: BlockDefinition[] = [
  trebuchetFrameBlock,
  trebuchetPivotBlock,
  trebuchetArmBlock,
  trebuchetBallJointBlock,
  trebuchetCounterweightBlock,
  trebuchetProjectileBlock,
];
