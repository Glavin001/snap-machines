/**
 * Example 02: Snap Placement
 *
 * Shows how to use the snap system to find the best placement
 * for a new block based on a raycast hit point.
 */
import {
  BlockCatalog,
  BlockDefinition,
  BlockGraph,
  findBestSnap,
  findSnapCandidates,
  addSnappedBlockToGraph,
  resolveSnapRules,
  vec3,
  QUAT_IDENTITY,
  TRANSFORM_IDENTITY,
} from "../src/index.js";

// ── Block definitions ───────────────────────────────────────────────────
const cubeBlock: BlockDefinition = {
  id: "cube",
  name: "Cube",
  mass: 1,
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

const catalog = new BlockCatalog();
catalog.register(cubeBlock);

const graph = new BlockGraph();
graph.addNode({ id: "base", typeId: "cube", transform: TRANSFORM_IDENTITY });

// ── Simulate a raycast hit near the +X face ─────────────────────────────
const hit = {
  blockId: "base",
  point: vec3(0.5, 0.1, 0), // slightly off-center on the +X face
};

// ── Find all snap candidates ────────────────────────────────────────────
const candidates = findSnapCandidates({
  graph,
  catalog,
  candidateTypeId: "cube",
  hit,
});

console.log(`Found ${candidates.length} snap candidates`);
for (const c of candidates.slice(0, 3)) {
  console.log(
    `  anchor=${c.target.anchor.id} score=${c.score.toFixed(3)} ` +
    `hitDist=${c.hitDistance.toFixed(3)} angle=${c.angleErrorDeg.toFixed(1)}°`,
  );
}

// ── Use the best snap to place a new block ──────────────────────────────
const snap = findBestSnap({ graph, catalog, candidateTypeId: "cube", hit });

if (snap) {
  console.log("\nBest snap target:", snap.target.anchor.id);
  console.log("Placement position:", snap.placement.position);

  const { nodeId, connectionId } = addSnappedBlockToGraph({
    graph,
    typeId: "cube",
    snap,
  });

  console.log("Added node:", nodeId);
  console.log("Created connection:", connectionId);
  console.log("Total nodes:", graph.listNodes().length);
  console.log("Total connections:", graph.listConnections().length);
}

// ── Custom snap rules ───────────────────────────────────────────────────
const customRules = resolveSnapRules({
  searchDistance: 2.0,
  maxAngleDeg: 45,
  usePolarity: false,
});
console.log("\nCustom rules:", customRules);
