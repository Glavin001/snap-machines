import { describe, it, expect } from "vitest";
import {
  BlockCatalog,
  BlockGraph,
  QUAT_IDENTITY,
  TRANSFORM_IDENTITY,
  compileMachinePlan,
  vec3,
  besiegePrimitives,
  besiegeCompounds,
  placeCompound,
  suspensionStrutTemplate,
  gripperTemplate,
  steeringWheelTemplate,
} from "../index.js";
import { exampleCatalog } from "../examples/catalog.js";

/**
 * Build a catalog with all besiege blocks + example blocks.
 */
function makeBesiegeCatalog(): BlockCatalog {
  return new BlockCatalog().registerMany([
    ...exampleCatalog,
    ...besiegePrimitives,
    ...besiegeCompounds,
  ]);
}

// ---------------------------------------------------------------------------
// Layer 0 — Primitive block validation
// ---------------------------------------------------------------------------

describe("Layer 0 — Primitive blocks", () => {
  const catalog = makeBesiegeCatalog();

  it("registers all primitives in the catalog without errors", () => {
    for (const block of besiegePrimitives) {
      expect(catalog.has(block.id)).toBe(true);
    }
  });

  it("validates the cylinder primitive", () => {
    const def = catalog.get("primitive.cylinder");
    expect(def.colliders[0].kind).toBe("cylinder");
    expect(def.anchors.length).toBeGreaterThanOrEqual(4);
  });

  it("validates the sphere primitive", () => {
    const def = catalog.get("primitive.sphere");
    expect(def.colliders[0].kind).toBe("sphere");
    expect(def.anchors.length).toBe(6);
  });

  it("validates the fixed joint primitive", () => {
    const def = catalog.get("joint.fixed");
    expect(def.joint).toBeDefined();
    expect(def.joint!.kind).toBe("fixed");
    expect(def.parts.length).toBe(2);
  });

  it("validates the slider joint primitive", () => {
    const def = catalog.get("joint.slider");
    expect(def.joint).toBeDefined();
    expect(def.joint!.kind).toBe("prismatic");
    expect(def.joint!.motor).toBeDefined();
  });

  it("validates the ball joint primitive", () => {
    const def = catalog.get("joint.ball");
    expect(def.joint).toBeDefined();
    expect(def.joint!.kind).toBe("spherical");
    expect(def.parts.length).toBe(2);
  });

  it("validates the passive hinge primitive", () => {
    const def = catalog.get("joint.hinge.passive");
    expect(def.joint).toBeDefined();
    expect(def.joint!.kind).toBe("revolute");
    expect(def.joint!.motor).toBeUndefined();
  });

  it("compiles a single block primitive into one body", () => {
    const g = new BlockGraph();
    g.addNode({ id: "cyl", typeId: "primitive.cylinder", transform: TRANSFORM_IDENTITY });
    const plan = compileMachinePlan(g, catalog);
    expect(plan.bodies.length).toBe(1);
    expect(plan.bodies[0].colliders.length).toBe(1);
    expect(plan.bodies[0].colliders[0].kind).toBe("cylinder");
  });

  it("compiles a slider joint into two bodies with one joint", () => {
    const g = new BlockGraph();
    g.addNode({ id: "slider", typeId: "joint.slider", transform: TRANSFORM_IDENTITY });
    const plan = compileMachinePlan(g, catalog);
    expect(plan.bodies.length).toBe(2);
    expect(plan.joints.length).toBe(1);
    expect(plan.joints[0].kind).toBe("prismatic");
  });
});

// ---------------------------------------------------------------------------
// Layer 1 — Compound block validation
// ---------------------------------------------------------------------------

describe("Layer 1 — Compound blocks", () => {
  const catalog = makeBesiegeCatalog();

  it("registers all compounds in the catalog without errors", () => {
    for (const block of besiegeCompounds) {
      expect(catalog.has(block.id)).toBe(true);
    }
  });

  it("validates the wheel compound", () => {
    const def = catalog.get("compound.wheel");
    expect(def.parts.length).toBe(2);
    expect(def.joint).toBeDefined();
    expect(def.joint!.kind).toBe("revolute");
    expect(def.joint!.motor).toBeDefined();
  });

  it("validates the propeller compound", () => {
    const def = catalog.get("compound.propeller");
    expect(def.parts.length).toBe(2);
    expect(def.joint!.kind).toBe("revolute");
    expect(def.behaviors.length).toBe(1);
    expect(def.behaviors[0].kind).toBe("thruster");
  });

  it("validates the jet engine compound", () => {
    const def = catalog.get("compound.jet");
    expect(def.parts.length).toBe(1);  // single part
    expect(def.behaviors.length).toBe(1);
    expect(def.behaviors[0].kind).toBe("thruster");
  });

  it("validates the shock absorber compound", () => {
    const def = catalog.get("compound.shock");
    expect(def.joint).toBeDefined();
    expect(def.joint!.kind).toBe("prismatic");
    expect(def.joint!.motor).toBeDefined();
    expect(def.joint!.limits).toBeDefined();
  });

  it("validates the arm segment compound", () => {
    const def = catalog.get("compound.arm");
    expect(def.joint!.kind).toBe("revolute");
    expect(def.joint!.motor?.mode).toBe("position");
    expect(def.joint!.limits).toBeDefined();
  });

  it("validates the control surface compound", () => {
    const def = catalog.get("compound.flap");
    expect(def.joint!.kind).toBe("revolute");
    expect(def.joint!.limits).toBeDefined();
  });

  it("compiles a wheel compound into two bodies with one joint", () => {
    const g = new BlockGraph();
    g.addNode({ id: "w", typeId: "compound.wheel", transform: TRANSFORM_IDENTITY });
    const plan = compileMachinePlan(g, catalog);
    expect(plan.bodies.length).toBe(2);
    expect(plan.joints.length).toBe(1);
    expect(plan.joints[0].kind).toBe("revolute");
  });

  it("compiles block + wheel into correct topology", () => {
    const g = new BlockGraph();
    g.addNode({ id: "body", typeId: "primitive.block.1x1", transform: { position: vec3(0, 0, 0), rotation: QUAT_IDENTITY } });
    g.addNode({ id: "wheel", typeId: "compound.wheel", transform: { position: vec3(0, 0, 0.65), rotation: QUAT_IDENTITY } });
    g.addConnection({
      a: { blockId: "body", anchorId: "zp" },
      b: { blockId: "wheel", anchorId: "mount.attach" },
    });
    const plan = compileMachinePlan(g, catalog);
    // body + wheel.mount merge into one body, wheel.wheel is the second body
    expect(plan.bodies.length).toBe(2);
    expect(plan.joints.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Compound Template System
// ---------------------------------------------------------------------------

describe("Compound template system", () => {
  const catalog = makeBesiegeCatalog();

  it("expands a suspension strut template into the graph", () => {
    const g = new BlockGraph();
    g.addNode({ id: "chassis", typeId: "primitive.block.1x1", transform: { position: vec3(0, 2, 0), rotation: QUAT_IDENTITY } });

    const result = placeCompound(g, catalog, suspensionStrutTemplate, "chassis", "yn", "fl/");

    expect(result.blockIds.length).toBe(2);  // shock + wheel
    expect(result.blockIds).toContain("fl/shock");
    expect(result.blockIds).toContain("fl/wheel");

    // Verify blocks were added to the graph
    expect(g.getNode("fl/shock")).toBeDefined();
    expect(g.getNode("fl/wheel")).toBeDefined();

    // Verify connections exist
    const connections = g.listConnections();
    expect(connections.length).toBeGreaterThanOrEqual(2);  // chassis→shock + shock→wheel

    // Compile and verify physics topology
    const plan = compileMachinePlan(g, catalog);
    expect(plan.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    // Should have bodies for: chassis+shock.upper (merged), shock.lower+wheel.mount (merged), wheel.wheel
    expect(plan.bodies.length).toBeGreaterThanOrEqual(3);
    // Should have joints for: shock prismatic + wheel revolute
    expect(plan.joints.length).toBe(2);
  });

  it("expands a gripper template into the graph", () => {
    const g = new BlockGraph();
    g.addNode({ id: "arm-tip", typeId: "primitive.block.1x1", transform: { position: vec3(0, 3, 0), rotation: QUAT_IDENTITY } });

    const result = placeCompound(g, catalog, gripperTemplate, "arm-tip", "yn", "grip/");

    expect(result.blockIds.length).toBe(5);  // palm + 2 hinges + 2 fingers
    expect(result.exposedAnchors.has("top")).toBe(true);

    const plan = compileMachinePlan(g, catalog);
    expect(plan.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    // Should have joints for the two finger hinges
    expect(plan.joints.length).toBe(2);
  });

  it("expands a steering wheel template into the graph", () => {
    const g = new BlockGraph();
    g.addNode({ id: "chassis", typeId: "primitive.block.1x1", transform: { position: vec3(0, 2, 0), rotation: QUAT_IDENTITY } });

    const result = placeCompound(g, catalog, steeringWheelTemplate, "chassis", "yn", "fl/");

    expect(result.blockIds.length).toBe(3);  // knuckle + steer-hinge + wheel
    expect(result.exposedAnchors.has("side.xp")).toBe(true);

    const plan = compileMachinePlan(g, catalog);
    expect(plan.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    // Should have joints for: steering hinge + wheel revolute
    expect(plan.joints.length).toBe(2);
  });

  it("supports multiple compound placements without ID collisions", () => {
    const g = new BlockGraph();
    g.addNode({ id: "chassis", typeId: "primitive.block.2x1", transform: { position: vec3(0, 2, 0), rotation: QUAT_IDENTITY } });

    placeCompound(g, catalog, suspensionStrutTemplate, "chassis", "zp.l", "fl/");
    placeCompound(g, catalog, suspensionStrutTemplate, "chassis", "zp.r", "fr/");

    // Should have chassis + 2 shocks + 2 wheels = 5 blocks
    expect(g.listNodes().length).toBe(5);
    expect(g.getNode("fl/shock")).toBeDefined();
    expect(g.getNode("fr/shock")).toBeDefined();
    expect(g.getNode("fl/wheel")).toBeDefined();
    expect(g.getNode("fr/wheel")).toBeDefined();

    const plan = compileMachinePlan(g, catalog);
    expect(plan.diagnostics.filter((d) => d.level === "error")).toEqual([]);
  });
});
