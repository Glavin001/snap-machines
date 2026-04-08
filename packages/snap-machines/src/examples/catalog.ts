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

// ---------------------------------------------------------------------------
// House structure blocks
// ---------------------------------------------------------------------------

export const floorBlock: BlockDefinition = {
  id: "structure.floor.4x4",
  name: "Floor 4x4",
  category: "structure",
  mass: 5,
  parts: [{ id: "main", rigidBodyKind: "fixed" }],
  geometry: [{ kind: "box", size: vec3(4, 0.2, 4) }],
  colliders: [{ kind: "box", halfExtents: vec3(2, 0.1, 2) }],
  anchors: [
    sideAnchor("edge.xp", vec3(2, 0.1, 0), vec3(1, 0, 0)),
    sideAnchor("edge.xn", vec3(-2, 0.1, 0), vec3(-1, 0, 0)),
    sideAnchor("edge.zp", vec3(0, 0.1, 2), vec3(0, 0, 1)),
    sideAnchor("edge.zn", vec3(0, 0.1, -2), vec3(0, 0, -1)),
  ],
};

export const wallBlock: BlockDefinition = {
  id: "structure.wall.4x3",
  name: "Wall 4x3",
  category: "structure",
  mass: 3,
  geometry: [{ kind: "box", size: vec3(4, 3, 0.2) }],
  colliders: [{ kind: "box", halfExtents: vec3(2, 1.5, 0.1) }],
  anchors: [
    sideAnchor("bottom", vec3(0, -1.5, -0.1), vec3(0, 0, -1)),
    sideAnchor("top", vec3(0, 1.5, -0.1), vec3(0, 0, -1)),
    sideAnchor("left", vec3(-2, 0, 0), vec3(-1, 0, 0)),
    sideAnchor("right", vec3(2, 0, 0), vec3(1, 0, 0)),
  ],
};

export const roofBlock: BlockDefinition = {
  id: "structure.roof.4x4",
  name: "Roof 4x4",
  category: "structure",
  mass: 5,
  geometry: [{ kind: "box", size: vec3(4, 0.2, 4) }],
  colliders: [{ kind: "box", halfExtents: vec3(2, 0.1, 2) }],
  anchors: [
    sideAnchor("edge.xp", vec3(2, -0.1, 0), vec3(1, 0, 0)),
    sideAnchor("edge.xn", vec3(-2, -0.1, 0), vec3(-1, 0, 0)),
    sideAnchor("edge.zp", vec3(0, -0.1, 2), vec3(0, 0, 1)),
    sideAnchor("edge.zn", vec3(0, -0.1, -2), vec3(0, 0, -1)),
  ],
};

/**
 * Compound wall block with a hinged door.
 *
 * The "frame" part is made of three box colliders that form a doorway cutout
 * (left pillar, right pillar, header). The "door" part is a thin panel that
 * sits in the opening, connected via a free-spinning revolute joint so it
 * can be pushed open.
 */
export const wallDoorBlock: BlockDefinition = {
  id: "structure.wall-door.4x3",
  name: "Wall 4x3 with Door",
  category: "structure",
  parts: [
    { id: "frame", mass: 2.5 },
    { id: "door", mass: 0.5 },
  ],
  geometry: [
    // Frame – left section
    {
      kind: "box",
      partId: "frame",
      size: vec3(1.2, 3, 0.2),
      transform: { position: vec3(-1.4, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) },
    },
    // Frame – right section
    {
      kind: "box",
      partId: "frame",
      size: vec3(1.2, 3, 0.2),
      transform: { position: vec3(1.4, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) },
    },
    // Frame – header above door
    {
      kind: "box",
      partId: "frame",
      size: vec3(1.6, 0.6, 0.2),
      transform: { position: vec3(0, 1.2, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) },
    },
    // Door panel
    {
      kind: "box",
      partId: "door",
      size: vec3(1.6, 2.4, 0.1),
      transform: { position: vec3(0, -0.3, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) },
    },
  ],
  colliders: [
    // Frame – left section
    {
      kind: "box",
      partId: "frame",
      halfExtents: vec3(0.6, 1.5, 0.1),
      transform: { position: vec3(-1.4, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) },
    },
    // Frame – right section
    {
      kind: "box",
      partId: "frame",
      halfExtents: vec3(0.6, 1.5, 0.1),
      transform: { position: vec3(1.4, 0, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) },
    },
    // Frame – header above door
    {
      kind: "box",
      partId: "frame",
      halfExtents: vec3(0.8, 0.3, 0.1),
      transform: { position: vec3(0, 1.2, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) },
    },
    // Door panel (slightly thinner than the frame)
    {
      kind: "box",
      partId: "door",
      halfExtents: vec3(0.8, 1.2, 0.05),
      transform: { position: vec3(0, -0.3, 0), rotation: lookRotation(vec3(0, 0, 1), VEC3_Y) },
    },
  ],
  anchors: [
    // Structural anchors on the frame (same layout as plain wall)
    {
      id: "bottom",
      partId: "frame",
      position: vec3(0, -1.5, -0.1),
      normal: vec3(0, 0, -1),
      orientation: lookRotation(vec3(0, 0, -1), VEC3_Y),
      type: "struct",
    },
    {
      id: "top",
      partId: "frame",
      position: vec3(0, 1.5, -0.1),
      normal: vec3(0, 0, -1),
      orientation: lookRotation(vec3(0, 0, -1), VEC3_Y),
      type: "struct",
    },
    {
      id: "left",
      partId: "frame",
      position: vec3(-2, 0, 0),
      normal: vec3(-1, 0, 0),
      orientation: lookRotation(vec3(-1, 0, 0), VEC3_Y),
      type: "struct",
    },
    {
      id: "right",
      partId: "frame",
      position: vec3(2, 0, 0),
      normal: vec3(1, 0, 0),
      orientation: lookRotation(vec3(1, 0, 0), VEC3_Y),
      type: "struct",
    },
    // Internal joint anchors for door hinge (at left edge of doorway)
    {
      id: "frame.joint",
      partId: "frame",
      position: vec3(-0.8, -0.3, 0),
      normal: vec3(0, 0, 1),
      orientation: lookRotation(vec3(0, 0, 1), VEC3_Y),
      type: "joint",
      polarity: "positive",
    },
    {
      id: "door.joint",
      partId: "door",
      position: vec3(-0.8, -0.3, 0),
      normal: vec3(0, 0, -1),
      orientation: lookRotation(vec3(0, 0, -1), VEC3_Y),
      type: "joint",
      polarity: "negative",
    },
  ],
  joint: {
    kind: "revolute",
    partA: "frame",
    partB: "door",
    anchorA: "frame.joint",
    anchorB: "door.joint",
    axis: vec3(0, 1, 0),
    // No motor – the door swings freely
  },
};

export const exampleCatalog: BlockDefinition[] = [
  frameCubeBlock,
  hingeBlock,
  thrusterBlock,
  floorBlock,
  wallBlock,
  roofBlock,
  wallDoorBlock,
];
