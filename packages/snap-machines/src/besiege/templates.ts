/**
 * Besiege Layer 1 — Multi-block compound templates.
 *
 * These compounds require multiple blocks and multiple joints, so they
 * can't be represented as a single `BlockDefinition`. Instead, they use
 * the `CompoundTemplate` system to expand into a sub-graph of blocks.
 *
 * Templates: Gripper, Steering Wheel, Suspension Strut
 */
import { CompoundTemplate } from "../compound.js";
import { BlockCatalog } from "../schema.js";
import { BlockGraph } from "../graph.js";
import { QUAT_IDENTITY, vec3 } from "../math.js";
import { alignAnchorPair, getWorldAnchorTransform } from "../snap.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Place a block so that its sourceAnchor aligns with targetAnchor on targetBlock. */
function snapBlockInGraph(
  g: BlockGraph,
  catalog: BlockCatalog,
  opts: {
    id: string;
    typeId: string;
    targetBlockId: string;
    targetAnchorId: string;
    sourceAnchorId: string;
  },
): void {
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
}

// ---------------------------------------------------------------------------
// Gripper — Palm + 2 Hinges + 2 Finger blocks
// ---------------------------------------------------------------------------

/**
 * Gripper compound template.
 *
 * Layout: A palm block with two hinge blocks on its sides, each connecting
 * to a finger block. The hinges share the same input action but with
 * opposite scales so the fingers open/close symmetrically.
 *
 * Required blocks in catalog:
 *   - primitive.block.1x1  (palm and fingers)
 *   - joint.hinge.small    (finger joints)
 *
 * NOTE: The gripper uses custom hinge blocks with gripperClose input.
 * Since we can't modify block definitions per-instance, the gripper
 * uses the standard hinge blocks and relies on the machine template
 * to set up the input mapping. For MVP, we build the gripper directly
 * as part of the machine template (see crane preset).
 */
export const gripperTemplate: CompoundTemplate = {
  id: "compound.gripper",
  name: "Gripper",
  category: "manipulation",

  build(catalog: BlockCatalog) {
    const g = new BlockGraph();

    // Palm block at origin
    g.addNode({
      id: "palm",
      typeId: "primitive.block.1x1",
      transform: { position: vec3(0, 0, 0), rotation: QUAT_IDENTITY },
    });

    // Left finger hinge on +X side of palm
    snapBlockInGraph(g, catalog, {
      id: "hinge-l",
      typeId: "joint.hinge.small",
      targetBlockId: "palm",
      targetAnchorId: "xp",
      sourceAnchorId: "base.xn",
    });

    // Left finger block on rotor side of left hinge
    snapBlockInGraph(g, catalog, {
      id: "finger-l",
      typeId: "primitive.block.1x1",
      targetBlockId: "hinge-l",
      targetAnchorId: "rotor.xp",
      sourceAnchorId: "xn",
    });

    // Right finger hinge on -X side of palm
    snapBlockInGraph(g, catalog, {
      id: "hinge-r",
      typeId: "joint.hinge.small",
      targetBlockId: "palm",
      targetAnchorId: "xn",
      sourceAnchorId: "rotor.xp",
    });

    // Right finger block on base side of right hinge
    snapBlockInGraph(g, catalog, {
      id: "finger-r",
      typeId: "primitive.block.1x1",
      targetBlockId: "hinge-r",
      targetAnchorId: "base.xn",
      sourceAnchorId: "xp",
    });

    return {
      graph: g,
      mountAnchor: { blockId: "palm", anchorId: "yn" },
      exposedAnchors: [
        { name: "top", ref: { blockId: "palm", anchorId: "yp" } },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Steering Wheel — Knuckle block + Steering Hinge + Wheel compound
// ---------------------------------------------------------------------------

/**
 * Steering wheel compound template.
 *
 * A steering knuckle connected to a wheel compound via a vertical-axis
 * hinge (the steering joint). The steering joint uses position-mode
 * motor with limits for turn angle.
 *
 * Required blocks in catalog:
 *   - primitive.block.1x1  (knuckle)
 *   - joint.hinge.small    (steering pivot)
 *   - compound.wheel       (the wheel itself)
 */
export const steeringWheelTemplate: CompoundTemplate = {
  id: "compound.steering-wheel",
  name: "Steering Wheel",
  category: "locomotion",

  build(catalog: BlockCatalog) {
    const g = new BlockGraph();

    // Knuckle block at origin — this connects to the chassis
    g.addNode({
      id: "knuckle",
      typeId: "primitive.block.1x1",
      transform: { position: vec3(0, 0, 0), rotation: QUAT_IDENTITY },
    });

    // Steering hinge below the knuckle (vertical axis for steering)
    snapBlockInGraph(g, catalog, {
      id: "steer-hinge",
      typeId: "joint.hinge.small",
      targetBlockId: "knuckle",
      targetAnchorId: "yn",
      sourceAnchorId: "base.xn",
    });

    // Wheel on the rotor side of the steering hinge
    snapBlockInGraph(g, catalog, {
      id: "wheel",
      typeId: "compound.wheel",
      targetBlockId: "steer-hinge",
      targetAnchorId: "rotor.xp",
      sourceAnchorId: "mount.attach",
    });

    return {
      graph: g,
      mountAnchor: { blockId: "knuckle", anchorId: "yp" },
      exposedAnchors: [
        { name: "side.xp", ref: { blockId: "knuckle", anchorId: "xp" } },
        { name: "side.xn", ref: { blockId: "knuckle", anchorId: "xn" } },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Suspension Strut — Shock Absorber + Wheel on bottom
// ---------------------------------------------------------------------------

/**
 * Suspension strut compound template.
 *
 * A shock absorber (prismatic spring) with a wheel attached to the bottom.
 * The upper end mounts to the chassis.
 *
 * Required blocks in catalog:
 *   - compound.shock   (shock absorber)
 *   - compound.wheel   (the wheel)
 */
export const suspensionStrutTemplate: CompoundTemplate = {
  id: "compound.suspension-strut",
  name: "Suspension Strut",
  category: "locomotion",

  build(catalog: BlockCatalog) {
    const g = new BlockGraph();

    // Shock absorber at origin
    g.addNode({
      id: "shock",
      typeId: "compound.shock",
      transform: { position: vec3(0, 0, 0), rotation: QUAT_IDENTITY },
    });

    // Wheel on the bottom of the shock
    snapBlockInGraph(g, catalog, {
      id: "wheel",
      typeId: "compound.wheel",
      targetBlockId: "shock",
      targetAnchorId: "lower.attach",
      sourceAnchorId: "mount.attach",
    });

    return {
      graph: g,
      mountAnchor: { blockId: "shock", anchorId: "upper.attach" },
      exposedAnchors: [],
    };
  },
};

// ---------------------------------------------------------------------------
// Single Floor Assembly — Floor + 4 Corner Pillars
// ---------------------------------------------------------------------------

/**
 * Single floor compound template.
 *
 * A floor slab with 4 concrete pillars at the corners for vertical support.
 * The floor itself can connect to stairs or another floor assembly via exposed anchors.
 *
 * Required blocks in catalog:
 *   - primitive.floor.slab.10x10  (floor)
 *   - primitive.pillar.concrete   (pillars)
 */
export const singleFloorTemplate: CompoundTemplate = {
  id: "compound.building.floor.single",
  name: "Single Floor Assembly",
  category: "structure",

  build(catalog: BlockCatalog) {
    const g = new BlockGraph();

    // Floor slab at origin (centered at y=0, extends from -5 to +5 in X and Z)
    g.addNode({
      id: "floor",
      typeId: "primitive.floor.slab.10x10",
      transform: { position: vec3(0, 0, 0), rotation: QUAT_IDENTITY },
    });

    // Corner pillar at +X, +Z
    snapBlockInGraph(g, catalog, {
      id: "pillar-xp-zp",
      typeId: "primitive.pillar.concrete",
      targetBlockId: "floor",
      targetAnchorId: "corner.xp.zp",
      sourceAnchorId: "yn",
    });

    // Corner pillar at +X, -Z
    snapBlockInGraph(g, catalog, {
      id: "pillar-xp-zn",
      typeId: "primitive.pillar.concrete",
      targetBlockId: "floor",
      targetAnchorId: "corner.xp.zn",
      sourceAnchorId: "yn",
    });

    // Corner pillar at -X, +Z
    snapBlockInGraph(g, catalog, {
      id: "pillar-xn-zp",
      typeId: "primitive.pillar.concrete",
      targetBlockId: "floor",
      targetAnchorId: "corner.xn.zp",
      sourceAnchorId: "yn",
    });

    // Corner pillar at -X, -Z
    snapBlockInGraph(g, catalog, {
      id: "pillar-xn-zn",
      typeId: "primitive.pillar.concrete",
      targetBlockId: "floor",
      targetAnchorId: "corner.xn.zn",
      sourceAnchorId: "yn",
    });

    return {
      graph: g,
      mountAnchor: { blockId: "floor", anchorId: "bottom.center" },
      exposedAnchors: [
        { name: "top", ref: { blockId: "floor", anchorId: "bottom.center" } },
        { name: "stairs.front", ref: { blockId: "floor", anchorId: "stairs.front" } },
        { name: "pillar-xp-zp-top", ref: { blockId: "pillar-xp-zp", anchorId: "yp" } },
        { name: "pillar-xp-zn-top", ref: { blockId: "pillar-xp-zn", anchorId: "yp" } },
        { name: "pillar-xn-zp-top", ref: { blockId: "pillar-xn-zp", anchorId: "yp" } },
        { name: "pillar-xn-zn-top", ref: { blockId: "pillar-xn-zn", anchorId: "yp" } },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Multi-Floor Building — Stacked Floors + Stairs (Flexible Floor Count)
// ---------------------------------------------------------------------------

/**
 * Multi-floor building compound template.
 *
 * A flexible building assembly that stacks multiple single-floor templates
 * with concrete stairs connecting each level. Default is 4 floors, but can
 * be parameterized for any height.
 *
 * Required blocks in catalog:
 *   - compound.building.floor.single  (floor assemblies)
 *   - primitive.stairs.concrete       (stairs between floors)
 *
 * NOTE: This template is typically used via placeCompound() in machine
 * presets with direct floor count parameter.
 */
export const multiFloorBuildingTemplate = (floorCount: number = 4): CompoundTemplate => ({
  id: `compound.building.${floorCount}story`,
  name: `${floorCount}-Story Building`,
  category: "structure",

  build(catalog: BlockCatalog) {
    const g = new BlockGraph();

    // Build each floor and stairs
    for (let i = 1; i <= floorCount; i++) {
      const floorY = (i - 1) * 3.0; // Floor-to-floor height is 3.0m
      const floorId = `floor-l${i}`;

      // Add floor slab at appropriate height
      g.addNode({
        id: floorId,
        typeId: "primitive.floor.slab.10x10",
        transform: { position: vec3(0, floorY, 0), rotation: QUAT_IDENTITY },
      });

      // Add 4 pillars at floor corners
      const corners = [
        { id: "xp-zp", anchor: "corner.xp.zp" },
        { id: "xp-zn", anchor: "corner.xp.zn" },
        { id: "xn-zp", anchor: "corner.xn.zp" },
        { id: "xn-zn", anchor: "corner.xn.zn" },
      ];

      for (const corner of corners) {
        snapBlockInGraph(g, catalog, {
          id: `pillar-l${i}-${corner.id}`,
          typeId: "primitive.pillar.concrete",
          targetBlockId: floorId,
          targetAnchorId: corner.anchor,
          sourceAnchorId: "yn",
        });
      }

      // Add stairs to next floor (if not the last floor)
      if (i < floorCount) {
        snapBlockInGraph(g, catalog, {
          id: `stairs-l${i}-l${i + 1}`,
          typeId: "primitive.stairs.concrete",
          targetBlockId: floorId,
          targetAnchorId: "stairs.front",
          sourceAnchorId: "bottom",
        });
      }
    }

    return {
      graph: g,
      mountAnchor: { blockId: "floor-l1", anchorId: "bottom.center" },
      exposedAnchors: [
        { name: "top", ref: { blockId: `floor-l${floorCount}`, anchorId: "bottom.center" } },
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const besiegeTemplates: CompoundTemplate[] = [
  gripperTemplate,
  steeringWheelTemplate,
  suspensionStrutTemplate,
  singleFloorTemplate,
  multiFloorBuildingTemplate(4), // Export the 4-story building as the standard
];
