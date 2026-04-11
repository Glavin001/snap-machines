import { describe, it, expect } from "vitest";
import { BlockCatalog, BlockDefinition } from "../schema.js";
import { BlockGraph } from "../graph.js";
import { TRANSFORM_IDENTITY, vec3, transform, QUAT_IDENTITY } from "../math.js";
import { compileMachinePlan } from "../compile/plan.js";
import {
  rewritePlanActions,
  generateControlMap,
  updateControlMapInput,
  resetControlMapState,
  ControlMap,
} from "../control-map.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function cubeBlock(): BlockDefinition {
  return {
    id: "cube",
    name: "Cube",
    mass: 2,
    colliders: [{ kind: "box", halfExtents: vec3(0.5, 0.5, 0.5) }],
    anchors: [
      { id: "xp", position: vec3(0.5, 0, 0), normal: vec3(1, 0, 0), type: "struct" },
      { id: "xn", position: vec3(-0.5, 0, 0), normal: vec3(-1, 0, 0), type: "struct" },
      { id: "yp", position: vec3(0, 0.5, 0), normal: vec3(0, 1, 0), type: "struct" },
    ],
  };
}

function motorHingeBlock(): BlockDefinition {
  return {
    id: "motor-hinge",
    name: "Motor Hinge",
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
      motor: {
        mode: "velocity",
        targetVelocity: 0,
        stiffness: 0,
        damping: 10,
        input: { action: "hingeSpin", scale: 5 },
        inputTarget: "velocity",
      },
    },
  };
}

function armBlock(): BlockDefinition {
  return {
    id: "arm",
    name: "Arm Segment",
    parts: [
      { id: "mount", mass: 0.5 },
      { id: "link", mass: 0.5 },
    ],
    colliders: [
      { kind: "box", halfExtents: vec3(0.15, 0.15, 0.15), partId: "mount" },
      { kind: "box", halfExtents: vec3(0.15, 0.5, 0.15), partId: "link" },
    ],
    anchors: [
      { id: "mount.attach", partId: "mount", position: vec3(0, -0.15, 0), normal: vec3(0, -1, 0), type: "struct" },
      { id: "mount.joint", partId: "mount", position: vec3(0, 0, 0), normal: vec3(1, 0, 0), type: "joint", polarity: "positive" },
      { id: "link.joint", partId: "link", position: vec3(0, 0.5, 0), normal: vec3(-1, 0, 0), type: "joint", polarity: "negative" },
      { id: "link.tip", partId: "link", position: vec3(0, -0.5, 0), normal: vec3(0, -1, 0), type: "struct" },
    ],
    joint: {
      kind: "revolute",
      partA: "mount",
      partB: "link",
      anchorA: "mount.joint",
      anchorB: "link.joint",
      axis: vec3(0, 0, 1),
      limits: { min: -Math.PI / 2, max: Math.PI / 2 },
      motor: {
        mode: "position",
        targetPosition: 0,
        stiffness: 100,
        damping: 10,
        input: { action: "armPitch", scale: Math.PI / 2 },
        inputTarget: "position",
      },
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

// ---------------------------------------------------------------------------
// Helper: build a graph, compile, and generate the ControlMap
// ---------------------------------------------------------------------------

function buildTestPlan(blocks: BlockDefinition[], setup: (g: BlockGraph) => void) {
  const catalog = new BlockCatalog();
  for (const b of blocks) catalog.register(b);
  const graph = new BlockGraph();
  setup(graph);
  const plan = compileMachinePlan(graph, catalog);
  expect(plan.diagnostics.filter((d) => d.level === "error")).toHaveLength(0);
  return { catalog, graph, plan };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rewritePlanActions", () => {
  it("assigns unique action names and resets scale/invert", () => {
    const { plan } = buildTestPlan([cubeBlock(), motorHingeBlock()], (g) => {
      g.addNode({ id: "base", typeId: "cube", transform: TRANSFORM_IDENTITY });
      g.addNode({ id: "h1", typeId: "motor-hinge", transform: transform(vec3(1, 0, 0), QUAT_IDENTITY) });
      g.addConnection({ a: { blockId: "base", anchorId: "xp" }, b: { blockId: "h1", anchorId: "base.end" } });
    });

    const originals = rewritePlanActions(plan);

    expect(originals.size).toBe(1);
    const joint = plan.joints[0]!;
    expect(joint.motor!.input!.action).toMatch(/^ctrl:joint:/);
    expect(joint.motor!.input!.scale).toBe(1);

    const [actionName, orig] = [...originals.entries()][0]!;
    expect(orig.action).toBe("hingeSpin");
    expect(orig.scale).toBe(5);
    expect(actionName).toBe(joint.motor!.input!.action);
  });

  it("handles invert by negating the stored scale", () => {
    const { plan } = buildTestPlan([cubeBlock(), motorHingeBlock()], (g) => {
      g.addNode({ id: "base", typeId: "cube", transform: TRANSFORM_IDENTITY });
      g.addNode({ id: "h1", typeId: "motor-hinge", transform: transform(vec3(1, 0, 0), QUAT_IDENTITY) });
      g.addConnection({ a: { blockId: "base", anchorId: "xp" }, b: { blockId: "h1", anchorId: "base.end" } });
    });

    // Manually set invert on the motor input before rewrite
    plan.joints[0]!.motor!.input!.invert = true;

    const originals = rewritePlanActions(plan);
    const [, orig] = [...originals.entries()][0]!;
    expect(orig.scale).toBe(-5); // 5 * -1
    expect(plan.joints[0]!.motor!.input!.invert).toBe(false);
  });

  it("rewrites behavior inputs too", () => {
    const { plan } = buildTestPlan([cubeBlock(), thrusterBlock()], (g) => {
      g.addNode({ id: "base", typeId: "cube", transform: TRANSFORM_IDENTITY });
      g.addNode({ id: "t1", typeId: "thruster", transform: transform(vec3(1, 0, 0), QUAT_IDENTITY) });
      g.addConnection({ a: { blockId: "base", anchorId: "xp" }, b: { blockId: "t1", anchorId: "mount" } });
    });

    const originals = rewritePlanActions(plan);
    expect(originals.size).toBe(1);

    const behavior = plan.behaviors[0]!;
    expect(behavior.input!.action).toMatch(/^ctrl:behavior:/);
    expect(behavior.input!.scale).toBe(1);

    const [, orig] = [...originals.entries()][0]!;
    expect(orig.action).toBe("throttle");
  });

  it("gives each joint a distinct action when multiple joints share the same original action", () => {
    const { plan } = buildTestPlan([cubeBlock(), motorHingeBlock()], (g) => {
      g.addNode({ id: "base", typeId: "cube", transform: TRANSFORM_IDENTITY });
      g.addNode({ id: "h1", typeId: "motor-hinge", transform: transform(vec3(1, 0, 0), QUAT_IDENTITY) });
      g.addNode({ id: "h2", typeId: "motor-hinge", transform: transform(vec3(-1, 0, 0), QUAT_IDENTITY) });
      g.addConnection({ a: { blockId: "base", anchorId: "xp" }, b: { blockId: "h1", anchorId: "base.end" } });
      g.addConnection({ a: { blockId: "base", anchorId: "xn" }, b: { blockId: "h2", anchorId: "base.end" } });
    });

    const originals = rewritePlanActions(plan);
    expect(originals.size).toBe(2);

    const actions = [...originals.keys()];
    expect(actions[0]).not.toBe(actions[1]);
    // Both have the same original action
    for (const [, orig] of originals) {
      expect(orig.action).toBe("hingeSpin");
    }
  });
});

describe("generateControlMap", () => {
  it("creates entries with correct default keys for velocity motors", () => {
    const { catalog, graph, plan } = buildTestPlan([cubeBlock(), motorHingeBlock()], (g) => {
      g.addNode({ id: "base", typeId: "cube", transform: TRANSFORM_IDENTITY });
      g.addNode({ id: "h1", typeId: "motor-hinge", transform: transform(vec3(1, 0, 0), QUAT_IDENTITY) });
      g.addConnection({ a: { blockId: "base", anchorId: "xp" }, b: { blockId: "h1", anchorId: "base.end" } });
    });

    const originals = rewritePlanActions(plan);
    const map = generateControlMap(plan, originals, catalog, graph);

    expect(map).toHaveLength(1);
    const entry = map[0]!;
    expect(entry.actuatorType).toBe("velocity");
    expect(entry.positiveKey).toBe("e");
    expect(entry.negativeKey).toBe("q");
    expect(entry.scale).toBe(5);
    expect(entry.blockId).toBe("h1");
    expect(entry.blockName).toBe("Motor Hinge");
    expect(entry.originalAction).toBe("hingeSpin");
    expect(entry.enabled).toBe(true);
  });

  it("creates entries with correct default keys for position motors", () => {
    const { catalog, graph, plan } = buildTestPlan([cubeBlock(), armBlock()], (g) => {
      g.addNode({ id: "base", typeId: "cube", transform: TRANSFORM_IDENTITY });
      g.addNode({ id: "a1", typeId: "arm", transform: transform(vec3(0, 1, 0), QUAT_IDENTITY) });
      g.addConnection({ a: { blockId: "base", anchorId: "yp" }, b: { blockId: "a1", anchorId: "mount.attach" } });
    });

    const originals = rewritePlanActions(plan);
    const map = generateControlMap(plan, originals, catalog, graph);

    expect(map).toHaveLength(1);
    const entry = map[0]!;
    expect(entry.actuatorType).toBe("position");
    expect(entry.positiveKey).toBe("w");
    expect(entry.negativeKey).toBe("s");
    expect(entry.scale).toBeCloseTo(Math.PI / 2);
    expect(entry.limits).toBeDefined();
    expect(entry.limits!.min).toBeCloseTo(-Math.PI / 2);
    expect(entry.limits!.max).toBeCloseTo(Math.PI / 2);
  });

  it("creates trigger entries for behaviors", () => {
    const { catalog, graph, plan } = buildTestPlan([cubeBlock(), thrusterBlock()], (g) => {
      g.addNode({ id: "base", typeId: "cube", transform: TRANSFORM_IDENTITY });
      g.addNode({ id: "t1", typeId: "thruster", transform: transform(vec3(1, 0, 0), QUAT_IDENTITY) });
      g.addConnection({ a: { blockId: "base", anchorId: "xp" }, b: { blockId: "t1", anchorId: "mount" } });
    });

    const originals = rewritePlanActions(plan);
    const map = generateControlMap(plan, originals, catalog, graph);

    expect(map).toHaveLength(1);
    const entry = map[0]!;
    expect(entry.actuatorType).toBe("trigger");
    expect(entry.positiveKey).toBe(" ");
    expect(entry.negativeKey).toBe("");
    expect(entry.originalAction).toBe("throttle");
  });
});

describe("updateControlMapInput", () => {
  it("produces velocity input from key state", () => {
    const map: ControlMap = [
      {
        id: "j1", label: "Hinge (h1)", blockId: "h1", blockName: "Hinge",
        actuatorType: "velocity", actionName: "ctrl:joint:j1",
        positiveKey: "e", negativeKey: "q", scale: 5,
        enabled: true,
        currentTarget: 0, actualPosition: 0, originalAction: "hingeSpin", originalScale: 5,
      },
    ];

    // No keys pressed
    let input = updateControlMapInput(map, new Set(), 1 / 60);
    expect(input["ctrl:joint:j1"]).toBe(0);

    // Positive key pressed
    input = updateControlMapInput(map, new Set(["e"]), 1 / 60);
    expect(input["ctrl:joint:j1"]).toBe(5);

    // Negative key pressed
    input = updateControlMapInput(map, new Set(["q"]), 1 / 60);
    expect(input["ctrl:joint:j1"]).toBe(-5);

    // Both keys pressed (cancel out)
    input = updateControlMapInput(map, new Set(["q", "e"]), 1 / 60);
    expect(input["ctrl:joint:j1"]).toBe(0);
  });

  it("accumulates position target over time", () => {
    const map: ControlMap = [
      {
        id: "j1", label: "Arm (a1)", blockId: "a1", blockName: "Arm",
        actuatorType: "position", actionName: "ctrl:joint:j1",
        positiveKey: "w", negativeKey: "s", scale: 2,
        enabled: true,
        currentTarget: 0, actualPosition: 0, originalAction: "armPitch", originalScale: 2,
      },
    ];

    const dt = 0.5;

    // First frame: W held → target = 0 + 1 * 2 * 0.5 = 1.0
    let input = updateControlMapInput(map, new Set(["w"]), dt);
    expect(input["ctrl:joint:j1"]).toBeCloseTo(1.0);
    expect(map[0]!.currentTarget).toBeCloseTo(1.0);

    // Second frame: W still held → target = 1.0 + 1 * 2 * 0.5 = 2.0
    input = updateControlMapInput(map, new Set(["w"]), dt);
    expect(input["ctrl:joint:j1"]).toBeCloseTo(2.0);

    // Third frame: no key → target stays at 2.0
    input = updateControlMapInput(map, new Set(), dt);
    expect(input["ctrl:joint:j1"]).toBeCloseTo(2.0);
    expect(map[0]!.currentTarget).toBeCloseTo(2.0);

    // Fourth frame: S held → target = 2.0 + (-1) * 2 * 0.5 = 1.0
    input = updateControlMapInput(map, new Set(["s"]), dt);
    expect(input["ctrl:joint:j1"]).toBeCloseTo(1.0);
  });

  it("clamps position target to joint limits", () => {
    const map: ControlMap = [
      {
        id: "j1", label: "Arm (a1)", blockId: "a1", blockName: "Arm",
        actuatorType: "position", actionName: "ctrl:joint:j1",
        positiveKey: "w", negativeKey: "s", scale: 10,
        enabled: true,
        currentTarget: 0, actualPosition: 0, limits: { min: -1, max: 1 },
        originalAction: "armPitch", originalScale: 10,
      },
    ];

    // Large dt to overshoot: target = 0 + 1 * 10 * 1 = 10, clamped to 1
    updateControlMapInput(map, new Set(["w"]), 1.0);
    expect(map[0]!.currentTarget).toBe(1);

    // Go negative: target = 1 + (-1) * 10 * 1 = -9, clamped to -1
    updateControlMapInput(map, new Set(["s"]), 1.0);
    expect(map[0]!.currentTarget).toBe(-1);
  });

  it("produces trigger input from key state", () => {
    const map: ControlMap = [
      {
        id: "b1", label: "Thruster (t1)", blockId: "t1", blockName: "Thruster",
        actuatorType: "trigger", actionName: "ctrl:behavior:b1",
        positiveKey: " ", negativeKey: "", scale: 1,
        enabled: true,
        currentTarget: 0, actualPosition: 0, originalAction: "throttle", originalScale: 1,
      },
    ];

    let input = updateControlMapInput(map, new Set(), 1 / 60);
    expect(input["ctrl:behavior:b1"]).toBe(0);

    input = updateControlMapInput(map, new Set([" "]), 1 / 60);
    expect(input["ctrl:behavior:b1"]).toBe(1);
  });

  it("handles negative scale (flipped direction)", () => {
    const map: ControlMap = [
      {
        id: "j1", label: "Hinge (h1)", blockId: "h1", blockName: "Hinge",
        actuatorType: "velocity", actionName: "ctrl:joint:j1",
        positiveKey: "e", negativeKey: "q", scale: -5,
        enabled: true,
        currentTarget: 0, actualPosition: 0, originalAction: "hingeSpin", originalScale: 5,
      },
    ];

    const input = updateControlMapInput(map, new Set(["e"]), 1 / 60);
    expect(input["ctrl:joint:j1"]).toBe(-5); // Flipped
  });

  it("ignores disabled actuators and resets disabled position targets", () => {
    const map: ControlMap = [
      {
        id: "j1", label: "Hinge (h1)", blockId: "h1", blockName: "Hinge",
        actuatorType: "velocity", actionName: "ctrl:joint:j1",
        positiveKey: "e", negativeKey: "q", scale: 5,
        enabled: false,
        currentTarget: 0, actualPosition: 0, originalAction: "hingeSpin", originalScale: 5,
      },
      {
        id: "j2", label: "Arm (a1)", blockId: "a1", blockName: "Arm",
        actuatorType: "position", actionName: "ctrl:joint:j2",
        positiveKey: "w", negativeKey: "s", scale: 2,
        enabled: false,
        currentTarget: 1.5, actualPosition: 0.2, originalAction: "armPitch", originalScale: 2,
      },
    ];

    const input = updateControlMapInput(map, new Set(["e", "w"]), 0.5);
    expect(input["ctrl:joint:j1"]).toBe(0);
    expect(input["ctrl:joint:j2"]).toBe(0);
    expect(input["ctrl:joint:j2:vff"]).toBe(0);
    expect(map[1]!.currentTarget).toBe(0);
  });
});

describe("resetControlMapState", () => {
  it("resets position accumulators to zero", () => {
    const map: ControlMap = [
      {
        id: "j1", label: "Arm", blockId: "a1", blockName: "Arm",
        actuatorType: "position", actionName: "ctrl:joint:j1",
        positiveKey: "w", negativeKey: "s", scale: 2,
        enabled: true,
        currentTarget: 1.5, actualPosition: 0, originalAction: "armPitch", originalScale: 2,
      },
    ];

    resetControlMapState(map);
    expect(map[0]!.currentTarget).toBe(0);
  });
});
