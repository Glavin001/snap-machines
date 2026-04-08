import { describe, it, expect, vi } from "vitest";
import {
  RapierMachineRuntime,
  buildGraphIntoRapier,
  createRigidBodyDesc,
  createColliderDesc,
  createJointData,
  readInputBinding,
  createThrusterBehaviorFactory,
} from "../adapters/rapier.js";
import type {
  RapierModuleLike,
  RapierWorldLike,
  RapierRigidBodyDescLike,
  RapierColliderDescLike,
  RapierRigidBodyLike,
  RapierImpulseJointLike,
} from "../adapters/rapier.js";
import { BlockCatalog, BlockDefinition } from "../schema.js";
import { BlockGraph } from "../graph.js";
import { QUAT_IDENTITY, TRANSFORM_IDENTITY, vec3, transform } from "../math.js";
import { compileMachinePlan } from "../compile/plan.js";

function mockDesc(): RapierColliderDescLike & RapierRigidBodyDescLike {
  const self: any = {};
  for (const method of [
    "setTranslation", "setRotation", "setMass", "setSensor",
    "setFriction", "setRestitution", "setCollisionGroups", "setSolverGroups",
  ]) {
    self[method] = vi.fn().mockReturnValue(self);
  }
  return self;
}

function mockBody(): RapierRigidBodyLike {
  return {
    translation: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }),
    rotation: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0, w: 1 }),
    recomputeMassPropertiesFromColliders: vi.fn(),
    addForce: vi.fn(),
    addForceAtPoint: vi.fn(),
    addTorque: vi.fn(),
    applyImpulse: vi.fn(),
    applyImpulseAtPoint: vi.fn(),
  };
}

function mockJoint(): RapierImpulseJointLike {
  return {
    configureMotorPosition: vi.fn(),
    configureMotorVelocity: vi.fn(),
    configureMotor: vi.fn(),
    setMotorMaxForce: vi.fn(),
    setLimits: vi.fn(),
    setContactsEnabled: vi.fn(),
  };
}

function mockRapier(): RapierModuleLike {
  const desc = mockDesc;
  return {
    RigidBodyDesc: {
      dynamic: vi.fn().mockImplementation(() => desc()),
      fixed: vi.fn().mockImplementation(() => desc()),
      kinematicPositionBased: vi.fn().mockImplementation(() => desc()),
      kinematicVelocityBased: vi.fn().mockImplementation(() => desc()),
    },
    ColliderDesc: {
      cuboid: vi.fn().mockImplementation(() => desc()),
      ball: vi.fn().mockImplementation(() => desc()),
      capsule: vi.fn().mockImplementation(() => desc()),
      cylinder: vi.fn().mockImplementation(() => desc()),
      convexHull: vi.fn().mockImplementation(() => desc()),
      trimesh: vi.fn().mockImplementation(() => desc()),
    },
    JointData: {
      fixed: vi.fn().mockReturnValue({}),
      spherical: vi.fn().mockReturnValue({}),
      revolute: vi.fn().mockReturnValue({}),
      prismatic: vi.fn().mockReturnValue({}),
    },
  };
}

function mockWorld(): RapierWorldLike {
  return {
    createRigidBody: vi.fn().mockImplementation(() => mockBody()),
    createCollider: vi.fn(),
    createImpulseJoint: vi.fn().mockImplementation(() => mockJoint()),
    removeImpulseJoint: vi.fn(),
    removeRigidBody: vi.fn(),
  };
}

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

describe("buildGraphIntoRapier", () => {
  it("instantiates bodies from a simple graph", () => {
    const catalog = new BlockCatalog();
    catalog.register(cubeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });

    const RAPIER = mockRapier();
    const world = mockWorld();
    const { plan, runtime } = buildGraphIntoRapier(graph, catalog, RAPIER, world);

    expect(plan.bodies).toHaveLength(1);
    expect(world.createRigidBody).toHaveBeenCalled();
    expect(world.createCollider).toHaveBeenCalled();
    expect(runtime.bodies.size).toBe(1);
  });

  it("instantiates joints for hinge blocks", () => {
    const catalog = new BlockCatalog();
    catalog.register({
      id: "hinge",
      name: "Hinge",
      parts: [{ id: "base", mass: 0.5 }, { id: "rotor", mass: 0.5 }],
      colliders: [
        { kind: "box", halfExtents: vec3(0.25, 0.125, 0.125), partId: "base" },
        { kind: "box", halfExtents: vec3(0.25, 0.125, 0.125), partId: "rotor" },
      ],
      anchors: [
        { id: "bj", partId: "base", position: vec3(0, 0, 0), normal: vec3(1, 0, 0), type: "joint", polarity: "positive" },
        { id: "rj", partId: "rotor", position: vec3(0, 0, 0), normal: vec3(-1, 0, 0), type: "joint", polarity: "negative" },
      ],
      joint: { kind: "revolute", partA: "base", partB: "rotor", anchorA: "bj", anchorB: "rj" },
    });
    const graph = new BlockGraph();
    graph.addNode({ id: "h1", typeId: "hinge", transform: TRANSFORM_IDENTITY });

    const RAPIER = mockRapier();
    const world = mockWorld();
    const { runtime } = buildGraphIntoRapier(graph, catalog, RAPIER, world);

    expect(world.createImpulseJoint).toHaveBeenCalled();
    expect(runtime.joints.size).toBe(1);
  });
});

describe("RapierMachineRuntime", () => {
  it("getBody throws for unknown body", () => {
    const catalog = new BlockCatalog();
    catalog.register(cubeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    const { runtime } = buildGraphIntoRapier(graph, catalog, mockRapier(), mockWorld());

    expect(() => runtime.getBody("nonexistent")).toThrow("Unknown Rapier body");
  });

  it("getJoint throws for unknown joint", () => {
    const catalog = new BlockCatalog();
    catalog.register(cubeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    const { runtime } = buildGraphIntoRapier(graph, catalog, mockRapier(), mockWorld());

    expect(() => runtime.getJoint("nonexistent")).toThrow("Unknown Rapier joint");
  });

  it("getBodyWorldTransform returns transform from body", () => {
    const catalog = new BlockCatalog();
    catalog.register(cubeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    const { runtime } = buildGraphIntoRapier(graph, catalog, mockRapier(), mockWorld());

    const bodyId = runtime.plan.bodies[0]!.id;
    const t = runtime.getBodyWorldTransform(bodyId);
    expect(t.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("getMountWorldTransform throws for unknown mount", () => {
    const catalog = new BlockCatalog();
    catalog.register(cubeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    const { runtime } = buildGraphIntoRapier(graph, catalog, mockRapier(), mockWorld());

    expect(() => runtime.getMountWorldTransform("nonexistent")).toThrow("Unknown mount");
  });

  it("destroy removes bodies and joints", () => {
    const catalog = new BlockCatalog();
    catalog.register(cubeBlock());
    const graph = new BlockGraph();
    graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
    const world = mockWorld();
    const { runtime } = buildGraphIntoRapier(graph, catalog, mockRapier(), world);

    runtime.destroy();
    expect(world.removeRigidBody).toHaveBeenCalled();
    expect(runtime.bodies.size).toBe(0);
  });

  it("update calls behavior controllers", () => {
    const catalog = new BlockCatalog();
    catalog.register({
      ...cubeBlock(),
      id: "thruster",
      name: "Thruster",
      behaviors: [{ kind: "custom", props: {} }],
    });
    const graph = new BlockGraph();
    graph.addNode({ id: "t1", typeId: "thruster", transform: TRANSFORM_IDENTITY });

    const updateFn = vi.fn();
    const { runtime } = buildGraphIntoRapier(graph, catalog, mockRapier(), mockWorld(), {
      behaviorFactories: {
        custom: () => ({ update: updateFn }),
      },
    });

    runtime.update({}, 1 / 60);
    expect(updateFn).toHaveBeenCalled();
  });
});

describe("readInputBinding", () => {
  it("reads numeric input", () => {
    expect(readInputBinding({ throttle: 0.5 }, { action: "throttle" })).toBe(0.5);
  });

  it("reads boolean input", () => {
    expect(readInputBinding({ fire: true }, { action: "fire" })).toBe(1);
    expect(readInputBinding({ fire: false }, { action: "fire" })).toBe(0);
  });

  it("applies scale", () => {
    expect(readInputBinding({ throttle: 1 }, { action: "throttle", scale: 10 })).toBe(10);
  });

  it("applies invert", () => {
    expect(readInputBinding({ throttle: 1 }, { action: "throttle", invert: true })).toBe(-1);
  });

  it("applies deadzone", () => {
    expect(readInputBinding({ throttle: 0.01 }, { action: "throttle", deadzone: 0.05 })).toBe(0);
    expect(readInputBinding({ throttle: 0.1 }, { action: "throttle", deadzone: 0.05 })).toBe(0.1);
  });

  it("applies clamp", () => {
    expect(readInputBinding({ throttle: 2 }, { action: "throttle", clamp: [0, 1] })).toBe(1);
    expect(readInputBinding({ throttle: -2 }, { action: "throttle", clamp: [-1, 1] })).toBe(-1);
  });

  it("returns 0 for missing input", () => {
    expect(readInputBinding({}, { action: "throttle" })).toBe(0);
  });
});

describe("createRigidBodyDesc", () => {
  it("creates dynamic body desc", () => {
    const RAPIER = mockRapier();
    const plan = compileMachinePlan(
      (() => {
        const catalog = new BlockCatalog();
        catalog.register(cubeBlock());
        const graph = new BlockGraph();
        graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
        return graph;
      })(),
      (() => { const c = new BlockCatalog(); c.register(cubeBlock()); return c; })(),
    );
    createRigidBodyDesc(RAPIER, plan.bodies[0]!);
    expect(RAPIER.RigidBodyDesc.dynamic).toHaveBeenCalled();
  });
});

describe("createColliderDesc", () => {
  it("creates a box collider desc", () => {
    const RAPIER = mockRapier();
    const plan = compileMachinePlan(
      (() => {
        const catalog = new BlockCatalog();
        catalog.register(cubeBlock());
        const graph = new BlockGraph();
        graph.addNode({ id: "n1", typeId: "cube", transform: TRANSFORM_IDENTITY });
        return graph;
      })(),
      (() => { const c = new BlockCatalog(); c.register(cubeBlock()); return c; })(),
    );
    createColliderDesc(RAPIER, plan.bodies[0]!.colliders[0]!);
    expect(RAPIER.ColliderDesc.cuboid).toHaveBeenCalled();
  });
});

describe("createThrusterBehaviorFactory", () => {
  it("returns undefined for non-thruster behavior", () => {
    const factory = createThrusterBehaviorFactory();
    const result = factory(
      { id: "b", blockId: "n", blockTypeId: "t", partId: "p", bodyId: "b", kind: "other", props: {} },
      { runtime: {} as any, world: {} as any, RAPIER: {} as any },
    );
    expect(result).toBeUndefined();
  });
});
