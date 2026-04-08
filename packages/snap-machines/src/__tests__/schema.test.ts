import { describe, it, expect } from "vitest";
import {
  BlockCatalog,
  BlockDefinition,
  normalizeBlockDefinition,
  validateBlockDefinition,
  structuralPolarityMatch,
  cloneBlockDefinition,
} from "../schema.js";
import { vec3, VEC3_Y, VEC3_Z, lookRotation, QUAT_IDENTITY } from "../math.js";
import { floorBlock, wallBlock, roofBlock, wallDoorBlock } from "../examples/catalog.js";

function minimalBlock(overrides: Partial<BlockDefinition> = {}): BlockDefinition {
  return {
    id: "test.block",
    name: "Test Block",
    mass: 1,
    colliders: [{ kind: "box", halfExtents: vec3(0.5, 0.5, 0.5) }],
    anchors: [
      {
        id: "a1",
        position: vec3(0.5, 0, 0),
        normal: vec3(1, 0, 0),
        type: "struct",
      },
    ],
    ...overrides,
  };
}

describe("normalizeBlockDefinition", () => {
  it("normalizes a minimal block", () => {
    const norm = normalizeBlockDefinition(minimalBlock());
    expect(norm.id).toBe("test.block");
    expect(norm.parts).toHaveLength(1);
    expect(norm.parts[0]!.id).toBe("main");
    expect(norm.parts[0]!.rigidBodyKind).toBe("dynamic");
    expect(norm.anchors[0]!.partId).toBe("main");
    expect(norm.anchors[0]!.polarity).toBe("neutral");
    expect(norm.colliders[0]!.partId).toBe("main");
    expect(norm.colliders[0]!.sensor).toBe(false);
    expect(norm.colliders[0]!.includeInMass).toBe(true);
    expect(norm.geometry).toEqual([]);
    expect(norm.behaviors).toEqual([]);
  });

  it("preserves existing parts", () => {
    const norm = normalizeBlockDefinition(
      minimalBlock({
        parts: [{ id: "core" }],
        colliders: [{ kind: "box", halfExtents: vec3(0.5, 0.5, 0.5), partId: "core" }],
        anchors: [{ id: "a1", position: vec3(0, 0, 0), normal: vec3(1, 0, 0), type: "struct", partId: "core" }],
      }),
    );
    expect(norm.parts[0]!.id).toBe("core");
  });

  it("normalizes geometry with generated ids", () => {
    const norm = normalizeBlockDefinition(
      minimalBlock({
        geometry: [{ kind: "box", size: vec3(1, 1, 1) }],
      }),
    );
    expect(norm.geometry).toHaveLength(1);
    expect(norm.geometry[0]!.id).toBe("test.block:geometry:0");
    expect(norm.geometry[0]!.partId).toBe("main");
  });

  it("normalizes collider sensor defaults", () => {
    const norm = normalizeBlockDefinition(
      minimalBlock({
        colliders: [{ kind: "box", halfExtents: vec3(0.5, 0.5, 0.5), sensor: true }],
      }),
    );
    expect(norm.colliders[0]!.sensor).toBe(true);
    expect(norm.colliders[0]!.includeInMass).toBe(false);
  });

  it("normalizes behaviors", () => {
    const norm = normalizeBlockDefinition(
      minimalBlock({
        behaviors: [{ kind: "thruster" }],
      }),
    );
    expect(norm.behaviors).toHaveLength(1);
    expect(norm.behaviors[0]!.partId).toBe("main");
    expect(norm.behaviors[0]!.props).toEqual({});
  });

  it("normalizes joint collideConnected default", () => {
    const norm = normalizeBlockDefinition(
      minimalBlock({
        parts: [{ id: "a" }, { id: "b" }],
        colliders: [
          { kind: "box", halfExtents: vec3(0.5, 0.5, 0.5), partId: "a" },
          { kind: "box", halfExtents: vec3(0.5, 0.5, 0.5), partId: "b" },
        ],
        anchors: [
          { id: "a1", position: vec3(0, 0, 0), normal: vec3(1, 0, 0), type: "struct", partId: "a" },
          { id: "b1", position: vec3(0, 0, 0), normal: vec3(-1, 0, 0), type: "struct", partId: "b" },
        ],
        joint: {
          kind: "revolute",
          partA: "a",
          partB: "b",
          anchorA: "a1",
          anchorB: "b1",
        },
      }),
    );
    expect(norm.joint!.collideConnected).toBe(false);
  });
});

describe("validateBlockDefinition", () => {
  it("passes on valid block", () => {
    expect(() => validateBlockDefinition(minimalBlock())).not.toThrow();
  });

  it("rejects empty id", () => {
    expect(() => validateBlockDefinition(minimalBlock({ id: "" }))).toThrow("non-empty");
  });

  it("rejects empty name", () => {
    expect(() => validateBlockDefinition(minimalBlock({ name: "  " }))).toThrow("non-empty name");
  });

  it("rejects no anchors", () => {
    expect(() => validateBlockDefinition(minimalBlock({ anchors: [] }))).toThrow("at least one anchor");
  });

  it("rejects no colliders", () => {
    expect(() => validateBlockDefinition(minimalBlock({ colliders: [] }))).toThrow("at least one collider");
  });

  it("rejects duplicate anchor ids", () => {
    expect(() =>
      validateBlockDefinition(
        minimalBlock({
          anchors: [
            { id: "a", position: vec3(0, 0, 0), normal: vec3(1, 0, 0), type: "struct" },
            { id: "a", position: vec3(0, 0, 0), normal: vec3(-1, 0, 0), type: "struct" },
          ],
        }),
      ),
    ).toThrow("duplicate anchor");
  });

  it("rejects zero normal", () => {
    expect(() =>
      validateBlockDefinition(
        minimalBlock({
          anchors: [{ id: "a", position: vec3(0, 0, 0), normal: vec3(0, 0, 0), type: "struct" }],
        }),
      ),
    ).toThrow("zero normal");
  });

  it("rejects anchor with empty type", () => {
    expect(() =>
      validateBlockDefinition(
        minimalBlock({
          anchors: [{ id: "a", position: vec3(0, 0, 0), normal: vec3(1, 0, 0), type: " " }],
        }),
      ),
    ).toThrow("must declare a type");
  });

  it("rejects anchor referencing unknown part", () => {
    expect(() =>
      validateBlockDefinition(
        minimalBlock({
          anchors: [{ id: "a", position: vec3(0, 0, 0), normal: vec3(1, 0, 0), type: "struct", partId: "ghost" }],
        }),
      ),
    ).toThrow("unknown part");
  });

  it("rejects non-finite anchor position", () => {
    expect(() =>
      validateBlockDefinition(
        minimalBlock({
          anchors: [{ id: "a", position: vec3(NaN, 0, 0), normal: vec3(1, 0, 0), type: "struct" }],
        }),
      ),
    ).toThrow("finite");
  });

  it("rejects box collider with invalid half-extents", () => {
    expect(() =>
      validateBlockDefinition(
        minimalBlock({
          colliders: [{ kind: "box", halfExtents: vec3(0, 0.5, 0.5) }],
        }),
      ),
    ).toThrow("invalid half-extents");
  });

  it("rejects sphere collider with invalid radius", () => {
    expect(() =>
      validateBlockDefinition(
        minimalBlock({
          colliders: [{ kind: "sphere", radius: -1 }],
        }),
      ),
    ).toThrow("invalid radius");
  });

  it("rejects capsule with invalid dimensions", () => {
    expect(() =>
      validateBlockDefinition(
        minimalBlock({
          colliders: [{ kind: "capsule", radius: 0, halfHeight: 1 }],
        }),
      ),
    ).toThrow("invalid dimensions");
  });

  it("rejects convex hull with too few points", () => {
    expect(() =>
      validateBlockDefinition(
        minimalBlock({
          colliders: [{ kind: "convexHull", points: [vec3(0, 0, 0)] }],
        }),
      ),
    ).toThrow("at least 4 points");
  });

  it("rejects trimesh with too few data", () => {
    expect(() =>
      validateBlockDefinition(
        minimalBlock({
          colliders: [{ kind: "trimesh", vertices: [0, 0, 0], indices: [] }],
        }),
      ),
    ).toThrow("at least one triangle");
  });

  it("rejects joint block with wrong number of parts", () => {
    expect(() =>
      validateBlockDefinition(
        minimalBlock({
          joint: { kind: "revolute", partA: "main", partB: "main", anchorA: "a1", anchorB: "a1" },
        }),
      ),
    ).toThrow("exactly two parts");
  });

  it("rejects joint connecting same part", () => {
    expect(() =>
      validateBlockDefinition(
        minimalBlock({
          parts: [{ id: "a" }, { id: "b" }],
          colliders: [
            { kind: "box", halfExtents: vec3(0.5, 0.5, 0.5), partId: "a" },
            { kind: "box", halfExtents: vec3(0.5, 0.5, 0.5), partId: "b" },
          ],
          anchors: [
            { id: "a1", position: vec3(0, 0, 0), normal: vec3(1, 0, 0), type: "struct", partId: "a" },
            { id: "b1", position: vec3(0, 0, 0), normal: vec3(-1, 0, 0), type: "struct", partId: "b" },
          ],
          joint: { kind: "revolute", partA: "a", partB: "a", anchorA: "a1", anchorB: "b1" },
        }),
      ),
    ).toThrow("two distinct parts");
  });
});

describe("BlockCatalog", () => {
  it("register and get", () => {
    const catalog = new BlockCatalog();
    catalog.register(minimalBlock());
    expect(catalog.has("test.block")).toBe(true);
    expect(catalog.get("test.block").id).toBe("test.block");
  });

  it("registerMany", () => {
    const catalog = new BlockCatalog();
    catalog.registerMany([
      minimalBlock({ id: "a", name: "A" }),
      minimalBlock({ id: "b", name: "B" }),
    ]);
    expect(catalog.list()).toHaveLength(2);
  });

  it("rejects duplicate registration", () => {
    const catalog = new BlockCatalog();
    catalog.register(minimalBlock());
    expect(() => catalog.register(minimalBlock())).toThrow("already contains");
  });

  it("throws on unknown block", () => {
    const catalog = new BlockCatalog();
    expect(() => catalog.get("nope")).toThrow("Unknown block");
  });

  it("getAnchor", () => {
    const catalog = new BlockCatalog();
    catalog.register(minimalBlock());
    expect(catalog.getAnchor("test.block", "a1").id).toBe("a1");
  });

  it("getAnchor throws on unknown anchor", () => {
    const catalog = new BlockCatalog();
    catalog.register(minimalBlock());
    expect(() => catalog.getAnchor("test.block", "nope")).toThrow("Unknown anchor");
  });

  it("getPart", () => {
    const catalog = new BlockCatalog();
    catalog.register(minimalBlock());
    expect(catalog.getPart("test.block", "main").id).toBe("main");
  });

  it("getPart throws on unknown part", () => {
    const catalog = new BlockCatalog();
    catalog.register(minimalBlock());
    expect(() => catalog.getPart("test.block", "nope")).toThrow("Unknown part");
  });
});

describe("structuralPolarityMatch", () => {
  it("neutral matches anything", () => {
    expect(structuralPolarityMatch("neutral", "positive")).toBe(true);
    expect(structuralPolarityMatch("neutral", "negative")).toBe(true);
    expect(structuralPolarityMatch("neutral", "neutral")).toBe(true);
    expect(structuralPolarityMatch("positive", "neutral")).toBe(true);
  });

  it("opposite polarities match", () => {
    expect(structuralPolarityMatch("positive", "negative")).toBe(true);
    expect(structuralPolarityMatch("negative", "positive")).toBe(true);
  });

  it("same polarities don't match", () => {
    expect(structuralPolarityMatch("positive", "positive")).toBe(false);
    expect(structuralPolarityMatch("negative", "negative")).toBe(false);
  });
});

describe("house structure blocks", () => {
  it("validates floor block", () => {
    expect(() => validateBlockDefinition(floorBlock)).not.toThrow();
    const norm = normalizeBlockDefinition(floorBlock);
    expect(norm.parts).toHaveLength(1);
    expect(norm.anchors).toHaveLength(4);
    expect(norm.colliders).toHaveLength(1);
  });

  it("validates wall block", () => {
    expect(() => validateBlockDefinition(wallBlock)).not.toThrow();
    const norm = normalizeBlockDefinition(wallBlock);
    expect(norm.anchors).toHaveLength(4);
  });

  it("validates roof block", () => {
    expect(() => validateBlockDefinition(roofBlock)).not.toThrow();
    const norm = normalizeBlockDefinition(roofBlock);
    expect(norm.anchors).toHaveLength(4);
  });

  it("validates wall-with-door compound block", () => {
    expect(() => validateBlockDefinition(wallDoorBlock)).not.toThrow();
    const norm = normalizeBlockDefinition(wallDoorBlock);
    expect(norm.parts).toHaveLength(2);
    expect(norm.parts.map((p) => p.id).sort()).toEqual(["door", "frame"]);
    expect(norm.colliders).toHaveLength(4); // 3 frame + 1 door
    expect(norm.anchors).toHaveLength(6); // 4 struct + 2 joint
    expect(norm.joint).toBeDefined();
    expect(norm.joint!.kind).toBe("revolute");
    expect(norm.joint!.motor).toBeUndefined();
  });

  it("registers all house blocks in a catalog", () => {
    const catalog = new BlockCatalog();
    catalog.registerMany([floorBlock, wallBlock, roofBlock, wallDoorBlock]);
    expect(catalog.list()).toHaveLength(4);
  });
});

describe("cloneBlockDefinition", () => {
  it("creates a deep clone", () => {
    const original = normalizeBlockDefinition(minimalBlock());
    const clone = cloneBlockDefinition(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    expect(clone.anchors[0]).not.toBe(original.anchors[0]);
    expect(clone.colliders[0]).not.toBe(original.colliders[0]);
  });
});
