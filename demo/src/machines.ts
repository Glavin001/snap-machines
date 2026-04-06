/**
 * Pre-built machine definitions that demonstrate the snap construction system
 * compiled to Rapier3D physics.
 *
 * Each factory creates a BlockGraph with blocks placed at explicit transforms
 * and connections linking anchors so the compiler can resolve bodies and joints.
 */
import {
  BlockGraph,
  TRANSFORM_IDENTITY,
  vec3,
  transform,
  quatFromAxisAngle,
  RuntimeInputState,
} from "snap-construction-system";

export interface MachinePreset {
  name: string;
  description: string;
  /** Build the block graph for this machine */
  build(): BlockGraph;
  /** Input state to feed every frame (auto-play) */
  autoInput: RuntimeInputState;
  /** Suggested camera position */
  cameraPosition: [number, number, number];
}

// ---------------------------------------------------------------------------
// Utility: transform shorthand
// ---------------------------------------------------------------------------

function t(x: number, y: number, z: number, qx = 0, qy = 0, qz = 0, qw = 1) {
  return { position: vec3(x, y, z), rotation: { x: qx, y: qy, z: qz, w: qw } };
}

function tq(x: number, y: number, z: number, axis: { x: number; y: number; z: number }, angleDeg: number) {
  const q = quatFromAxisAngle(axis, (angleDeg * Math.PI) / 180);
  return { position: vec3(x, y, z), rotation: q };
}

// ---------------------------------------------------------------------------
// 1. Simple 4-Wheel Car
// ---------------------------------------------------------------------------

function buildCar(): BlockGraph {
  const g = new BlockGraph();

  // Chassis: a 5x1 beam at height 2 so wheels clear the ground
  const chassis = g.addNode({ id: "chassis", typeId: "frame.beam.5x1", transform: t(0, 2, 0) });

  // Front-left wheel: motor-wheel on the +Z side at front end of chassis
  // The motor-wheel axle.mount anchor is at (0,0,-0.2) in local space.
  // We want the wheel to sit at chassis anchor zp.l = (-2, 0, 0.5) world offset.
  // The chassis is at (0,2,0), so world position of zp.l is (-2, 2, 0.5).
  // The motor-wheel mounts with its axle.mount flush against the chassis face.
  // Motor-wheel axle.mount is at local (0,0,-0.2), so block origin sits at z + 0.2 from the face.
  const flWheel = g.addNode({
    id: "fl-wheel",
    typeId: "joint.motor.wheel",
    transform: t(-2, 2, 0.7),
  });
  g.addConnection({
    a: { blockId: "chassis", anchorId: "zp.l" },
    b: { blockId: "fl-wheel", anchorId: "axle.mount" },
  });

  // Front-right wheel: on the -Z side, rotated 180 around Y so wheel faces outward
  const frWheel = g.addNode({
    id: "fr-wheel",
    typeId: "joint.motor.wheel",
    transform: tq(-2, 2, -0.7, vec3(0, 1, 0), 180),
  });
  g.addConnection({
    a: { blockId: "chassis", anchorId: "zn.l" },
    b: { blockId: "fr-wheel", anchorId: "axle.mount" },
  });

  // Rear-left wheel
  const rlWheel = g.addNode({
    id: "rl-wheel",
    typeId: "joint.motor.wheel",
    transform: t(2, 2, 0.7),
  });
  g.addConnection({
    a: { blockId: "chassis", anchorId: "zp.r" },
    b: { blockId: "rl-wheel", anchorId: "axle.mount" },
  });

  // Rear-right wheel
  const rrWheel = g.addNode({
    id: "rr-wheel",
    typeId: "joint.motor.wheel",
    transform: tq(2, 2, -0.7, vec3(0, 1, 0), 180),
  });
  g.addConnection({
    a: { blockId: "chassis", anchorId: "zn.r" },
    b: { blockId: "rr-wheel", anchorId: "axle.mount" },
  });

  return g;
}

// ---------------------------------------------------------------------------
// 2. Hinged Walker – a body with hinged legs that flail via motor
// ---------------------------------------------------------------------------

function buildWalker(): BlockGraph {
  const g = new BlockGraph();

  // Central body - plank at height 3
  g.addNode({ id: "body", typeId: "frame.plank.3x1", transform: t(0, 3, 0) });

  // Left front leg: hinge connected to body's -Z face
  // Hinge base connects to body, rotor connects to a leg segment
  g.addNode({
    id: "hinge-lf",
    typeId: "joint.hinge.small",
    transform: t(-1, 3, -0.75),
  });
  g.addConnection({
    a: { blockId: "body", anchorId: "zn.l" },
    b: { blockId: "hinge-lf", anchorId: "base.xn" },
  });

  // Left front leg segment
  g.addNode({
    id: "leg-lf",
    typeId: "frame.cube.1",
    transform: t(-1, 3, -1.75),
  });
  g.addConnection({
    a: { blockId: "hinge-lf", anchorId: "rotor.xp" },
    b: { blockId: "leg-lf", anchorId: "zp" },
  });

  // Right front leg
  g.addNode({
    id: "hinge-rf",
    typeId: "joint.hinge.small",
    transform: t(-1, 3, 0.75),
  });
  g.addConnection({
    a: { blockId: "body", anchorId: "zp.l" },
    b: { blockId: "hinge-rf", anchorId: "base.xn" },
  });
  g.addNode({
    id: "leg-rf",
    typeId: "frame.cube.1",
    transform: t(-1, 3, 1.75),
  });
  g.addConnection({
    a: { blockId: "hinge-rf", anchorId: "rotor.xp" },
    b: { blockId: "leg-rf", anchorId: "zn" },
  });

  // Left rear leg
  g.addNode({
    id: "hinge-lr",
    typeId: "joint.hinge.small",
    transform: t(1, 3, -0.75),
  });
  g.addConnection({
    a: { blockId: "body", anchorId: "zn.r" },
    b: { blockId: "hinge-lr", anchorId: "base.xn" },
  });
  g.addNode({
    id: "leg-lr",
    typeId: "frame.cube.1",
    transform: t(1, 3, -1.75),
  });
  g.addConnection({
    a: { blockId: "hinge-lr", anchorId: "rotor.xp" },
    b: { blockId: "leg-lr", anchorId: "zp" },
  });

  // Right rear leg
  g.addNode({
    id: "hinge-rr",
    typeId: "joint.hinge.small",
    transform: t(1, 3, 0.75),
  });
  g.addConnection({
    a: { blockId: "body", anchorId: "zp.r" },
    b: { blockId: "hinge-rr", anchorId: "base.xn" },
  });
  g.addNode({
    id: "leg-rr",
    typeId: "frame.cube.1",
    transform: t(1, 3, 1.75),
  });
  g.addConnection({
    a: { blockId: "hinge-rr", anchorId: "rotor.xp" },
    b: { blockId: "leg-rr", anchorId: "zn" },
  });

  return g;
}

// ---------------------------------------------------------------------------
// 3. Spinner – a central block with rotating arms, like a propeller on ground
// ---------------------------------------------------------------------------

function buildSpinner(): BlockGraph {
  const g = new BlockGraph();

  // Central hub
  g.addNode({ id: "hub", typeId: "frame.cube.1", transform: t(0, 2, 0) });

  // Hinge on top of hub
  g.addNode({
    id: "hinge-top",
    typeId: "joint.hinge.small",
    transform: tq(0, 2.5, 0, vec3(0, 0, 1), 90),
  });
  g.addConnection({
    a: { blockId: "hub", anchorId: "yp" },
    b: { blockId: "hinge-top", anchorId: "base.xn" },
  });

  // Arm: beam extending from the hinge rotor (long cross-arm)
  g.addNode({
    id: "arm",
    typeId: "frame.beam.5x1",
    transform: tq(0, 3.25, 0, vec3(0, 0, 1), 90),
  });
  g.addConnection({
    a: { blockId: "hinge-top", anchorId: "rotor.xp" },
    b: { blockId: "arm", anchorId: "yn" },
  });

  return g;
}

// ---------------------------------------------------------------------------
// 4. Thruster Rocket – a cube with a thruster that launches upward
// ---------------------------------------------------------------------------

function buildRocket(): BlockGraph {
  const g = new BlockGraph();

  g.addNode({ id: "body", typeId: "frame.cube.1", transform: t(0, 2, 0) });
  // Thruster rotated so its exhaust (local +X) points down (world -Y)
  // Rotate -90 around Z: local X -> world -Y
  g.addNode({
    id: "thruster",
    typeId: "utility.thruster.small",
    transform: tq(0, 1.25, 0, vec3(0, 0, 1), -90),
  });
  g.addConnection({
    a: { blockId: "body", anchorId: "yn" },
    b: { blockId: "thruster", anchorId: "mount" },
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
    description: "A hub with a spinning arm propeller on top.",
    build: buildSpinner,
    autoInput: { hingeSpin: 1 },
    cameraPosition: [5, 4, 5],
  },
  {
    name: "Thruster Rocket",
    description: "A cube with a thruster. Press Space to launch!",
    build: buildRocket,
    autoInput: { throttle: 1 },
    cameraPosition: [4, 3, 5],
  },
];
