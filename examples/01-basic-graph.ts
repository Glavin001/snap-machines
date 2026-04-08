/**
 * Example 01: Basic Graph Construction
 *
 * Demonstrates how to define blocks, register them in a catalog,
 * create a graph, and add nodes with connections.
 */
import {
  BlockCatalog,
  BlockDefinition,
  BlockGraph,
  vec3,
  transform,
  QUAT_IDENTITY,
  TRANSFORM_IDENTITY,
} from "../packages/snap-machines/src/index.js";

// ── 1. Define a block type ──────────────────────────────────────────────
const cubeBlock: BlockDefinition = {
  id: "frame.cube",
  name: "Frame Cube",
  category: "structure",
  mass: 1,
  geometry: [{ kind: "box", size: vec3(1, 1, 1) }],
  colliders: [{ kind: "box", halfExtents: vec3(0.5, 0.5, 0.5) }],
  anchors: [
    { id: "xp", position: vec3(0.5, 0, 0), normal: vec3(1, 0, 0), type: "struct" },
    { id: "xn", position: vec3(-0.5, 0, 0), normal: vec3(-1, 0, 0), type: "struct" },
    { id: "yp", position: vec3(0, 0.5, 0), normal: vec3(0, 1, 0), type: "struct" },
    { id: "yn", position: vec3(0, -0.5, 0), normal: vec3(0, -1, 0), type: "struct" },
    { id: "zp", position: vec3(0, 0, 0.5), normal: vec3(0, 0, 1), type: "struct" },
    { id: "zn", position: vec3(0, 0, -0.5), normal: vec3(0, 0, -1), type: "struct" },
  ],
};

// ── 2. Register blocks in a catalog ─────────────────────────────────────
const catalog = new BlockCatalog();
catalog.register(cubeBlock);

console.log("Catalog has 'frame.cube':", catalog.has("frame.cube"));
console.log("Normalized block parts:", catalog.get("frame.cube").parts);

// ── 3. Create a graph and add blocks ────────────────────────────────────
const graph = new BlockGraph();

// Place the first cube at the origin
const node1 = graph.addNode({
  id: "cube-1",
  typeId: "frame.cube",
  transform: TRANSFORM_IDENTITY,
});

// Place a second cube 1 unit to the right
const node2 = graph.addNode({
  id: "cube-2",
  typeId: "frame.cube",
  transform: transform(vec3(1, 0, 0), QUAT_IDENTITY),
});

// ── 4. Connect them ─────────────────────────────────────────────────────
const connection = graph.addConnection({
  a: { blockId: "cube-1", anchorId: "xp" },
  b: { blockId: "cube-2", anchorId: "xn" },
});

console.log("Graph nodes:", graph.listNodes().length);
console.log("Graph connections:", graph.listConnections().length);
console.log("Connection:", connection.id, "links", connection.a, "→", connection.b);

// ── 5. Validate ─────────────────────────────────────────────────────────
const validation = graph.validateAgainstCatalog(catalog);
console.log("Validation OK:", validation.ok);

// ── 6. Serialize / deserialize ──────────────────────────────────────────
const json = graph.toJSON();
console.log("Serialized version:", json.version);

const restored = BlockGraph.fromJSON(json);
console.log("Restored nodes:", restored.listNodes().length);
