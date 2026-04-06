import { BlockDefinition } from "../schema.js";
import { VEC3_X, VEC3_Y, VEC3_Z, lookRotation, vec3 } from "../math.js";

function sideAnchor(id: string, position: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }) {
  return {
    id,
    position,
    normal,
    orientation: lookRotation(normal, Math.abs(normal.y) > 0.99 ? VEC3_Z : VEC3_Y),
    type: "struct",
  } as const;
}

export const frameCubeBlock: BlockDefinition = {
  id: "frame.cube.1",
  name: "Frame Cube 1x1",
  category: "structure",
  mass: 1,
  geometry: [
    {
      kind: "box",
      size: vec3(1, 1, 1),
    },
  ],
  colliders: [
    {
      kind: "box",
      halfExtents: vec3(0.5, 0.5, 0.5),
    },
  ],
  anchors: [
    sideAnchor("xp", vec3(0.5, 0, 0), vec3(1, 0, 0)),
    sideAnchor("xn", vec3(-0.5, 0, 0), vec3(-1, 0, 0)),
    sideAnchor("yp", vec3(0, 0.5, 0), vec3(0, 1, 0)),
    sideAnchor("yn", vec3(0, -0.5, 0), vec3(0, -1, 0)),
    sideAnchor("zp", vec3(0, 0, 0.5), vec3(0, 0, 1)),
    sideAnchor("zn", vec3(0, 0, -0.5), vec3(0, 0, -1)),
  ],
};

export const hingeBlock: BlockDefinition = {
  id: "joint.hinge.small",
  name: "Small Hinge",
  category: "joints",
  parts: [
    { id: "base", mass: 0.75 },
    { id: "rotor", mass: 0.75 },
  ],
  geometry: [
    {
      kind: "box",
      partId: "base",
      size: vec3(1, 0.25, 0.5),
      transform: { position: vec3(-0.25, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) },
    },
    {
      kind: "box",
      partId: "rotor",
      size: vec3(1, 0.25, 0.5),
      transform: { position: vec3(0.25, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) },
    },
  ],
  colliders: [
    {
      kind: "box",
      partId: "base",
      halfExtents: vec3(0.5, 0.125, 0.25),
      transform: { position: vec3(-0.25, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) },
    },
    {
      kind: "box",
      partId: "rotor",
      halfExtents: vec3(0.5, 0.125, 0.25),
      transform: { position: vec3(0.25, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) },
    },
  ],
  anchors: [
    {
      id: "base.xn",
      partId: "base",
      position: vec3(-0.75, 0, 0),
      normal: vec3(-1, 0, 0),
      orientation: lookRotation(vec3(-1, 0, 0), VEC3_Y),
      type: "struct",
    },
    {
      id: "base.joint",
      partId: "base",
      position: vec3(0, 0, 0),
      normal: vec3(1, 0, 0),
      orientation: lookRotation(vec3(1, 0, 0), VEC3_Y),
      type: "joint",
      polarity: "positive",
    },
    {
      id: "rotor.joint",
      partId: "rotor",
      position: vec3(0, 0, 0),
      normal: vec3(-1, 0, 0),
      orientation: lookRotation(vec3(-1, 0, 0), VEC3_Y),
      type: "joint",
      polarity: "negative",
    },
    {
      id: "rotor.xp",
      partId: "rotor",
      position: vec3(0.75, 0, 0),
      normal: vec3(1, 0, 0),
      orientation: lookRotation(vec3(1, 0, 0), VEC3_Y),
      type: "struct",
    },
  ],
  joint: {
    kind: "revolute",
    partA: "base",
    partB: "rotor",
    anchorA: "base.joint",
    anchorB: "rotor.joint",
    axis: vec3(0, 1, 0),
    motor: {
      mode: "velocity",
      targetVelocity: 0,
      damping: 2,
      stiffness: 10,
      input: { action: "hingeSpin", scale: 12 },
      inputTarget: "velocity",
    },
  },
};

export const thrusterBlock: BlockDefinition = {
  id: "utility.thruster.small",
  name: "Small Thruster",
  category: "utility",
  mass: 0.5,
  geometry: [
    {
      kind: "box",
      size: vec3(1, 0.5, 0.5),
    },
  ],
  colliders: [
    {
      kind: "box",
      halfExtents: vec3(0.5, 0.25, 0.25),
    },
  ],
  anchors: [
    {
      id: "mount",
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
      polarity: "positive",
    },
  ],
  behaviors: [
    {
      kind: "thruster",
      props: {
        force: 25,
        localDirection: { x: 1, y: 0, z: 0 },
        localPoint: { x: 0.5, y: 0, z: 0 },
      },
      input: { action: "throttle", scale: 1 },
    },
  ],
};

export const exampleCatalog: BlockDefinition[] = [frameCubeBlock, hingeBlock, thrusterBlock];
