/**
 * Extended block catalog for the demo, adding structural beams and motor-wheel
 * blocks on top of the core example catalog.
 */
import { BlockDefinition, vec3, lookRotation, VEC3_Y, VEC3_Z } from "snap-construction-system";
import { exampleCatalog } from "snap-construction-system/examples/catalog.js";

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

/** 3x1x1 plank – good for short chassis or arms */
export const plankBlock: BlockDefinition = {
  id: "frame.plank.3x1",
  name: "Plank 3x1",
  category: "structure",
  mass: 3,
  geometry: [{ kind: "box", size: vec3(3, 1, 1) }],
  colliders: [{ kind: "box", halfExtents: vec3(1.5, 0.5, 0.5) }],
  anchors: [
    sideAnchor("xp", vec3(1.5, 0, 0), vec3(1, 0, 0)),
    sideAnchor("xn", vec3(-1.5, 0, 0), vec3(-1, 0, 0)),
    sideAnchor("yp", vec3(0, 0.5, 0), vec3(0, 1, 0)),
    sideAnchor("yn", vec3(0, -0.5, 0), vec3(0, -1, 0)),
    sideAnchor("zp", vec3(0, 0, 0.5), vec3(0, 0, 1)),
    sideAnchor("zn", vec3(0, 0, -0.5), vec3(0, 0, -1)),
    // Along length
    sideAnchor("yn.l", vec3(-1, -0.5, 0), vec3(0, -1, 0)),
    sideAnchor("yn.r", vec3(1, -0.5, 0), vec3(0, -1, 0)),
    sideAnchor("yp.l", vec3(-1, 0.5, 0), vec3(0, 1, 0)),
    sideAnchor("yp.r", vec3(1, 0.5, 0), vec3(0, 1, 0)),
    sideAnchor("zp.l", vec3(-1, 0, 0.5), vec3(0, 0, 1)),
    sideAnchor("zp.r", vec3(1, 0, 0.5), vec3(0, 0, 1)),
    sideAnchor("zn.l", vec3(-1, 0, -0.5), vec3(0, 0, -1)),
    sideAnchor("zn.r", vec3(1, 0, -0.5), vec3(0, 0, -1)),
  ],
};

/** 5x1x1 beam – good for long chassis */
export const beamBlock: BlockDefinition = {
  id: "frame.beam.5x1",
  name: "Beam 5x1",
  category: "structure",
  mass: 5,
  geometry: [{ kind: "box", size: vec3(5, 1, 1) }],
  colliders: [{ kind: "box", halfExtents: vec3(2.5, 0.5, 0.5) }],
  anchors: [
    sideAnchor("xp", vec3(2.5, 0, 0), vec3(1, 0, 0)),
    sideAnchor("xn", vec3(-2.5, 0, 0), vec3(-1, 0, 0)),
    sideAnchor("yp", vec3(0, 0.5, 0), vec3(0, 1, 0)),
    sideAnchor("yn", vec3(0, -0.5, 0), vec3(0, -1, 0)),
    sideAnchor("zp", vec3(0, 0, 0.5), vec3(0, 0, 1)),
    sideAnchor("zn", vec3(0, 0, -0.5), vec3(0, 0, -1)),
    // Along length (sides)
    sideAnchor("zp.l", vec3(-2, 0, 0.5), vec3(0, 0, 1)),
    sideAnchor("zp.r", vec3(2, 0, 0.5), vec3(0, 0, 1)),
    sideAnchor("zn.l", vec3(-2, 0, -0.5), vec3(0, 0, -1)),
    sideAnchor("zn.r", vec3(2, 0, -0.5), vec3(0, 0, -1)),
    // Along length (top/bottom)
    sideAnchor("yn.l", vec3(-2, -0.5, 0), vec3(0, -1, 0)),
    sideAnchor("yn.r", vec3(2, -0.5, 0), vec3(0, -1, 0)),
    sideAnchor("yp.l", vec3(-2, 0.5, 0), vec3(0, 1, 0)),
    sideAnchor("yp.r", vec3(2, 0.5, 0), vec3(0, 1, 0)),
  ],
};

/**
 * Motor-wheel block – a revolute joint with a velocity motor.
 *
 * Mounts via "axle.mount" on the side of a chassis (Z-face). The wheel
 * cylinder has radius 0.8 so it extends 0.3 below a 1-unit-tall chassis,
 * letting the car ride on its wheels without the chassis dragging.
 *
 * Joint axis is local Z, which becomes world Z when side-mounted. The wheel
 * spins around Z and rolls along X.
 */
export const motorWheelBlock: BlockDefinition = {
  id: "joint.motor.wheel",
  name: "Motor Wheel",
  category: "joints",
  parts: [
    { id: "axle", mass: 0.5 },
    { id: "wheel", mass: 1.5 },
  ],
  geometry: [
    {
      kind: "box",
      partId: "axle",
      size: vec3(0.3, 0.3, 0.3),
    },
    {
      kind: "cylinder",
      partId: "wheel",
      radius: 0.8,
      halfHeight: 0.15,
      axis: "z",
      transform: { position: vec3(0, 0, 0.3), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) },
    },
  ],
  colliders: [
    {
      kind: "box",
      partId: "axle",
      halfExtents: vec3(0.15, 0.15, 0.15),
    },
    {
      kind: "cylinder",
      partId: "wheel",
      radius: 0.8,
      halfHeight: 0.15,
      axis: "z",
      friction: 2.0,
      transform: { position: vec3(0, 0, 0.3), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) },
    },
  ],
  anchors: [
    {
      id: "axle.mount",
      partId: "axle",
      position: vec3(0, 0, -0.15),
      normal: vec3(0, 0, -1),
      orientation: lookRotation(vec3(0, 0, -1), VEC3_Y),
      type: "struct",
    },
    {
      id: "axle.joint",
      partId: "axle",
      position: vec3(0, 0, 0.15),
      normal: vec3(0, 0, 1),
      orientation: lookRotation(vec3(0, 0, 1), VEC3_Y),
      type: "joint",
      polarity: "positive",
    },
    {
      id: "wheel.joint",
      partId: "wheel",
      position: vec3(0, 0, 0.15),
      normal: vec3(0, 0, -1),
      orientation: lookRotation(vec3(0, 0, -1), VEC3_Y),
      type: "joint",
      polarity: "negative",
    },
  ],
  joint: {
    kind: "revolute",
    partA: "axle",
    partB: "wheel",
    anchorA: "axle.joint",
    anchorB: "wheel.joint",
    axis: vec3(0, 0, 1),
    motor: {
      mode: "velocity",
      targetVelocity: 5,
      damping: 10,
      stiffness: 0,
      maxForce: 100,
      input: { action: "motorSpin", scale: 5 },
      inputTarget: "velocity",
    },
    collideConnected: false,
  },
};

/**
 * Upward thruster – designed for bottom-mounting.
 *
 * Note: The behavior system applies localDirection in body-local space (which
 * starts at identity = world space), NOT in block-local space. So for a
 * bottom-mounted thruster that should push upward, we use (0,1,0) directly.
 */
export const thrusterUpBlock: BlockDefinition = {
  id: "utility.thruster.up",
  name: "Thruster (Up)",
  category: "utility",
  mass: 0.5,
  geometry: [{ kind: "box", size: vec3(1, 0.5, 0.5) }],
  colliders: [{ kind: "box", halfExtents: vec3(0.5, 0.25, 0.25) }],
  anchors: [
    {
      id: "mount",
      position: vec3(-0.5, 0, 0),
      normal: vec3(-1, 0, 0),
      orientation: lookRotation(vec3(-1, 0, 0), VEC3_Y),
      type: "struct",
    },
  ],
  behaviors: [
    {
      kind: "thruster",
      props: {
        force: 30,
        localDirection: { x: 0, y: 1, z: 0 },
        localPoint: { x: 0, y: -0.33, z: 0 },
      },
      input: { action: "throttle", scale: 1 },
    },
  ],
};

/** All demo blocks: core + extended */
export const demoCatalog: BlockDefinition[] = [
  ...exampleCatalog,
  plankBlock,
  beamBlock,
  motorWheelBlock,
  thrusterUpBlock,
];
