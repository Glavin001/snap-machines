/**
 * Besiege Layer 1 — Single-block compound definitions.
 *
 * Each compound is a `BlockDefinition` with 2 parts connected by 1 joint.
 * This follows the `motorWheelBlock` pattern: a self-contained assembly
 * that the player drops as one unit.
 *
 * Compounds: Wheel, Propeller, Jet Engine, Shock Absorber, Arm Segment,
 *            Control Surface
 */
import { BlockDefinition } from "../schema.js";
import { QUAT_IDENTITY, VEC3_Y, VEC3_Z, lookRotation, vec3 } from "../math.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Wheel — Cylinder + Revolute, velocity motor
// ---------------------------------------------------------------------------

/**
 * Motor wheel — a cylinder tire connected to a mount via revolute joint.
 * Spins around Z when side-mounted on a chassis.
 */
export const wheelCompound: BlockDefinition = {
  id: "compound.wheel",
  name: "Wheel",
  category: "locomotion",
  parts: [
    { id: "mount", mass: 0.5 },
    { id: "wheel", mass: 1.5 },
  ],
  geometry: [
    { kind: "box", partId: "mount", size: vec3(0.3, 0.3, 0.3) },
    {
      kind: "cylinder",
      partId: "wheel",
      radius: 0.8,
      halfHeight: 0.15,
      axis: "z",
      transform: { position: vec3(0, 0, 0.3), rotation: QUAT_IDENTITY },
    },
  ],
  colliders: [
    { kind: "box", partId: "mount", halfExtents: vec3(0.15, 0.15, 0.15) },
    {
      kind: "cylinder",
      partId: "wheel",
      radius: 0.8,
      halfHeight: 0.15,
      axis: "z",
      friction: 2.0,
      transform: { position: vec3(0, 0, 0.3), rotation: QUAT_IDENTITY },
    },
  ],
  anchors: [
    structAnchor("mount.attach", "mount", vec3(0, 0, -0.15), vec3(0, 0, -1)),
    jointAnchor("mount.joint", "mount", vec3(0, 0, 0.15), vec3(0, 0, 1), "positive"),
    jointAnchor("wheel.joint", "wheel", vec3(0, 0, 0.15), vec3(0, 0, -1), "negative"),
    structAnchor("wheel.outer", "wheel", vec3(0, 0, 0.45), vec3(0, 0, 1)),
  ],
  joint: {
    kind: "revolute",
    partA: "mount",
    partB: "wheel",
    anchorA: "mount.joint",
    anchorB: "wheel.joint",
    axis: vec3(0, 0, 1),
    motor: {
      mode: "velocity",
      targetVelocity: 0,
      damping: 10,
      stiffness: 0,
      maxForce: 100,
      input: { action: "motorSpin", scale: 5 },
      inputTarget: "velocity",
    },
    collideConnected: false,
  },
};

// ---------------------------------------------------------------------------
// Propeller — Cylinder hub + Revolute + Thruster behavior
// ---------------------------------------------------------------------------

/**
 * Propeller — a spinning hub that generates thrust.
 * The blade is a thin disc; the thruster behavior applies force proportional
 * to the throttle input along the blade's spin axis.
 */
export const propellerCompound: BlockDefinition = {
  id: "compound.propeller",
  name: "Propeller",
  category: "flight",
  parts: [
    { id: "hub", mass: 0.3 },
    { id: "blade", mass: 0.2 },
  ],
  geometry: [
    { kind: "cylinder", partId: "hub", radius: 0.15, halfHeight: 0.1, axis: "y" },
    {
      kind: "cylinder",
      partId: "blade",
      radius: 1.0,
      halfHeight: 0.03,
      axis: "y",
      transform: { position: vec3(0, 0.15, 0), rotation: QUAT_IDENTITY },
    },
  ],
  colliders: [
    { kind: "cylinder", partId: "hub", radius: 0.15, halfHeight: 0.1, axis: "y" },
    {
      kind: "cylinder",
      partId: "blade",
      radius: 1.0,
      halfHeight: 0.03,
      axis: "y",
      sensor: true,  // Don't physically collide — it's a propeller disc
      transform: { position: vec3(0, 0.15, 0), rotation: QUAT_IDENTITY },
      mass: 0.2,
    },
  ],
  anchors: [
    structAnchor("hub.attach", "hub", vec3(0, -0.1, 0), vec3(0, -1, 0)),
    jointAnchor("hub.joint", "hub", vec3(0, 0.05, 0), vec3(0, 1, 0), "positive"),
    jointAnchor("blade.joint", "blade", vec3(0, 0.05, 0), vec3(0, -1, 0), "negative"),
  ],
  joint: {
    kind: "revolute",
    partA: "hub",
    partB: "blade",
    anchorA: "hub.joint",
    anchorB: "blade.joint",
    axis: vec3(0, 1, 0),
    motor: {
      mode: "velocity",
      targetVelocity: 0,
      damping: 0.5,
      stiffness: 0,
      maxForce: 20,
      input: { action: "propellerSpin", scale: 30 },
      inputTarget: "velocity",
    },
    collideConnected: false,
  },
  behaviors: [
    {
      kind: "thruster",
      partId: "blade",
      props: {
        force: 15,
        localDirection: { x: 0, y: 1, z: 0 },
        localPoint: { x: 0, y: 0, z: 0 },
      },
      input: { action: "throttle", scale: 1 },
    },
  ],
};

// ---------------------------------------------------------------------------
// Jet Engine — Single-part cylinder with thruster behavior
// ---------------------------------------------------------------------------

/**
 * Jet engine — a tube that generates thrust out the back.
 * No moving parts; it's a cylinder with a force vector.
 */
export const jetEngineCompound: BlockDefinition = {
  id: "compound.jet",
  name: "Jet Engine",
  category: "flight",
  mass: 1,
  geometry: [{
    kind: "cylinder",
    radius: 0.3,
    halfHeight: 0.5,
    axis: "x",
  }],
  colliders: [{
    kind: "cylinder",
    radius: 0.3,
    halfHeight: 0.5,
    axis: "x",
  }],
  anchors: [
    {
      id: "intake",
      position: vec3(-0.5, 0, 0),
      normal: vec3(-1, 0, 0),
      orientation: lookRotation(vec3(-1, 0, 0), VEC3_Y),
      type: "struct",
    },
    {
      id: "exhaust",
      position: vec3(0.5, 0, 0),
      normal: vec3(1, 0, 0),
      orientation: lookRotation(vec3(1, 0, 0), VEC3_Y),
      type: "utility",
    },
  ],
  behaviors: [
    {
      kind: "thruster",
      props: {
        force: 40,
        localDirection: { x: 1, y: 0, z: 0 },
        localPoint: { x: 0.5, y: 0, z: 0 },
      },
      input: { action: "throttle", scale: 1 },
    },
  ],
};

// ---------------------------------------------------------------------------
// Shock Absorber — Prismatic joint configured as spring
// ---------------------------------------------------------------------------

/**
 * Shock absorber — a prismatic joint with a spring motor.
 * Provides suspension travel with configurable stiffness/damping.
 */
export const shockAbsorberCompound: BlockDefinition = {
  id: "compound.shock",
  name: "Shock Absorber",
  category: "locomotion",
  parts: [
    { id: "upper", mass: 0.5 },
    { id: "lower", mass: 0.5 },
  ],
  geometry: [
    { kind: "box", partId: "upper", size: vec3(0.3, 0.4, 0.3), transform: { position: vec3(0, 0.15, 0), rotation: QUAT_IDENTITY } },
    { kind: "box", partId: "lower", size: vec3(0.25, 0.4, 0.25), transform: { position: vec3(0, -0.15, 0), rotation: QUAT_IDENTITY } },
  ],
  colliders: [
    { kind: "box", partId: "upper", halfExtents: vec3(0.15, 0.2, 0.15), transform: { position: vec3(0, 0.15, 0), rotation: QUAT_IDENTITY } },
    { kind: "box", partId: "lower", halfExtents: vec3(0.125, 0.2, 0.125), transform: { position: vec3(0, -0.15, 0), rotation: QUAT_IDENTITY } },
  ],
  anchors: [
    structAnchor("upper.attach", "upper", vec3(0, 0.35, 0), vec3(0, 1, 0)),
    jointAnchor("upper.joint", "upper", vec3(0, 0, 0), vec3(0, -1, 0), "positive"),
    jointAnchor("lower.joint", "lower", vec3(0, 0, 0), vec3(0, 1, 0), "negative"),
    structAnchor("lower.attach", "lower", vec3(0, -0.35, 0), vec3(0, -1, 0)),
  ],
  joint: {
    kind: "prismatic",
    partA: "upper",
    partB: "lower",
    anchorA: "upper.joint",
    anchorB: "lower.joint",
    axis: vec3(0, 1, 0),
    limits: { min: -0.3, max: 0.3 },
    motor: {
      mode: "position",
      targetPosition: 0,
      stiffness: 200,
      damping: 20,
      maxForce: 500,
    },
    collideConnected: false,
  },
};

// ---------------------------------------------------------------------------
// Arm Segment — Link + Revolute with position motor
// ---------------------------------------------------------------------------

/**
 * Arm segment — a link connected to a mount via a position-controlled hinge.
 * The fundamental robotics building block for cranes, robot arms, etc.
 */
export const armSegmentCompound: BlockDefinition = {
  id: "compound.arm",
  name: "Arm Segment",
  category: "manipulation",
  parts: [
    { id: "mount", mass: 0.3 },
    { id: "link", mass: 0.7 },
  ],
  geometry: [
    { kind: "box", partId: "mount", size: vec3(0.4, 0.4, 0.4) },
    {
      kind: "box",
      partId: "link",
      size: vec3(0.3, 1.5, 0.3),
      transform: { position: vec3(0, 0.95, 0), rotation: QUAT_IDENTITY },
    },
  ],
  colliders: [
    { kind: "box", partId: "mount", halfExtents: vec3(0.2, 0.2, 0.2) },
    {
      kind: "box",
      partId: "link",
      halfExtents: vec3(0.15, 0.75, 0.15),
      transform: { position: vec3(0, 0.95, 0), rotation: QUAT_IDENTITY },
    },
  ],
  anchors: [
    structAnchor("mount.attach", "mount", vec3(0, -0.2, 0), vec3(0, -1, 0)),
    structAnchor("mount.side.xp", "mount", vec3(0.2, 0, 0), vec3(1, 0, 0)),
    structAnchor("mount.side.xn", "mount", vec3(-0.2, 0, 0), vec3(-1, 0, 0)),
    jointAnchor("mount.joint", "mount", vec3(0, 0.2, 0), vec3(0, 1, 0), "positive"),
    jointAnchor("link.joint", "link", vec3(0, 0.2, 0), vec3(0, -1, 0), "negative"),
    structAnchor("link.tip", "link", vec3(0, 1.7, 0), vec3(0, 1, 0)),
    structAnchor("link.side.xp", "link", vec3(0.15, 0.95, 0), vec3(1, 0, 0)),
    structAnchor("link.side.xn", "link", vec3(-0.15, 0.95, 0), vec3(-1, 0, 0)),
  ],
  joint: {
    kind: "revolute",
    partA: "mount",
    partB: "link",
    anchorA: "mount.joint",
    anchorB: "link.joint",
    axis: vec3(0, 0, 1),
    limits: { min: -Math.PI / 2, max: Math.PI / 2 },
    motor: {
      mode: "position",
      targetPosition: 0,
      stiffness: 100,
      damping: 20,
      maxForce: 200,
      input: { action: "armPitch", scale: Math.PI / 2 },
      inputTarget: "position",
    },
    collideConnected: false,
  },
};

/**
 * Yaw arm segment — like arm segment but rotates around Y axis.
 * For turret bases, crane yaw joints, etc.
 */
export const yawArmSegmentCompound: BlockDefinition = {
  id: "compound.arm.yaw",
  name: "Yaw Arm",
  category: "manipulation",
  parts: [
    { id: "base", mass: 0.5 },
    { id: "turret", mass: 0.5 },
  ],
  geometry: [
    { kind: "cylinder", partId: "base", radius: 0.4, halfHeight: 0.15, axis: "y" },
    { kind: "cylinder", partId: "turret", radius: 0.35, halfHeight: 0.15, axis: "y", transform: { position: vec3(0, 0.3, 0), rotation: QUAT_IDENTITY } },
  ],
  colliders: [
    { kind: "cylinder", partId: "base", radius: 0.4, halfHeight: 0.15, axis: "y" },
    { kind: "cylinder", partId: "turret", radius: 0.35, halfHeight: 0.15, axis: "y", transform: { position: vec3(0, 0.3, 0), rotation: QUAT_IDENTITY } },
  ],
  anchors: [
    structAnchor("base.attach", "base", vec3(0, -0.15, 0), vec3(0, -1, 0)),
    jointAnchor("base.joint", "base", vec3(0, 0.15, 0), vec3(0, 1, 0), "positive"),
    jointAnchor("turret.joint", "turret", vec3(0, 0.15, 0), vec3(0, -1, 0), "negative"),
    structAnchor("turret.top", "turret", vec3(0, 0.45, 0), vec3(0, 1, 0)),
    structAnchor("turret.side.xp", "turret", vec3(0.35, 0.3, 0), vec3(1, 0, 0)),
    structAnchor("turret.side.xn", "turret", vec3(-0.35, 0.3, 0), vec3(-1, 0, 0)),
  ],
  joint: {
    kind: "revolute",
    partA: "base",
    partB: "turret",
    anchorA: "base.joint",
    anchorB: "turret.joint",
    axis: vec3(0, 1, 0),
    motor: {
      mode: "position",
      targetPosition: 0,
      stiffness: 100,
      damping: 20,
      maxForce: 200,
      input: { action: "armYaw", scale: Math.PI },
      inputTarget: "position",
    },
    collideConnected: false,
  },
};

// ---------------------------------------------------------------------------
// Control Surface — Thin flap + Revolute with position motor and limits
// ---------------------------------------------------------------------------

/**
 * Control surface — a thin plate connected via a limited hinge.
 * For ailerons, elevators, rudders. The deflection angle controls
 * the aerodynamic effect (faked as torque on the parent body for MVP).
 */
export const controlSurfaceCompound: BlockDefinition = {
  id: "compound.flap",
  name: "Control Surface",
  category: "flight",
  parts: [
    { id: "mount", mass: 0.1 },
    { id: "flap", mass: 0.2 },
  ],
  geometry: [
    { kind: "box", partId: "mount", size: vec3(0.1, 0.1, 0.4) },
    {
      kind: "box",
      partId: "flap",
      size: vec3(0.6, 0.05, 0.4),
      transform: { position: vec3(0.35, 0, 0), rotation: QUAT_IDENTITY },
    },
  ],
  colliders: [
    { kind: "box", partId: "mount", halfExtents: vec3(0.05, 0.05, 0.2), sensor: true, mass: 0.1 },
    {
      kind: "box",
      partId: "flap",
      halfExtents: vec3(0.3, 0.025, 0.2),
      transform: { position: vec3(0.35, 0, 0), rotation: QUAT_IDENTITY },
    },
  ],
  anchors: [
    structAnchor("mount.attach", "mount", vec3(-0.05, 0, 0), vec3(-1, 0, 0)),
    jointAnchor("mount.joint", "mount", vec3(0.05, 0, 0), vec3(1, 0, 0), "positive"),
    jointAnchor("flap.joint", "flap", vec3(0.05, 0, 0), vec3(-1, 0, 0), "negative"),
  ],
  joint: {
    kind: "revolute",
    partA: "mount",
    partB: "flap",
    anchorA: "mount.joint",
    anchorB: "flap.joint",
    axis: vec3(0, 0, 1),
    limits: { min: -Math.PI / 6, max: Math.PI / 6 },  // ±30°
    motor: {
      mode: "position",
      targetPosition: 0,
      stiffness: 50,
      damping: 5,
      maxForce: 30,
      input: { action: "flapDeflect", scale: Math.PI / 6 },
      inputTarget: "position",
    },
    collideConnected: false,
  },
};

// ---------------------------------------------------------------------------
// Export all compounds
// ---------------------------------------------------------------------------

export const besiegeCompounds: BlockDefinition[] = [
  wheelCompound,
  propellerCompound,
  jetEngineCompound,
  shockAbsorberCompound,
  armSegmentCompound,
  yawArmSegmentCompound,
  controlSurfaceCompound,
];
