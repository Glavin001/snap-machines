import { describe, it, expect } from "vitest";
import {
  resolveSnapRules,
  getAnchorLocalTransform,
  getWorldAnchorTransform,
  anchorsAreCompatible,
  alignAnchorPair,
  findSnapCandidates,
  findBestSnap,
  addSnappedBlockToGraph,
  remapSnapResultForPlacedNode,
  measureAnchorAngleDeg,
  getAnchorWorldPoseForNode,
} from "../snap.js";
import { BlockCatalog, BlockDefinition, normalizeBlockDefinition, NormalizedAnchorDefinition } from "../schema.js";
import { BlockGraph } from "../graph.js";
import {
  QUAT_IDENTITY,
  TRANSFORM_IDENTITY,
  VEC3_X,
  VEC3_Y,
  VEC3_Z,
  vec3,
  transform,
  lookRotation,
  quatFromAxisAngle,
} from "../math.js";
import { exampleCatalog } from "../examples/catalog.js";
import { besiegeCompounds } from "../besiege/compounds.js";

function cubeBlock(): BlockDefinition {
  return {
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
}

function setupCatalogAndGraph() {
  const catalog = new BlockCatalog();
  catalog.register(cubeBlock());
  const graph = new BlockGraph();
  graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
  return { catalog, graph };
}

describe("resolveSnapRules", () => {
  it("returns defaults when no input", () => {
    const rules = resolveSnapRules();
    expect(rules.searchDistance).toBe(1.2);
    expect(rules.useTypes).toBe(true);
    expect(rules.usePolarity).toBe(true);
  });

  it("overrides specific values", () => {
    const rules = resolveSnapRules({ searchDistance: 5 });
    expect(rules.searchDistance).toBe(5);
    expect(rules.useTypes).toBe(true);
  });
});

describe("getAnchorLocalTransform / getWorldAnchorTransform", () => {
  it("returns anchor local transform", () => {
    const block = normalizeBlockDefinition(cubeBlock());
    const anchor = block.anchors.find((a) => a.id === "xp")!;
    const local = getAnchorLocalTransform(anchor);
    expect(local.position.x).toBeCloseTo(0.5);
  });

  it("composes with block transform for world", () => {
    const block = normalizeBlockDefinition(cubeBlock());
    const anchor = block.anchors.find((a) => a.id === "xp")!;
    const blockTransform = transform(vec3(10, 0, 0), QUAT_IDENTITY);
    const world = getWorldAnchorTransform(blockTransform, anchor);
    expect(world.position.x).toBeCloseTo(10.5);
  });
});

describe("anchorsAreCompatible", () => {
  it("compatible with same type and opposite polarity", () => {
    const block = normalizeBlockDefinition(cubeBlock());
    const rules = resolveSnapRules();
    expect(anchorsAreCompatible(block.anchors[0]!, block.anchors[1]!, rules)).toBe(true);
  });

  it("incompatible with different types when useTypes is true", () => {
    const block = normalizeBlockDefinition(cubeBlock());
    const rules = resolveSnapRules({ useTypes: true });
    const modifiedAnchor = { ...block.anchors[0]!, type: "power" } as NormalizedAnchorDefinition;
    expect(anchorsAreCompatible(modifiedAnchor, block.anchors[1]!, rules)).toBe(false);
  });

  it("compatible with different types when useTypes is false", () => {
    const block = normalizeBlockDefinition(cubeBlock());
    const rules = resolveSnapRules({ useTypes: false });
    const modifiedAnchor = { ...block.anchors[0]!, type: "power" } as NormalizedAnchorDefinition;
    expect(anchorsAreCompatible(modifiedAnchor, block.anchors[1]!, rules)).toBe(true);
  });
});

describe("findSnapCandidates / findBestSnap", () => {
  it("finds candidates when hitting near an anchor", () => {
    const { catalog, graph } = setupCatalogAndGraph();
    const candidates = findSnapCandidates({
      graph,
      catalog,
      candidateTypeId: "cube",
      hit: { blockId: "n1", point: vec3(0.5, 0, 0) },
    });
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("returns empty for unknown hit block", () => {
    const { catalog, graph } = setupCatalogAndGraph();
    const candidates = findSnapCandidates({
      graph,
      catalog,
      candidateTypeId: "cube",
      hit: { blockId: "ghost", point: vec3(0, 0, 0) },
    });
    expect(candidates).toHaveLength(0);
  });

  it("findBestSnap returns null when no candidates", () => {
    const { catalog, graph } = setupCatalogAndGraph();
    const result = findBestSnap({
      graph,
      catalog,
      candidateTypeId: "cube",
      hit: { blockId: "n1", point: vec3(100, 0, 0) },
    });
    expect(result).toBeNull();
  });

  it("findBestSnap returns a result for a nearby hit", () => {
    const { catalog, graph } = setupCatalogAndGraph();
    const result = findBestSnap({
      graph,
      catalog,
      candidateTypeId: "cube",
      hit: { blockId: "n1", point: vec3(0.5, 0.1, 0) },
    });
    expect(result).not.toBeNull();
    expect(result!.connection.a.blockId).toBe("n1");
  });

  it("respects requireTargetAnchorFree", () => {
    const { catalog, graph } = setupCatalogAndGraph();
    graph.addNode({ id: "n2", typeId: "cube", transform: transform(vec3(1, 0, 0), QUAT_IDENTITY) });
    graph.addConnection({ a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "n2", anchorId: "xn" } });

    const result = findBestSnap({
      graph,
      catalog,
      candidateTypeId: "cube",
      hit: { blockId: "n1", point: vec3(0.5, 0, 0) },
      rules: { requireTargetAnchorFree: true },
    });
    // The xp anchor is occupied, so it shouldn't be the target
    if (result) {
      expect(result.target.anchor.id).not.toBe("xp");
    }
  });

  it("prefers the partA structural mount for shock absorbers on a frame cube", () => {
    const catalog = new BlockCatalog();
    catalog.registerMany([...exampleCatalog, ...besiegeCompounds]);
    const graph = new BlockGraph();
    graph.addNode({ id: "origin", typeId: "frame.cube.1", transform: TRANSFORM_IDENTITY });

    const result = findBestSnap({
      graph,
      catalog,
      candidateTypeId: "compound.shock",
      hit: { blockId: "origin", point: vec3(0, 0.5, 0) },
    });

    expect(result).not.toBeNull();
    expect(result!.target.anchor.id).toBe("yp");
    expect(result!.sourceAnchor.id).toBe("upper.attach");
  });
});

describe("addSnappedBlockToGraph", () => {
  it("adds node and connection to graph", () => {
    const { catalog, graph } = setupCatalogAndGraph();
    const snap = findBestSnap({
      graph,
      catalog,
      candidateTypeId: "cube",
      hit: { blockId: "n1", point: vec3(0.5, 0, 0) },
    })!;
    expect(snap).not.toBeNull();

    const { nodeId, connectionId } = addSnappedBlockToGraph({
      graph,
      typeId: "cube",
      snap,
    });
    expect(graph.getNode(nodeId)).toBeDefined();
    expect(graph.getConnection(connectionId)).toBeDefined();
    expect(graph.listNodes()).toHaveLength(2);
  });
});

describe("remapSnapResultForPlacedNode", () => {
  it("remaps the candidate block id", () => {
    const { catalog, graph } = setupCatalogAndGraph();
    const snap = findBestSnap({
      graph,
      catalog,
      candidateTypeId: "cube",
      hit: { blockId: "n1", point: vec3(0.5, 0, 0) },
    })!;

    const remapped = remapSnapResultForPlacedNode(snap, "placed-node-42");
    expect(remapped.connection.b.blockId).toBe("placed-node-42");
    expect(remapped.connection.a).toEqual(snap.connection.a);
  });
});

describe("getAnchorWorldPoseForNode", () => {
  it("returns world transform for a placed node anchor", () => {
    const { catalog, graph } = setupCatalogAndGraph();
    const pose = getAnchorWorldPoseForNode(graph, catalog, { blockId: "n1", anchorId: "xp" });
    expect(pose.position.x).toBeCloseTo(0.5);
  });

  it("throws for unknown block", () => {
    const { catalog, graph } = setupCatalogAndGraph();
    expect(() => getAnchorWorldPoseForNode(graph, catalog, { blockId: "ghost", anchorId: "xp" })).toThrow();
  });
});

describe("measureAnchorAngleDeg", () => {
  it("measures 0 degrees for perfectly aligned anchors", () => {
    const block = normalizeBlockDefinition(cubeBlock());
    const anchorA = block.anchors.find((a) => a.id === "xp")!;
    const anchorB = block.anchors.find((a) => a.id === "xn")!;
    const worldA = getWorldAnchorTransform(TRANSFORM_IDENTITY, anchorA);
    const worldB = getWorldAnchorTransform(TRANSFORM_IDENTITY, anchorB);
    const angle = measureAnchorAngleDeg(worldA, anchorA, worldB, anchorB);
    expect(angle).toBeCloseTo(0, 0);
  });
});
