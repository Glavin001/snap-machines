/**
 * Multi-block compound template system.
 *
 * Compounds are saved arrangements of primitives wired together. They expand
 * into a sub-graph of multiple blocks + connections when placed. This module
 * provides the `CompoundTemplate` type and `placeCompound()` function that
 * merges a compound instance into a target `BlockGraph`.
 */
import { AnchorRef, BlockGraph } from "./graph.js";
import { BlockCatalog } from "./schema.js";
import {
  Transform,
  composeTransforms,
  relativeTransform,
  addVec3,
  rotateVec3,
  QUAT_IDENTITY,
} from "./math.js";
import { alignAnchorPair, getWorldAnchorTransform } from "./snap.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A compound template describes a reusable sub-assembly of blocks.
 * When placed, it expands into individual blocks + connections in the graph.
 */
export interface CompoundTemplate {
  id: string;
  name: string;
  category: string;

  /**
   * Factory that creates the sub-assembly. Blocks in the returned graph
   * use local IDs that will be prefixed when placed.
   */
  build(catalog: BlockCatalog): CompoundInstance;
}

/**
 * The result of building a compound template — a sub-graph plus
 * information about how to attach it to the parent.
 */
export interface CompoundInstance {
  /** Sub-graph containing the compound's blocks + internal connections. */
  graph: BlockGraph;

  /** The anchor on one of the compound's blocks used for mounting. */
  mountAnchor: AnchorRef;

  /** Additional anchors exposed for chaining compounds together. */
  exposedAnchors: { name: string; ref: AnchorRef }[];
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

export interface PlaceCompoundResult {
  /** All block IDs added to the target graph (prefixed). */
  blockIds: string[];

  /** Exposed anchors with prefixed block IDs. */
  exposedAnchors: Map<string, AnchorRef>;
}

/**
 * Place a compound into a target graph, attaching it to an existing block.
 *
 * This function:
 * 1. Builds the compound's sub-graph via its factory
 * 2. Prefixes all block IDs with `idPrefix` to avoid collisions
 * 3. Computes placement transform via anchor alignment
 * 4. Copies all blocks + connections into the target graph
 * 5. Creates a connection from the target anchor to the compound's mount anchor
 *
 * @param targetGraph  The graph to merge into
 * @param catalog      Block catalog (must contain all block types used by the compound)
 * @param template     The compound template to instantiate
 * @param targetBlockId  Existing block to attach to
 * @param targetAnchorId  Anchor on the target block
 * @param idPrefix     Namespace prefix for all block IDs (e.g., "fl-suspension/")
 */
export function placeCompound(
  targetGraph: BlockGraph,
  catalog: BlockCatalog,
  template: CompoundTemplate,
  targetBlockId: string,
  targetAnchorId: string,
  idPrefix: string,
): PlaceCompoundResult {
  const instance = template.build(catalog);
  const subGraph = instance.graph;

  // Compute the placement transform by aligning the compound's mount anchor
  // with the target anchor on the existing block.
  const targetNode = targetGraph.getNode(targetBlockId)!;
  const targetBlockDef = catalog.get(targetNode.typeId);
  const targetAnchor = targetBlockDef.anchors.find((a) => a.id === targetAnchorId)!;
  const targetAnchorWorld = getWorldAnchorTransform(targetNode.transform, targetAnchor);

  const mountBlockNode = subGraph.getNode(instance.mountAnchor.blockId)!;
  const mountBlockDef = catalog.get(mountBlockNode.typeId);
  const mountAnchor = mountBlockDef.anchors.find((a) => a.id === instance.mountAnchor.anchorId)!;

  // alignAnchorPair gives us the block placement that aligns the mount anchor
  // to the target anchor. This is the transform for the mount block.
  const mountPlacement = alignAnchorPair(targetAnchorWorld, mountAnchor);

  // Compute offset: how much the mount block moved from its original position
  // in the sub-graph to its final placement.
  const mountOriginalTransform = mountBlockNode.transform;
  const offsetTransform = relativeTransform(mountOriginalTransform, mountPlacement);

  // Add all blocks from the sub-graph with prefixed IDs and transformed positions
  const blockIds: string[] = [];
  for (const node of subGraph.listNodes()) {
    const prefixedId = `${idPrefix}${node.id}`;
    const newTransform = composeTransforms(offsetTransform, node.transform);
    targetGraph.addNode({
      id: prefixedId,
      typeId: node.typeId,
      transform: newTransform,
      metadata: node.metadata,
    });
    blockIds.push(prefixedId);
  }

  // Add all internal connections with prefixed IDs
  for (const conn of subGraph.listConnections()) {
    targetGraph.addConnection({
      a: { blockId: `${idPrefix}${conn.a.blockId}`, anchorId: conn.a.anchorId },
      b: { blockId: `${idPrefix}${conn.b.blockId}`, anchorId: conn.b.anchorId },
      metadata: conn.metadata,
    });
  }

  // Connect the compound's mount anchor to the target anchor
  targetGraph.addConnection({
    a: { blockId: targetBlockId, anchorId: targetAnchorId },
    b: { blockId: `${idPrefix}${instance.mountAnchor.blockId}`, anchorId: instance.mountAnchor.anchorId },
  });

  // Build exposed anchors map with prefixed block IDs
  const exposedAnchors = new Map<string, AnchorRef>();
  for (const exposed of instance.exposedAnchors) {
    exposedAnchors.set(exposed.name, {
      blockId: `${idPrefix}${exposed.ref.blockId}`,
      anchorId: exposed.ref.anchorId,
    });
  }

  return { blockIds, exposedAnchors };
}
