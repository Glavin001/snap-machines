/**
 * Medieval Stone Fortress Structures Catalog
 *
 * A comprehensive set of medieval castle/fortress building blocks featuring:
 * - Tier 1: Individual stone bricks (snapable on all 6 faces)
 * - Tier 2: Pre-built wall segments and tower sections
 * - Tier 3: Major structures (10 types) that compose into complete fortresses
 *
 * All pieces feature medieval stone aesthetic with appropriate mass, friction,
 * and anchor systems for composability.
 */

import { BlockDefinition, vec3, lookRotation, VEC3_Y, VEC3_Z, QUAT_IDENTITY } from "@snap-machines/core";

const VEC3_X = vec3(1, 0, 0);
const VEC3_NEG_X = vec3(-1, 0, 0);
const VEC3_NEG_Y = vec3(0, -1, 0);
const VEC3_NEG_Z = vec3(0, 0, -1);

/**
 * Helper to create structural anchors on a box's faces.
 * Automatically calculates orientation based on normal direction.
 */
function stoneBrickAnchor(
  id: string,
  position: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
) {
  return {
    id,
    position,
    normal,
    orientation: lookRotation(normal, Math.abs(normal.y) > 0.99 ? VEC3_Z : VEC3_Y),
    type: "struct:stone",
  } as const;
}

// ---------------------------------------------------------------------------
// Tier 1: Basic Building Block
// ---------------------------------------------------------------------------

/**
 * Individual stone brick – 1×1×1 unit
 * Fully snapable on all 6 faces for free-form brick-by-brick construction.
 * Mass: 3kg (realistic for a stone brick)
 */
export const stoneBrick: BlockDefinition = {
  id: "stone.brick.1x1",
  name: "Stone Brick",
  category: "Medieval Stone",
  mass: 3,
  geometry: [{ kind: "box", size: vec3(1, 1, 1) }],
  colliders: [
    {
      kind: "box",
      halfExtents: vec3(0.5, 0.5, 0.5),
      friction: 0.8,
      restitution: 0.1,
    },
  ],
  anchors: [
    // All 6 faces for free-form snapping
    stoneBrickAnchor("xp", vec3(0.5, 0, 0), vec3(1, 0, 0)),
    stoneBrickAnchor("xn", vec3(-0.5, 0, 0), VEC3_NEG_X),
    stoneBrickAnchor("yp", vec3(0, 0.5, 0), VEC3_Y),
    stoneBrickAnchor("yn", vec3(0, -0.5, 0), VEC3_NEG_Y),
    stoneBrickAnchor("zp", vec3(0, 0, 0.5), VEC3_Z),
    stoneBrickAnchor("zn", vec3(0, 0, -0.5), VEC3_NEG_Z),
  ],
};

// ---------------------------------------------------------------------------
// Tier 2: Pre-built Wall Segments and Tower Sections
// ---------------------------------------------------------------------------

/**
 * Straight wall segment – 3 units long, 2 units tall, 1 unit deep
 * Equivalent to ~12 bricks, but sold as pre-built for faster fortress construction.
 */
export const wallSegmentStraight: BlockDefinition = {
  id: "wall.segment.straight.3x2",
  name: "Stone Wall Segment (3×2)",
  category: "Medieval Stone",
  mass: 12,
  geometry: [{ kind: "box", size: vec3(3, 2, 1) }],
  colliders: [
    {
      kind: "box",
      halfExtents: vec3(1.5, 1, 0.5),
      friction: 0.8,
      restitution: 0.1,
    },
  ],
  anchors: [
    // Left face (negative X) – receives from right
    stoneBrickAnchor("left", vec3(-1.5, 0, 0), VEC3_NEG_X),
    // Right face (positive X) – sends to left
    stoneBrickAnchor("right", vec3(1.5, 0, 0), VEC3_X),
    // Top face – for crenellations, towers
    stoneBrickAnchor("top", vec3(0, 1, 0), VEC3_Y),
    // Bottom face – for stacking, foundation
    stoneBrickAnchor("bottom", vec3(0, -1, 0), VEC3_NEG_Y),
    // Front/back for perpendicular attachments
    stoneBrickAnchor("front", vec3(0, 0, 0.5), VEC3_Z),
    stoneBrickAnchor("back", vec3(0, 0, -0.5), VEC3_NEG_Z),
  ],
};

/**
 * Corner wall segment – 90° corner piece
 * Allows perpendicular walls to connect smoothly.
 */
export const wallSegmentCorner: BlockDefinition = {
  id: "wall.segment.corner.2x2",
  name: "Stone Wall Corner (2×2)",
  category: "Medieval Stone",
  mass: 12,
  geometry: [
    {
      kind: "box",
      size: vec3(2, 2, 1),
      transform: { position: vec3(0, 0, 0), rotation: QUAT_IDENTITY },
    },
  ],
  colliders: [
    {
      kind: "box",
      halfExtents: vec3(1, 1, 0.5),
      friction: 0.8,
      restitution: 0.1,
    },
  ],
  anchors: [
    // Two outward-facing anchors for perpendicular walls
    stoneBrickAnchor("xn", vec3(-1, 0, 0), VEC3_NEG_X),
    stoneBrickAnchor("zn", vec3(0, 0, -1), VEC3_NEG_Z),
    // Top for crenellations
    stoneBrickAnchor("top", vec3(0, 1, 0), VEC3_Y),
    // Bottom for stacking
    stoneBrickAnchor("bottom", vec3(0, -1, 0), VEC3_NEG_Y),
  ],
};

/**
 * Tower base section – 2×2 footprint, 2 units tall
 * Stacks vertically to build towers.
 */
export const towerBaseSection: BlockDefinition = {
  id: "tower.base.section.2x2",
  name: "Tower Base Section (2×2)",
  category: "Medieval Stone",
  mass: 20,
  geometry: [{ kind: "box", size: vec3(2, 2, 2) }],
  colliders: [
    {
      kind: "box",
      halfExtents: vec3(1, 1, 1),
      friction: 0.8,
      restitution: 0.1,
    },
  ],
  anchors: [
    // 4 side anchors for wall attachment
    stoneBrickAnchor("xp", vec3(1, 0, 0), VEC3_X),
    stoneBrickAnchor("xn", vec3(-1, 0, 0), VEC3_NEG_X),
    stoneBrickAnchor("zp", vec3(0, 0, 1), VEC3_Z),
    stoneBrickAnchor("zn", vec3(0, 0, -1), VEC3_NEG_Z),
    // Vertical anchors for stacking tower sections
    stoneBrickAnchor("top", vec3(0, 1, 0), VEC3_Y),
    stoneBrickAnchor("bottom", vec3(0, -1, 0), VEC3_NEG_Y),
  ],
};

// ---------------------------------------------------------------------------
// Tier 3: Major Structures (10 Core Types)
// ---------------------------------------------------------------------------

/**
 * Square tower – tall defensive structure with 2×2 footprint
 * Can stack multiple tower sections or snap a crenellation on top.
 */
export const squareTower: BlockDefinition = {
  id: "tower.square.tall.2x2",
  name: "Square Tower (2×2×4)",
  category: "Medieval Stone",
  mass: 40,
  geometry: [{ kind: "box", size: vec3(2, 4, 2) }],
  colliders: [
    {
      kind: "box",
      halfExtents: vec3(1, 2, 1),
      friction: 0.8,
      restitution: 0.1,
    },
  ],
  anchors: [
    // 4 side anchors for wall attachment
    stoneBrickAnchor("xp", vec3(1, 0, 0), VEC3_X),
    stoneBrickAnchor("xn", vec3(-1, 0, 0), VEC3_NEG_X),
    stoneBrickAnchor("zp", vec3(0, 0, 1), VEC3_Z),
    stoneBrickAnchor("zn", vec3(0, 0, -1), VEC3_NEG_Z),
    // Vertical anchors
    stoneBrickAnchor("top", vec3(0, 2, 0), VEC3_Y),
    stoneBrickAnchor("bottom", vec3(0, -2, 0), VEC3_NEG_Y),
  ],
};

/**
 * Round tower – cylindrical defensive structure
 * Visually distinctive and provides 360° defense.
 */
export const roundTower: BlockDefinition = {
  id: "tower.round.tall.2x2",
  name: "Round Tower (Radius 1.2, Height 4)",
  category: "Medieval Stone",
  mass: 40,
  geometry: [
    {
      kind: "cylinder",
      radius: 1.2,
      halfHeight: 2,
      axis: "y",
    },
  ],
  colliders: [
    {
      kind: "cylinder",
      radius: 1.2,
      halfHeight: 2,
      axis: "y",
      friction: 0.8,
      restitution: 0.1,
    },
  ],
  anchors: [
    // Cardinal direction anchors for wall attachment
    stoneBrickAnchor("north", vec3(0, 0, -1.2), VEC3_NEG_Z),
    stoneBrickAnchor("south", vec3(0, 0, 1.2), VEC3_Z),
    stoneBrickAnchor("east", vec3(1.2, 0, 0), VEC3_X),
    stoneBrickAnchor("west", vec3(-1.2, 0, 0), VEC3_NEG_X),
    // Vertical anchors
    stoneBrickAnchor("top", vec3(0, 2, 0), VEC3_Y),
    stoneBrickAnchor("bottom", vec3(0, -2, 0), VEC3_NEG_Y),
  ],
};

/**
 * Gatehouse tower – large tower with an opening at the base for a gate
 * Designed to mount a drawbridge and/or portcullis.
 */
export const gatehouseTower: BlockDefinition = {
  id: "tower.gatehouse.3x3",
  name: "Gatehouse Tower (3×3×5)",
  category: "Medieval Stone",
  mass: 60,
  geometry: [
    {
      kind: "box",
      size: vec3(3, 5, 3),
      transform: { position: vec3(0, 0, 0), rotation: QUAT_IDENTITY },
    },
    // Small roof/crenellation preview at top
    {
      kind: "box",
      size: vec3(3.2, 0.5, 3.2),
      transform: { position: vec3(0, 2.5, 0), rotation: QUAT_IDENTITY },
    },
  ],
  colliders: [
    {
      kind: "box",
      halfExtents: vec3(1.5, 2.5, 1.5),
      friction: 0.8,
      restitution: 0.1,
    },
  ],
  anchors: [
    // Side anchors for wall connection
    stoneBrickAnchor("xp", vec3(1.5, 0, 0), VEC3_X),
    stoneBrickAnchor("xn", vec3(-1.5, 0, 0), VEC3_NEG_X),
    stoneBrickAnchor("zp", vec3(0, 0, 1.5), VEC3_Z),
    stoneBrickAnchor("zn", vec3(0, 0, -1.5), VEC3_NEG_Z),
    // Gate anchors (for drawbridge/portcullis)
    stoneBrickAnchor("gate.top", vec3(0, 1.5, 0), VEC3_Y),
    stoneBrickAnchor("gate.bottom", vec3(0, -1, 0), VEC3_NEG_Y),
    // Top for crenellations
    stoneBrickAnchor("top", vec3(0, 2.5, 0), VEC3_Y),
    // Bottom for foundation
    stoneBrickAnchor("bottom", vec3(0, -2.5, 0), VEC3_NEG_Y),
  ],
};

/**
 * Crenellation/Battlement top – snaps on top of walls for defensive lookout positions
 * Creates the iconic castle battlement appearance.
 */
export const crenellationTop: BlockDefinition = {
  id: "crenellation.top.3x1",
  name: "Crenellation Top (3×1)",
  category: "Medieval Stone",
  mass: 6,
  geometry: [
    {
      kind: "box",
      size: vec3(3, 1, 1),
      transform: { position: vec3(0, 0, -0.25), rotation: QUAT_IDENTITY },
    },
    // Merlons (the up-bits)
    {
      kind: "box",
      size: vec3(0.4, 1, 0.2),
      transform: { position: vec3(-1.3, 0.5, -0.5), rotation: QUAT_IDENTITY },
    },
    {
      kind: "box",
      size: vec3(0.4, 1, 0.2),
      transform: { position: vec3(1.3, 0.5, -0.5), rotation: QUAT_IDENTITY },
    },
  ],
  colliders: [
    {
      kind: "box",
      halfExtents: vec3(1.5, 0.5, 0.5),
      friction: 0.8,
      restitution: 0.1,
    },
  ],
  anchors: [
    // Bottom anchor for mounting on wall top
    stoneBrickAnchor("bottom", vec3(0, -0.5, 0), VEC3_NEG_Y),
    // Side anchors for chaining crenellations
    stoneBrickAnchor("xp", vec3(1.5, 0, -0.25), VEC3_X),
    stoneBrickAnchor("xn", vec3(-1.5, 0, -0.25), VEC3_NEG_X),
  ],
};

/**
 * Drawbridge – 2-part hinged structure
 * Base attaches to gatehouse, bridge deck rotates up (revolute joint with motor).
 * Can be controlled in play mode to raise/lower the bridge.
 */
export const drawBridge: BlockDefinition = {
  id: "gate.drawbridge.3x1",
  name: "Drawbridge (3×1)",
  category: "Medieval Stone",
  parts: [
    { id: "base", mass: 8 },
    { id: "bridge_deck", mass: 6 },
  ],
  geometry: [
    {
      kind: "box",
      partId: "base",
      size: vec3(3, 0.5, 1),
      transform: { position: vec3(0, 0, 0), rotation: QUAT_IDENTITY },
    },
    {
      kind: "box",
      partId: "bridge_deck",
      size: vec3(3, 0.3, 1),
      transform: { position: vec3(0, 0.25, 0), rotation: QUAT_IDENTITY },
    },
  ],
  colliders: [
    {
      kind: "box",
      partId: "base",
      halfExtents: vec3(1.5, 0.25, 0.5),
      friction: 0.8,
      restitution: 0.1,
    },
    {
      kind: "box",
      partId: "bridge_deck",
      halfExtents: vec3(1.5, 0.15, 0.5),
      friction: 0.8,
      restitution: 0.1,
    },
  ],
  anchors: [
    {
      id: "base.front",
      partId: "base",
      position: vec3(0, 0, 0.5),
      normal: vec3(0, 0, 1),
      orientation: lookRotation(vec3(0, 0, 1), VEC3_Y),
      type: "struct:stone",
    },
    {
      id: "base.back",
      partId: "base",
      position: vec3(0, 0, -0.5),
      normal: vec3(0, 0, -1),
      orientation: lookRotation(VEC3_NEG_Z, VEC3_Y),
      type: "struct:stone",
    },
    {
      id: "base.joint",
      partId: "base",
      position: vec3(0, 0, 0),
      normal: vec3(0, 1, 0),
      orientation: lookRotation(VEC3_Y, VEC3_Z),
      type: "joint",
      polarity: "positive",
    },
    {
      id: "deck.joint",
      partId: "bridge_deck",
      position: vec3(0, 0, 0),
      normal: vec3(0, -1, 0),
      orientation: lookRotation(VEC3_NEG_Y, VEC3_Z),
      type: "joint",
      polarity: "negative",
    },
  ],
  joint: {
    kind: "revolute",
    partA: "base",
    partB: "bridge_deck",
    anchorA: "base.joint",
    anchorB: "deck.joint",
    axis: vec3(1, 0, 0),  // Rotate around X axis (hinge along length)
    limits: { min: 0, max: Math.PI / 2 },  // 0-90 degrees
    motor: {
      mode: "velocity",
      targetVelocity: 0,
      damping: 5,
      stiffness: 20,
      maxForce: 50,
      input: { action: "drawbridgeLift", scale: 3 },
      inputTarget: "velocity",
    },
    collideConnected: false,
  },
};

/**
 * Portcullis (murder hole gate) – 2-part sliding structure
 * Frame attaches to gatehouse, gate slides vertically (prismatic joint with motor).
 * Can be controlled in play mode to open/close.
 */
export const portcullis: BlockDefinition = {
  id: "gate.portcullis.3x2",
  name: "Portcullis (3×2)",
  category: "Medieval Stone",
  parts: [
    { id: "frame", mass: 10 },
    { id: "gate", mass: 8 },
  ],
  geometry: [
    {
      kind: "box",
      partId: "frame",
      size: vec3(3, 0.3, 0.3),
      transform: { position: vec3(0, 1, 0), rotation: QUAT_IDENTITY },
    },
    {
      kind: "box",
      partId: "gate",
      size: vec3(3, 2, 0.2),
      transform: { position: vec3(0, 0, 0), rotation: QUAT_IDENTITY },
    },
  ],
  colliders: [
    {
      kind: "box",
      partId: "frame",
      halfExtents: vec3(1.5, 0.15, 0.15),
      friction: 0.8,
      restitution: 0.1,
    },
    {
      kind: "box",
      partId: "gate",
      halfExtents: vec3(1.5, 1, 0.1),
      friction: 0.8,
      restitution: 0.1,
    },
  ],
  anchors: [
    {
      id: "frame.top",
      partId: "frame",
      position: vec3(0, 1, 0),
      normal: vec3(0, 1, 0),
      orientation: lookRotation(VEC3_Y, VEC3_Z),
      type: "struct:stone",
    },
    {
      id: "frame.joint",
      partId: "frame",
      position: vec3(0, 0.5, 0),
      normal: vec3(0, -1, 0),
      orientation: lookRotation(VEC3_NEG_Y, VEC3_Z),
      type: "joint",
      polarity: "positive",
    },
    {
      id: "gate.joint",
      partId: "gate",
      position: vec3(0, 1, 0),
      normal: vec3(0, 1, 0),
      orientation: lookRotation(VEC3_Y, VEC3_Z),
      type: "joint",
      polarity: "negative",
    },
  ],
  joint: {
    kind: "prismatic",
    partA: "frame",
    partB: "gate",
    anchorA: "frame.joint",
    anchorB: "gate.joint",
    axis: vec3(0, 1, 0),  // Slide vertically
    limits: { min: -2, max: 0 },  // Fully open (down) to closed (up)
    motor: {
      mode: "velocity",
      targetVelocity: 0,
      damping: 10,
      stiffness: 20,
      maxForce: 80,
      input: { action: "portcullisSlide", scale: 2 },
      inputTarget: "velocity",
    },
    collideConnected: false,
  },
};

/**
 * Stairs/Ramp – access structure that snaps to walls
 * Allows movement between different fortress levels.
 */
export const stairs: BlockDefinition = {
  id: "access.stairs.2x1",
  name: "Stone Stairs (2×1×2)",
  category: "Medieval Stone",
  mass: 10,
  geometry: [
    {
      kind: "box",
      size: vec3(1, 0.3, 0.3),
      transform: { position: vec3(-0.5, -0.6, 0), rotation: QUAT_IDENTITY },
    },
    {
      kind: "box",
      size: vec3(1, 0.3, 0.3),
      transform: { position: vec3(-0.5, -0.2, 0), rotation: QUAT_IDENTITY },
    },
    {
      kind: "box",
      size: vec3(1, 0.3, 0.3),
      transform: { position: vec3(-0.5, 0.2, 0), rotation: QUAT_IDENTITY },
    },
    {
      kind: "box",
      size: vec3(1, 0.3, 0.3),
      transform: { position: vec3(-0.5, 0.6, 0), rotation: QUAT_IDENTITY },
    },
  ],
  colliders: [
    {
      kind: "box",
      halfExtents: vec3(0.5, 0.15, 0.15),
      friction: 1.2,  // Higher friction for stairs
      restitution: 0.1,
      transform: { position: vec3(-0.5, -0.6, 0), rotation: QUAT_IDENTITY },
    },
    {
      kind: "box",
      halfExtents: vec3(0.5, 0.15, 0.15),
      friction: 1.2,
      restitution: 0.1,
      transform: { position: vec3(-0.5, -0.2, 0), rotation: QUAT_IDENTITY },
    },
    {
      kind: "box",
      halfExtents: vec3(0.5, 0.15, 0.15),
      friction: 1.2,
      restitution: 0.1,
      transform: { position: vec3(-0.5, 0.2, 0), rotation: QUAT_IDENTITY },
    },
    {
      kind: "box",
      halfExtents: vec3(0.5, 0.15, 0.15),
      friction: 1.2,
      restitution: 0.1,
      transform: { position: vec3(-0.5, 0.6, 0), rotation: QUAT_IDENTITY },
    },
  ],
  anchors: [
    // Attach to wall
    stoneBrickAnchor("wall", vec3(0.5, 0, 0), VEC3_X),
    // Top for connecting upper structures
    stoneBrickAnchor("top", vec3(0, 1.2, 0), VEC3_Y),
    // Bottom for foundation
    stoneBrickAnchor("bottom", vec3(0, -1.2, 0), VEC3_NEG_Y),
  ],
};

/**
 * Rampart/Bastion – angular defensive outwork
 * Provides additional defensive positions and structural interest.
 */
export const rampart: BlockDefinition = {
  id: "structure.rampart.2x2",
  name: "Stone Rampart (2×2)",
  category: "Medieval Stone",
  mass: 15,
  geometry: [
    {
      kind: "box",
      size: vec3(2, 1.5, 2),
    },
  ],
  colliders: [
    {
      kind: "box",
      halfExtents: vec3(1, 0.75, 1),
      friction: 0.8,
      restitution: 0.1,
    },
  ],
  anchors: [
    // 4 side anchors for wall connection
    stoneBrickAnchor("xp", vec3(1, 0, 0), VEC3_X),
    stoneBrickAnchor("xn", vec3(-1, 0, 0), VEC3_NEG_X),
    stoneBrickAnchor("zp", vec3(0, 0, 1), VEC3_Z),
    stoneBrickAnchor("zn", vec3(0, 0, -1), VEC3_NEG_Z),
    // Vertical anchors
    stoneBrickAnchor("top", vec3(0, 0.75, 0), VEC3_Y),
    stoneBrickAnchor("bottom", vec3(0, -0.75, 0), VEC3_NEG_Y),
  ],
};

/**
 * Fortress Foundation Platform – large stable base for entire fortress
 * Heavy, immobile foundation that prevents fortress from sinking.
 */
export const fortressFoundation: BlockDefinition = {
  id: "foundation.platform.large",
  name: "Fortress Foundation (6×6)",
  category: "Medieval Stone",
  mass: 0,  // Fixed to ground
  parts: [{ id: "main", rigidBodyKind: "fixed" }],
  geometry: [
    {
      kind: "box",
      size: vec3(6, 0.5, 6),
    },
  ],
  colliders: [
    {
      kind: "box",
      halfExtents: vec3(3, 0.25, 3),
      friction: 1.0,
      restitution: 0.0,
    },
  ],
  anchors: [
    // Top anchors for building on foundation
    stoneBrickAnchor("center", vec3(0, 0.25, 0), VEC3_Y),
    stoneBrickAnchor("north", vec3(0, 0.25, -2.5), VEC3_Y),
    stoneBrickAnchor("south", vec3(0, 0.25, 2.5), VEC3_Y),
    stoneBrickAnchor("east", vec3(2.5, 0.25, 0), VEC3_Y),
    stoneBrickAnchor("west", vec3(-2.5, 0.25, 0), VEC3_Y),
    stoneBrickAnchor("ne", vec3(2.5, 0.25, -2.5), VEC3_Y),
    stoneBrickAnchor("nw", vec3(-2.5, 0.25, -2.5), VEC3_Y),
    stoneBrickAnchor("se", vec3(2.5, 0.25, 2.5), VEC3_Y),
    stoneBrickAnchor("sw", vec3(-2.5, 0.25, 2.5), VEC3_Y),
  ],
};

// ---------------------------------------------------------------------------
// Export complete medieval fortress catalog
// ---------------------------------------------------------------------------

export const medievalCatalog: BlockDefinition[] = [
  // Tier 1: Basic brick
  stoneBrick,
  // Tier 2: Segments
  wallSegmentStraight,
  wallSegmentCorner,
  towerBaseSection,
  // Tier 3: Major structures (10 types)
  squareTower,
  roundTower,
  gatehouseTower,
  crenellationTop,
  drawBridge,
  portcullis,
  stairs,
  rampart,
  fortressFoundation,
];
