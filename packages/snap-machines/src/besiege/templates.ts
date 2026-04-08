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
// Export
// ---------------------------------------------------------------------------

export const besiegeTemplates: CompoundTemplate[] = [
  gripperTemplate,
  steeringWheelTemplate,
  suspensionStrutTemplate,
];
