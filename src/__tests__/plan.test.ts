import { describe, it, expect } from "vitest";
import { compileMachinePlan } from "../compile/plan.js";
import { BlockCatalog, BlockDefinition } from "../schema.js";
import { BlockGraph } from "../graph.js";
import { QUAT_IDENTITY, TRANSFORM_IDENTITY, vec3, transform, VEC3_Y, lookRotation } from "../math.js";
import { alignAnchorPair, getWorldAnchorTransform } from "../snap.js";
import { floorBlock, wallBlock, roofBlock, wallDoorBlock } from "../examples/catalog.js";

function cubeBlock(): BlockDefinition {
  return {
    id: "cube",
    name: "Cube",
    mass: 2,
    colliders: [{ kind: "box", halfExtents: vec3(0.5, 0.5, 0.5) }],
    anchors: [
      { id: "xp", position: vec3(0.5, 0, 0), normal: vec3(1, 0, 0), type: "struct" },
      { id: "xn", position: vec3(-0.5, 0, 0), normal: vec3(-1, 0, 0), type: "struct" },
    ],
  };
}

function hingeBlock(): BlockDefinition {
  return {
    id: "hinge",
    name: "Hinge",
    parts: [
      { id: "base", mass: 0.5 },
      { id: "rotor", mass: 0.5 },
    ],
    colliders: [
      { kind: "box", halfExtents: vec3(0.25, 0.125, 0.125), partId: "base" },
      { kind: "box", halfExtents: vec3(0.25, 0.125, 0.125), partId: "rotor" },
    ],
    anchors: [
      { id: "base.end", partId: "base", position: vec3(-0.25, 0, 0), normal: vec3(-1, 0, 0), type: "struct" },
      { id: "base.joint", partId: "base", position: vec3(0, 0, 0), normal: vec3(1, 0, 0), type: "joint", polarity: "positive" },
      { id: "rotor.joint", partId: "rotor", position: vec3(0, 0, 0), normal: vec3(-1, 0, 0), type: "joint", polarity: "negative" },
      { id: "rotor.end", partId: "rotor", position: vec3(0.25, 0, 0), normal: vec3(1, 0, 0), type: "struct" },
    ],
    joint: {
      kind: "revolute",
      partA: "base",
      partB: "rotor",
      anchorA: "base.joint",
      anchorB: "rotor.joint",
      axis: vec3(0, 1, 0),
    },
  };
}

function thrusterBlock(): BlockDefinition {
  return {
    id: "thruster",
    name: "Thruster",
    mass: 0.5,
    colliders: [{ kind: "box", halfExtents: vec3(0.25, 0.125, 0.125) }],
    anchors: [
      { id: "mount", position: vec3(-0.25, 0, 0), normal: vec3(-1, 0, 0), type: "struct" },
    ],
    behaviors: [
      {
        kind: "thruster",
        props: { force: 10, localDirection: { x: 1, y: 0, z: 0 } },
        input: { action: "throttle" },
      },
    ],
  };
}

describe("compileMachinePlan - single block", () => {
  it("compiles a single cube into one body", () => {
    const catalog = new BlockCatalog();
    catalog.register(cubeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });

    const plan = compileMachinePlan(graph, catalog);
    expect(plan.diagnostics.filter((d) => d.level === "error")).toHaveLength(0);
    expect(plan.bodies).toHaveLength(1);
    expect(plan.bodies[0]!.kind).toBe("dynamic");
    expect(plan.bodies[0]!.colliders).toHaveLength(1);
    expect(plan.bodies[0]!.colliders[0]!.kind).toBe("box");
    expect(plan.joints).toHaveLength(0);
    expect(plan.mounts).toHaveLength(1);
  });
});

describe("compileMachinePlan - connected cubes", () => {
  it("merges two connected cubes into one body", () => {
    const catalog = new BlockCatalog();
    catalog.register(cubeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addNode({ id: "n2", typeId: "cube", transform: transform(vec3(1, 0, 0), QUAT_IDENTITY) });
    graph.addConnection({ a: { blockId: "n1", anchorId: "xp" }, b: { blockId: "n2", anchorId: "xn" } });

    const plan = compileMachinePlan(graph, catalog);
    expect(plan.bodies).toHaveLength(1);
    expect(plan.bodies[0]!.colliders).toHaveLength(2);
    expect(plan.bodies[0]!.sourceBlocks).toContain("n1");
    expect(plan.bodies[0]!.sourceBlocks).toContain("n2");
  });
});

describe("compileMachinePlan - hinge block", () => {
  it("creates two bodies and one joint for a hinge", () => {
    const catalog = new BlockCatalog();
    catalog.register(hingeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "h1", typeId: "hinge", transform: TRANSFORM_IDENTITY });

    const plan = compileMachinePlan(graph, catalog);
    expect(plan.bodies).toHaveLength(2);
    expect(plan.joints).toHaveLength(1);
    expect(plan.joints[0]!.kind).toBe("revolute");
    expect(plan.joints[0]!.bodyAId).not.toBe(plan.joints[0]!.bodyBId);
  });
});

describe("compileMachinePlan - behaviors", () => {
  it("collects behavior plans", () => {
    const catalog = new BlockCatalog();
    catalog.register(thrusterBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "t1", typeId: "thruster", transform: TRANSFORM_IDENTITY });

    const plan = compileMachinePlan(graph, catalog);
    expect(plan.behaviors).toHaveLength(1);
    expect(plan.behaviors[0]!.kind).toBe("thruster");
    expect(plan.behaviors[0]!.blockId).toBe("t1");
  });
});

describe("compileMachinePlan - validation errors", () => {
  it("returns errors for invalid graph", () => {
    const catalog = new BlockCatalog();
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "unknown", transform: TRANSFORM_IDENTITY });

    const plan = compileMachinePlan(graph, catalog);
    expect(plan.diagnostics.some((d) => d.level === "error")).toBe(true);
    expect(plan.bodies).toHaveLength(0);
  });
});

describe("compileMachinePlan - cube + hinge + cube", () => {
  it("creates correct topology with structural connections through hinge", () => {
    const catalog = new BlockCatalog();
    catalog.register(cubeBlock());
    catalog.register(hingeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "c1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    graph.addNode({ id: "h1", typeId: "hinge", transform: transform(vec3(0.75, 0, 0), QUAT_IDENTITY) });
    graph.addNode({ id: "c2", typeId: "cube", transform: transform(vec3(1.5, 0, 0), QUAT_IDENTITY) });

    // c1.xp -> h1.base.end (structural)
    graph.addConnection({ a: { blockId: "c1", anchorId: "xp" }, b: { blockId: "h1", anchorId: "base.end" } });
    // h1.rotor.end -> c2.xn (structural)
    graph.addConnection({ a: { blockId: "h1", anchorId: "rotor.end" }, b: { blockId: "c2", anchorId: "xn" } });

    const plan = compileMachinePlan(graph, catalog);
    expect(plan.diagnostics.filter((d) => d.level === "error")).toHaveLength(0);
    // cube1 + hinge.base merge into one body, hinge.rotor + cube2 merge into another
    expect(plan.bodies).toHaveLength(2);
    expect(plan.joints).toHaveLength(1);
  });
});

describe("compileMachinePlan - mass distribution", () => {
  it("assigns mass to colliders", () => {
    const catalog = new BlockCatalog();
    catalog.register(cubeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });

    const plan = compileMachinePlan(graph, catalog);
    const collider = plan.bodies[0]!.colliders[0]!;
    expect(collider.mass).toBe(2); // full block mass goes to single collider
  });
});

describe("compileMachinePlan - fixed body kind", () => {
  it("respects fixed rigid body kind", () => {
    const catalog = new BlockCatalog();
    catalog.register({
      ...cubeBlock(),
      id: "fixed-cube",
      name: "Fixed Cube",
      parts: [{ id: "main", rigidBodyKind: "fixed" as const }],
    });
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "fixed-cube", transform: TRANSFORM_IDENTITY });

    const plan = compileMachinePlan(graph, catalog);
    expect(plan.bodies[0]!.kind).toBe("fixed");
  });
});

// ---------------------------------------------------------------------------
// House structure – compound machine test
// ---------------------------------------------------------------------------

function snapBlockHelper(
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

describe("compileMachinePlan - house structure", () => {
  it("compiles a house with a hinged door into correct topology", () => {
    const catalog = new BlockCatalog();
    catalog.registerMany([floorBlock, wallBlock, roofBlock, wallDoorBlock]);

    const g = new BlockGraph();
    g.addNode({
      id: "floor",
      typeId: "structure.floor.4x4",
      transform: { position: vec3(0, 0.1, 0), rotation: QUAT_IDENTITY },
    });

    // 3 plain walls
    snapBlockHelper(g, catalog, {
      id: "wall-xp",
      typeId: "structure.wall.4x3",
      targetBlockId: "floor",
      targetAnchorId: "edge.xp",
      sourceAnchorId: "bottom",
    });
    snapBlockHelper(g, catalog, {
      id: "wall-xn",
      typeId: "structure.wall.4x3",
      targetBlockId: "floor",
      targetAnchorId: "edge.xn",
      sourceAnchorId: "bottom",
    });
    snapBlockHelper(g, catalog, {
      id: "wall-zn",
      typeId: "structure.wall.4x3",
      targetBlockId: "floor",
      targetAnchorId: "edge.zn",
      sourceAnchorId: "bottom",
    });

    // Wall with door
    snapBlockHelper(g, catalog, {
      id: "wall-door",
      typeId: "structure.wall-door.4x3",
      targetBlockId: "floor",
      targetAnchorId: "edge.zp",
      sourceAnchorId: "bottom",
    });

    // Roof
    snapBlockHelper(g, catalog, {
      id: "roof",
      typeId: "structure.roof.4x4",
      targetBlockId: "wall-xp",
      targetAnchorId: "top",
      sourceAnchorId: "edge.xp",
    });

    const plan = compileMachinePlan(g, catalog);
    expect(plan.diagnostics.filter((d) => d.level === "error")).toHaveLength(0);

    // All structural parts (floor, 3 walls, door frame, roof) merge into one body.
    // The door panel is a separate dynamic body.
    expect(plan.bodies).toHaveLength(2);

    // One revolute joint for the door hinge
    expect(plan.joints).toHaveLength(1);
    expect(plan.joints[0]!.kind).toBe("revolute");

    // The door joint should have no motor
    expect(plan.joints[0]!.motor).toBeUndefined();
  });
});
