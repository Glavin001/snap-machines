import { describe, it, expect } from "vitest";
import { BlockGraph, makeId } from "../graph.js";
import { BlockCatalog, BlockDefinition } from "../schema.js";
import { TRANSFORM_IDENTITY, vec3, QUAT_IDENTITY, transform } from "../math.js";

function cubeBlock(): BlockDefinition {
  return {
    id: "cube",
    name: "Cube",
    mass: 1,
    colliders: [{ kind: "box", halfExtents: vec3(0.5, 0.5, 0.5) }],
    anchors: [
      { id: "xp", position: vec3(0.5, 0, 0), normal: vec3(1, 0, 0), type: "struct" },
      { id: "xn", position: vec3(-0.5, 0, 0), normal: vec3(-1, 0, 0), type: "struct" },
    ],
  };
}

describe("makeId", () => {
  it("produces unique ids", () => {
    const a = makeId("test");
    const b = makeId("test");
    expect(a).not.toBe(b);
    expect(a.startsWith("test:")).toBe(true);
  });
});

describe("BlockGraph nodes", () => {
  it("adds and retrieves a node", () => {
    const graph = new BlockGraph();
    const node = graph.addNode({ typeId: "cube", transform: TRANSFORM_IDENTITY });
    expect(graph.getNode(node.id)).toBe(node);
    expect(graph.listNodes()).toHaveLength(1);
  });

  it("adds node with custom id", () => {
    const graph = new BlockGraph();
    const node = graph.addNode({ id: "myNode", typeId: "cube", transform: TRANSFORM_IDENTITY });
    expect(node.id).toBe("myNode");
  });

  it("rejects duplicate node id", () => {
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    expect(() => graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY })).toThrow("already contains");
  });

  it("removes a node and its connections", () => {
    const graph = new BlockGraph();
    const n1 = graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    const n2 = graph.addNode({ id: "n2", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addConnection({ a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "n2", anchorId: "xn" } });
    graph.removeNode("n1");
    expect(graph.getNode("n1")).toBeUndefined();
    expect(graph.listConnections()).toHaveLength(0);
  });

  it("removeNode is safe for unknown id", () => {
    const graph = new BlockGraph();
    expect(() => graph.removeNode("nope")).not.toThrow();
  });

  it("updateNodeTransform", () => {
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    const newT = transform(vec3(5, 0, 0), QUAT_IDENTITY);
    graph.updateNodeTransform("n1", newT);
    expect(graph.getNode("n1")!.transform.position.x).toBe(5);
  });

  it("updateNodeTransform throws for unknown node", () => {
    const graph = new BlockGraph();
    expect(() => graph.updateNodeTransform("nope", TRANSFORM_IDENTITY)).toThrow("Unknown node");
  });
});

describe("BlockGraph connections", () => {
  it("adds and retrieves a connection", () => {
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addNode({ id: "n2", typeId: "cube", transform: TRANSFORM_IDENTITY });
    const conn = graph.addConnection({ a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "n2", anchorId: "xn" } });
    expect(graph.getConnection(conn.id)).toBe(conn);
    expect(graph.listConnections()).toHaveLength(1);
  });

  it("rejects connection to missing node", () => {
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    expect(() =>
      graph.addConnection({ a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "ghost", anchorId: "xn" } }),
    ).toThrow("missing graph nodes");
  });

  it("rejects self-connection", () => {
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    expect(() =>
      graph.addConnection({ a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "n1", anchorId: "xp" } }),
    ).toThrow("cannot link an anchor to itself");
  });

  it("rejects occupied anchor", () => {
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addNode({ id: "n2", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addNode({ id: "n3", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addConnection({ a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "n2", anchorId: "xn" } });
    expect(() =>
      graph.addConnection({ a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "n3", anchorId: "xn" } }),
    ).toThrow("already occupied");
  });

  it("removes a connection and frees anchors", () => {
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addNode({ id: "n2", typeId: "cube", transform: TRANSFORM_IDENTITY });
    const conn = graph.addConnection({ a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "n2", anchorId: "xn" } });
    graph.removeConnection(conn.id);
    expect(graph.isAnchorOccupied({ blockId: "n1", anchorId: "xp" })).toBe(false);
    expect(graph.listConnections()).toHaveLength(0);
  });

  it("removeConnection is safe for unknown id", () => {
    const graph = new BlockGraph();
    expect(() => graph.removeConnection("nope")).not.toThrow();
  });

  it("getConnectionForAnchor", () => {
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addNode({ id: "n2", typeId: "cube", transform: TRANSFORM_IDENTITY });
    const conn = graph.addConnection({ a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "n2", anchorId: "xn" } });
    expect(graph.getConnectionForAnchor({ blockId: "n1", anchorId: "xp" })?.id).toBe(conn.id);
    expect(graph.getConnectionForAnchor({ blockId: "n1", anchorId: "xn" })).toBeUndefined();
  });

  it("getConnectionsForBlock", () => {
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addNode({ id: "n2", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addConnection({ a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "n2", anchorId: "xn" } });
    expect(graph.getConnectionsForBlock("n1")).toHaveLength(1);
    expect(graph.getConnectionsForBlock("n3")).toHaveLength(0);
  });
});

describe("BlockGraph serialization", () => {
  it("toJSON / fromJSON roundtrip", () => {
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addNode({ id: "n2", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addConnection({ a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "n2", anchorId: "xn" } });

    const json = graph.toJSON();
    expect(json.version).toBe(1);

    const restored = BlockGraph.fromJSON(json);
    expect(restored.listNodes()).toHaveLength(2);
    expect(restored.listConnections()).toHaveLength(1);
  });

  it("clone creates independent copy", () => {
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    const clone = graph.clone();
    clone.addNode({ id: "n2", typeId: "cube", transform: TRANSFORM_IDENTITY });
    expect(graph.listNodes()).toHaveLength(1);
    expect(clone.listNodes()).toHaveLength(2);
  });

  it("constructs from initial data", () => {
    const graph = new BlockGraph({
      version: 1,
      nodes: [
        { id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY },
        { id: "n2", typeId: "cube", transform: TRANSFORM_IDENTITY },
      ],
      connections: [
        { id: "c1", a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "n2", anchorId: "xn" } },
      ],
    });
    expect(graph.listNodes()).toHaveLength(2);
    expect(graph.listConnections()).toHaveLength(1);
  });

  it("advances generated ids past restored explicit ids", () => {
    const graph = new BlockGraph({
      version: 1,
      nodes: [
        { id: "block:zzz", typeId: "cube", transform: TRANSFORM_IDENTITY },
        { id: "block:zz1", typeId: "cube", transform: TRANSFORM_IDENTITY },
      ],
      connections: [
        { id: "conn:zz2", a: { blockId: "block:zzz", anchorId: "xp" }, b: { blockId: "block:zz1", anchorId: "xn" } },
      ],
    });

    const node = graph.addNode({ typeId: "cube", transform: TRANSFORM_IDENTITY });
    expect(["block:zzz", "block:zz1"]).not.toContain(node.id);
    expect(Number.parseInt(node.id.split(":")[1]!, 36)).toBeGreaterThan(Number.parseInt("zz2", 36));
  });
});

describe("BlockGraph.validateAgainstCatalog", () => {
  it("validates a correct graph", () => {
    const catalog = new BlockCatalog();
    catalog.register(cubeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addNode({ id: "n2", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addConnection({ a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "n2", anchorId: "xn" } });

    const result = graph.validateAgainstCatalog(catalog);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports unknown block type", () => {
    const catalog = new BlockCatalog();
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "unknown", transform: TRANSFORM_IDENTITY });
    const result = graph.validateAgainstCatalog(catalog);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("unknown block type");
  });

  it("reports incompatible anchor types", () => {
    const catalog = new BlockCatalog();
    catalog.register({
      id: "mixed",
      name: "Mixed",
      mass: 1,
      colliders: [{ kind: "box", halfExtents: vec3(0.5, 0.5, 0.5) }],
      anchors: [
        { id: "a", position: vec3(0, 0, 0), normal: vec3(1, 0, 0), type: "struct" },
        { id: "b", position: vec3(0, 0, 0), normal: vec3(-1, 0, 0), type: "power" },
      ],
    });
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "mixed", transform: TRANSFORM_IDENTITY });
    graph.addNode({ id: "n2", typeId: "mixed", transform: TRANSFORM_IDENTITY });
    graph.addConnection({ a: { blockId: "n1", anchorId: "a" }, b: { blockId: "n2", anchorId: "b" } });
    const result = graph.validateAgainstCatalog(catalog);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("incompatible anchor types"))).toBe(true);
  });

  it("warns on self-block connection", () => {
    const catalog = new BlockCatalog();
    catalog.register(cubeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addConnection({ a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "n1", anchorId: "xn" } });
    const result = graph.validateAgainstCatalog(catalog);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
