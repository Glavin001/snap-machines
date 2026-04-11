import { describe, expect, it } from "vitest";
import {
  SERIALIZED_CATALOG_SCHEMA_VERSION,
  SERIALIZED_MACHINE_SCHEMA_VERSION,
  canonicalJsonStringify,
  compileMachineEnvelope,
  serializeBlockCatalog,
  serializeMachineEnvelope,
} from "../serialize.js";
import { BlockCatalog, BlockDefinition } from "../schema.js";
import { BlockGraph } from "../graph.js";
import { TRANSFORM_IDENTITY, vec3 } from "../math.js";
import { compileMachinePlan } from "../compile/plan.js";

function cubeBlock(id = "cube"): BlockDefinition {
  return {
    id,
    name: "Cube",
    mass: 1,
    colliders: [{ kind: "box", halfExtents: vec3(0.5, 0.5, 0.5) }],
    anchors: [
      { id: "xp", position: vec3(0.5, 0, 0), normal: vec3(1, 0, 0), type: "struct" },
      { id: "xn", position: vec3(-0.5, 0, 0), normal: vec3(-1, 0, 0), type: "struct" },
    ],
    behaviors: [{ kind: "thruster", props: { force: 10 } }],
  };
}

describe("serializeBlockCatalog", () => {
  it("exports a normalized catalog artifact with a stable version", () => {
    const catalogA = new BlockCatalog().registerMany([cubeBlock("b"), cubeBlock("a")]);
    const catalogB = new BlockCatalog().registerMany([cubeBlock("a"), cubeBlock("b")]);

    const serializedA = serializeBlockCatalog(catalogA);
    const serializedB = serializeBlockCatalog(catalogB);

    expect(serializedA.schemaVersion).toBe(SERIALIZED_CATALOG_SCHEMA_VERSION);
    expect(serializedA.blocks.map((block) => block.id)).toEqual(["a", "b"]);
    expect(serializedA.catalogVersion).toBe(serializedB.catalogVersion);
    expect(serializedA.blocks[0]!.parts[0]!.id).toBe("main");
    expect(serializedA.blocks[0]!.behaviors[0]!.partId).toBe("main");
  });

  it("changes catalogVersion when normalized content changes", () => {
    const baseline = serializeBlockCatalog([cubeBlock("cube")]);
    const changed = serializeBlockCatalog([
      {
        ...cubeBlock("cube"),
        mass: 2,
      },
    ]);

    expect(changed.catalogVersion).not.toBe(baseline.catalogVersion);
  });
});

describe("serializeMachineEnvelope", () => {
  it("wraps a compiled plan with schema and catalog version", () => {
    const catalog = new BlockCatalog().register(cubeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "root", typeId: "cube", transform: TRANSFORM_IDENTITY });

    const plan = compileMachinePlan(graph, catalog);
    const envelope = serializeMachineEnvelope(plan, catalog, {
      metadata: {
        builder: "web",
        tags: ["authoritative", "server"],
      },
    });

    expect(envelope.schemaVersion).toBe(SERIALIZED_MACHINE_SCHEMA_VERSION);
    expect(envelope.catalogVersion).toBe(serializeBlockCatalog(catalog).catalogVersion);
    expect(envelope.plan).toEqual(plan);
    expect(envelope.metadata).toEqual({
      builder: "web",
      tags: ["authoritative", "server"],
    });
  });

  it("compiles a graph directly into an envelope", () => {
    const catalog = new BlockCatalog().register(cubeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "root", typeId: "cube", transform: TRANSFORM_IDENTITY });

    const envelope = compileMachineEnvelope(graph, catalog);

    expect(envelope.plan.bodies).toHaveLength(1);
    expect(envelope.plan.mounts).toHaveLength(1);
    expect(envelope.plan.joints).toHaveLength(0);
  });
});

describe("canonicalJsonStringify", () => {
  it("sorts object keys and strips undefined properties", () => {
    expect(
      canonicalJsonStringify({
        z: 1,
        a: {
          y: 2,
          x: undefined,
          b: 1,
        },
      }),
    ).toBe("{\"a\":{\"b\":1,\"y\":2},\"z\":1}");
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJsonStringify({ value: Number.NaN })).toThrow("Cannot serialize non-finite number");
  });
});
