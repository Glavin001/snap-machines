/**
 * Besiege Layer 0 — Primitive blocks.
 *
 * These are the smallest building units that map directly to Rapier physics
 * primitives. Everything else (compounds, machines) is built from these.
 *
 * Structural primitives: Block, Cylinder, Sphere
 * Joint primitives:      Fixed, Hinge (existing), Slider, Ball, Passive Hinge
 * Force primitives:      Thruster (existing)
 */
import { BlockDefinition } from "../schema.js";
import { VEC3_Y, VEC3_Z, lookRotation, vec3 } from "../math.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sideAnchor(
  id: string,
  position: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
) {
  return {
    id,
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

function structAnchor(
  id: string,
  partId: string,
  position: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
) {
  return {
    id,
    partId,
    position,
    normal,
    orientation: lookRotation(normal, Math.abs(normal.y) > 0.99 ? VEC3_Z : VEC3_Y),
    type: "struct",
  } as const;
}

// ---------------------------------------------------------------------------
// Structural Primitives
// ---------------------------------------------------------------------------

/** 1×1×1 block — the universal building material. */
export const blockPrimitive: BlockDefinition = {
  id: "primitive.block.1x1",
  name: "Block 1×1",
  category: "structural",
  mass: 1,
  geometry: [{ kind: "box", size: vec3(1, 1, 1) }],
  colliders: [{ kind: "box", halfExtents: vec3(0.5, 0.5, 0.5) }],
  anchors: [
    sideAnchor("xp", vec3(0.5, 0, 0), vec3(1, 0, 0)),
    sideAnchor("xn", vec3(-0.5, 0, 0), vec3(-1, 0, 0)),
    sideAnchor("yp", vec3(0, 0.5, 0), vec3(0, 1, 0)),
    sideAnchor("yn", vec3(0, -0.5, 0), vec3(0, -1, 0)),
    sideAnchor("zp", vec3(0, 0, 0.5), vec3(0, 0, 1)),
    sideAnchor("zn", vec3(0, 0, -0.5), vec3(0, 0, -1)),
  ],
};

/** 2×1×1 block — short beam/plank. */
export const block2x1Primitive: BlockDefinition = {
  id: "primitive.block.2x1",
  name: "Block 2×1",
  category: "structural",
  mass: 2,
  geometry: [{ kind: "box", size: vec3(2, 1, 1) }],
  colliders: [{ kind: "box", halfExtents: vec3(1, 0.5, 0.5) }],
  anchors: [
    sideAnchor("xp", vec3(1, 0, 0), vec3(1, 0, 0)),
    sideAnchor("xn", vec3(-1, 0, 0), vec3(-1, 0, 0)),
    sideAnchor("yp", vec3(0, 0.5, 0), vec3(0, 1, 0)),
    sideAnchor("yn", vec3(0, -0.5, 0), vec3(0, -1, 0)),
    sideAnchor("zp", vec3(0, 0, 0.5), vec3(0, 0, 1)),
    sideAnchor("zn", vec3(0, 0, -0.5), vec3(0, 0, -1)),
    // Extra side anchors at ends
    sideAnchor("zp.l", vec3(-0.5, 0, 0.5), vec3(0, 0, 1)),
    sideAnchor("zp.r", vec3(0.5, 0, 0.5), vec3(0, 0, 1)),
    sideAnchor("zn.l", vec3(-0.5, 0, -0.5), vec3(0, 0, -1)),
    sideAnchor("zn.r", vec3(0.5, 0, -0.5), vec3(0, 0, -1)),
    sideAnchor("yn.l", vec3(-0.5, -0.5, 0), vec3(0, -1, 0)),
    sideAnchor("yn.r", vec3(0.5, -0.5, 0), vec3(0, -1, 0)),
    sideAnchor("yp.l", vec3(-0.5, 0.5, 0), vec3(0, 1, 0)),
    sideAnchor("yp.r", vec3(0.5, 0.5, 0), vec3(0, 1, 0)),
  ],
};

/** Thin 2×1 plate — good for wings, fins, flaps. */
export const platePrimitive: BlockDefinition = {
  id: "primitive.plate.2x1",
  name: "Plate 2×1",
  category: "structural",
  mass: 0.5,
  geometry: [{ kind: "box", size: vec3(2, 0.1, 1) }],
  colliders: [{ kind: "box", halfExtents: vec3(1, 0.05, 0.5) }],
  anchors: [
    sideAnchor("xp", vec3(1, 0, 0), vec3(1, 0, 0)),
    sideAnchor("xn", vec3(-1, 0, 0), vec3(-1, 0, 0)),
    sideAnchor("yp", vec3(0, 0.05, 0), vec3(0, 1, 0)),
    sideAnchor("yn", vec3(0, -0.05, 0), vec3(0, -1, 0)),
    sideAnchor("zp", vec3(0, 0, 0.5), vec3(0, 0, 1)),
    sideAnchor("zn", vec3(0, 0, -0.5), vec3(0, 0, -1)),
  ],
};

/** Cylinder — shafts, barrels, wheel hubs, pipes. */
export const cylinderPrimitive: BlockDefinition = {
  id: "primitive.cylinder",
  name: "Cylinder",
  category: "structural",
  mass: 1,
  geometry: [{
    kind: "cylinder",
    radius: 0.5,
    halfHeight: 0.5,
    axis: "y",
  }],
  colliders: [{
    kind: "cylinder",
    radius: 0.5,
    halfHeight: 0.5,
    axis: "y",
  }],
  anchors: [
    sideAnchor("yp", vec3(0, 0.5, 0), vec3(0, 1, 0)),
    sideAnchor("yn", vec3(0, -0.5, 0), vec3(0, -1, 0)),
    sideAnchor("xp", vec3(0.5, 0, 0), vec3(1, 0, 0)),
    sideAnchor("xn", vec3(-0.5, 0, 0), vec3(-1, 0, 0)),
    sideAnchor("zp", vec3(0, 0, 0.5), vec3(0, 0, 1)),
    sideAnchor("zn", vec3(0, 0, -0.5), vec3(0, 0, -1)),
  ],
};

/** Sphere — ball bearings, decorative, projectiles. */
export const spherePrimitive: BlockDefinition = {
  id: "primitive.sphere",
  name: "Sphere",
  category: "structural",
  mass: 1,
  geometry: [{
    kind: "sphere",
    radius: 0.5,
  }],
  colliders: [{
    kind: "sphere",
    radius: 0.5,
  }],
  anchors: [
    sideAnchor("yp", vec3(0, 0.5, 0), vec3(0, 1, 0)),
    sideAnchor("yn", vec3(0, -0.5, 0), vec3(0, -1, 0)),
    sideAnchor("xp", vec3(0.5, 0, 0), vec3(1, 0, 0)),
    sideAnchor("xn", vec3(-0.5, 0, 0), vec3(-1, 0, 0)),
    sideAnchor("zp", vec3(0, 0, 0.5), vec3(0, 0, 1)),
    sideAnchor("zn", vec3(0, 0, -0.5), vec3(0, 0, -1)),
  ],
};

// ---------------------------------------------------------------------------
// Joint Primitives
// ---------------------------------------------------------------------------

/**
 * Fixed joint — welds two bodies rigidly.
 * Use when you need breakability or force readout. Otherwise merge
 * structurally for better performance.
 */
export const fixedJointPrimitive: BlockDefinition = {
  id: "joint.fixed",
  name: "Fixed Joint",
  category: "joints",
  parts: [
    { id: "base", mass: 0.1 },
    { id: "mount", mass: 0.1 },
  ],
  geometry: [
    { kind: "box", partId: "base", size: vec3(0.3, 0.3, 0.15), transform: { position: vec3(0, 0, -0.075), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
    { kind: "box", partId: "mount", size: vec3(0.3, 0.3, 0.15), transform: { position: vec3(0, 0, 0.075), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
  ],
  colliders: [
    { kind: "box", partId: "base", halfExtents: vec3(0.15, 0.15, 0.075), transform: { position: vec3(0, 0, -0.075), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
    { kind: "box", partId: "mount", halfExtents: vec3(0.15, 0.15, 0.075), transform: { position: vec3(0, 0, 0.075), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
  ],
  anchors: [
    structAnchor("base.mount", "base", vec3(0, 0, -0.15), vec3(0, 0, -1)),
    jointAnchor("base.joint", "base", vec3(0, 0, 0), vec3(0, 0, 1), "positive"),
    jointAnchor("mount.joint", "mount", vec3(0, 0, 0), vec3(0, 0, -1), "negative"),
    structAnchor("mount.attach", "mount", vec3(0, 0, 0.15), vec3(0, 0, 1)),
  ],
  joint: {
    kind: "fixed",
    partA: "base",
    partB: "mount",
    anchorA: "base.joint",
    anchorB: "mount.joint",
    collideConnected: false,
  },
};

/**
 * Slider (Prismatic Joint) — translation along one axis.
 * Can be free, limited, or motorized.
 */
export const sliderJointPrimitive: BlockDefinition = {
  id: "joint.slider",
  name: "Slider Joint",
  category: "joints",
  parts: [
    { id: "rail", mass: 0.5 },
    { id: "carriage", mass: 0.5 },
  ],
  geometry: [
    { kind: "box", partId: "rail", size: vec3(1, 0.2, 0.3), transform: { position: vec3(-0.25, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
    { kind: "box", partId: "carriage", size: vec3(0.5, 0.25, 0.35), transform: { position: vec3(0.25, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
  ],
  colliders: [
    { kind: "box", partId: "rail", halfExtents: vec3(0.5, 0.1, 0.15), transform: { position: vec3(-0.25, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
    { kind: "box", partId: "carriage", halfExtents: vec3(0.25, 0.125, 0.175), transform: { position: vec3(0.25, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
  ],
  anchors: [
    structAnchor("rail.mount", "rail", vec3(-0.75, 0, 0), vec3(-1, 0, 0)),
    jointAnchor("rail.joint", "rail", vec3(0, 0, 0), vec3(1, 0, 0), "positive"),
    jointAnchor("carriage.joint", "carriage", vec3(0, 0, 0), vec3(-1, 0, 0), "negative"),
    structAnchor("carriage.mount", "carriage", vec3(0.5, 0, 0), vec3(1, 0, 0)),
    structAnchor("carriage.top", "carriage", vec3(0.25, 0.125, 0), vec3(0, 1, 0)),
    structAnchor("carriage.bottom", "carriage", vec3(0.25, -0.125, 0), vec3(0, -1, 0)),
  ],
  joint: {
    kind: "prismatic",
    partA: "rail",
    partB: "carriage",
    anchorA: "rail.joint",
    anchorB: "carriage.joint",
    axis: vec3(1, 0, 0),
    limits: { min: -0.5, max: 0.5 },
    motor: {
      mode: "position",
      targetPosition: 0,
      stiffness: 200,
      damping: 20,
      maxForce: 400,
      input: { action: "sliderPos", scale: 0.5 },
      inputTarget: "position",
    },
    collideConnected: false,
  },
};

/**
 * Ball joint (Spherical) — free rotation in all directions, no translation.
 * Good for linkages, tow hitches, robotic joints.
 */
export const ballJointPrimitive: BlockDefinition = {
  id: "joint.ball",
  name: "Ball Joint",
  category: "joints",
  parts: [
    { id: "socket", mass: 0.3 },
    { id: "ball", mass: 0.3 },
  ],
  geometry: [
    { kind: "box", partId: "socket", size: vec3(0.3, 0.3, 0.3), transform: { position: vec3(0, 0, -0.15), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
    { kind: "sphere", partId: "ball", radius: 0.15, transform: { position: vec3(0, 0, 0.15), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
  ],
  colliders: [
    { kind: "box", partId: "socket", halfExtents: vec3(0.15, 0.15, 0.15), transform: { position: vec3(0, 0, -0.15), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
    { kind: "sphere", partId: "ball", radius: 0.15, transform: { position: vec3(0, 0, 0.15), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
  ],
  anchors: [
    structAnchor("socket.mount", "socket", vec3(0, 0, -0.3), vec3(0, 0, -1)),
    jointAnchor("socket.joint", "socket", vec3(0, 0, 0), vec3(0, 0, 1), "positive"),
    jointAnchor("ball.joint", "ball", vec3(0, 0, 0), vec3(0, 0, -1), "negative"),
    structAnchor("ball.mount", "ball", vec3(0, 0, 0.3), vec3(0, 0, 1)),
  ],
  joint: {
    kind: "spherical",
    partA: "socket",
    partB: "ball",
    anchorA: "socket.joint",
    anchorB: "ball.joint",
    collideConnected: false,
  },
};

/**
 * Passive hinge — free-spinning revolute joint with no motor.
 * Lighter-weight alternative to the motorized hinge.
 */
export const passiveHingePrimitive: BlockDefinition = {
  id: "joint.hinge.passive",
  name: "Passive Hinge",
  category: "joints",
  parts: [
    { id: "base", mass: 0.3 },
    { id: "rotor", mass: 0.3 },
  ],
  geometry: [
    { kind: "box", partId: "base", size: vec3(0.5, 0.25, 0.4), transform: { position: vec3(-0.15, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
    { kind: "box", partId: "rotor", size: vec3(0.5, 0.25, 0.4), transform: { position: vec3(0.15, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
  ],
  colliders: [
    { kind: "box", partId: "base", halfExtents: vec3(0.25, 0.125, 0.2), transform: { position: vec3(-0.15, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
    { kind: "box", partId: "rotor", halfExtents: vec3(0.25, 0.125, 0.2), transform: { position: vec3(0.15, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
  ],
  anchors: [
    structAnchor("base.mount", "base", vec3(-0.4, 0, 0), vec3(-1, 0, 0)),
    jointAnchor("base.joint", "base", vec3(0, 0, 0), vec3(1, 0, 0), "positive"),
    jointAnchor("rotor.joint", "rotor", vec3(0, 0, 0), vec3(-1, 0, 0), "negative"),
    structAnchor("rotor.mount", "rotor", vec3(0.4, 0, 0), vec3(1, 0, 0)),
  ],
  joint: {
    kind: "revolute",
    partA: "base",
    partB: "rotor",
    anchorA: "base.joint",
    anchorB: "rotor.joint",
    axis: vec3(0, 1, 0),
    collideConnected: false,
  },
};

// ---------------------------------------------------------------------------
// Concrete Building Primitives
// ---------------------------------------------------------------------------

/** Concrete pillar — vertical support column, 0.5m diameter, 3.0m tall. */
export const pillarConcretePrimitive: BlockDefinition = {
  id: "primitive.pillar.concrete",
  name: "Concrete Pillar",
  category: "structural",
  mass: 7.0,
  geometry: [{
    kind: "cylinder",
    radius: 0.25,
    halfHeight: 1.5,
    axis: "y",
  }],
  colliders: [{
    kind: "cylinder",
    radius: 0.25,
    halfHeight: 1.5,
    axis: "y",
  }],
  anchors: [
    sideAnchor("yp", vec3(0, 1.5, 0), vec3(0, 1, 0)),
    sideAnchor("yn", vec3(0, -1.5, 0), vec3(0, -1, 0)),
    sideAnchor("xp", vec3(0.25, 0, 0), vec3(1, 0, 0)),
    sideAnchor("xn", vec3(-0.25, 0, 0), vec3(-1, 0, 0)),
    sideAnchor("zp", vec3(0, 0, 0.25), vec3(0, 0, 1)),
    sideAnchor("zn", vec3(0, 0, -0.25), vec3(0, 0, -1)),
  ],
};

/** Concrete floor slab — 10m × 10m × 0.5m platform. */
export const floorSlabPrimitive: BlockDefinition = {
  id: "primitive.floor.slab.10x10",
  name: "Floor Slab 10×10",
  category: "structural",
  mass: 50.0,
  geometry: [{ kind: "box", size: vec3(10, 0.5, 10) }],
  colliders: [{ kind: "box", halfExtents: vec3(5, 0.25, 5) }],
  anchors: [
    // Top corner anchors for pillar mounting
    sideAnchor("corner.xp.zp", vec3(5, 0.25, 5), vec3(0, 1, 0)),
    sideAnchor("corner.xp.zn", vec3(5, 0.25, -5), vec3(0, 1, 0)),
    sideAnchor("corner.xn.zp", vec3(-5, 0.25, 5), vec3(0, 1, 0)),
    sideAnchor("corner.xn.zn", vec3(-5, 0.25, -5), vec3(0, 1, 0)),
    // Bottom center for vertical stacking
    sideAnchor("bottom.center", vec3(0, -0.25, 0), vec3(0, -1, 0)),
    // Stairs connections (front and back)
    sideAnchor("stairs.front", vec3(0, 0.25, 5), vec3(0, 0, 1)),
    sideAnchor("stairs.back", vec3(0, 0.25, -5), vec3(0, 0, -1)),
  ],
};

/** Concrete stairs — stepped profile with 3 steps, 1.5m wide. */
export const stairsConcretePrimitive: BlockDefinition = {
  id: "primitive.stairs.concrete",
  name: "Concrete Stairs",
  category: "structural",
  mass: 12.0,
  geometry: [
    // Visual representation: 3 stepped boxes
    { kind: "box", size: vec3(1.5, 0.5, 0.5), transform: { position: vec3(-0.5, 0.25, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
    { kind: "box", size: vec3(1.5, 0.5, 0.5), transform: { position: vec3(0, 0.75, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
    { kind: "box", size: vec3(1.5, 0.5, 0.5), transform: { position: vec3(0.5, 1.25, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
  ],
  colliders: [
    // Stepped colliders for realistic physics
    { kind: "box", halfExtents: vec3(0.75, 0.25, 0.25), transform: { position: vec3(-0.5, 0.25, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
    { kind: "box", halfExtents: vec3(0.75, 0.25, 0.25), transform: { position: vec3(0, 0.75, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
    { kind: "box", halfExtents: vec3(0.75, 0.25, 0.25), transform: { position: vec3(0.5, 1.25, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) } },
  ],
  anchors: [
    sideAnchor("bottom", vec3(-0.75, 0, 0), vec3(0, -1, 0)),
    sideAnchor("top", vec3(0.75, 1.5, 0), vec3(0, 1, 0)),
    sideAnchor("side.left", vec3(0, 0.75, -0.75), vec3(0, 0, -1)),
    sideAnchor("side.right", vec3(0, 0.75, 0.75), vec3(0, 0, 1)),
  ],
};

/** Concrete wall panel — 2.0m × 2.5m × 0.2m thick infill panel. */
export const wallPanelPrimitive: BlockDefinition = {
  id: "primitive.wall.panel.concrete",
  name: "Wall Panel",
  category: "structural",
  mass: 5.0,
  geometry: [{ kind: "box", size: vec3(2, 2.5, 0.2) }],
  colliders: [{ kind: "box", halfExtents: vec3(1, 1.25, 0.1) }],
  anchors: [
    sideAnchor("back", vec3(0, 0, -0.1), vec3(0, 0, -1)),
    sideAnchor("front", vec3(0, 0, 0.1), vec3(0, 0, 1)),
    sideAnchor("top", vec3(0, 1.25, 0), vec3(0, 1, 0)),
    sideAnchor("bottom", vec3(0, -1.25, 0), vec3(0, -1, 0)),
    sideAnchor("left", vec3(-1, 0, 0), vec3(-1, 0, 0)),
    sideAnchor("right", vec3(1, 0, 0), vec3(1, 0, 0)),
  ],
};

// ---------------------------------------------------------------------------
// Export all primitives
// ---------------------------------------------------------------------------

export const besiegePrimitives: BlockDefinition[] = [
  // Structural
  blockPrimitive,
  block2x1Primitive,
  platePrimitive,
  cylinderPrimitive,
  spherePrimitive,
  // Concrete building
  pillarConcretePrimitive,
  floorSlabPrimitive,
  stairsConcretePrimitive,
  wallPanelPrimitive,
  // Joints
  fixedJointPrimitive,
  sliderJointPrimitive,
  ballJointPrimitive,
  passiveHingePrimitive,
];
