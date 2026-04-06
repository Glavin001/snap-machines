/**
 * Example 03: Compile a Machine Plan
 *
 * Demonstrates compiling a block graph into a physics-ready machine plan
 * with rigid bodies, joints, colliders, and behaviors.
 */
import {
  BlockCatalog,
  BlockGraph,
  compileMachinePlan,
  vec3,
  transform,
  QUAT_IDENTITY,
  TRANSFORM_IDENTITY,
  VEC3_Y,
  lookRotation,
} from "../src/index.js";
import { exampleCatalog } from "../src/examples/catalog.js";

// ── Register the example catalog blocks ─────────────────────────────────
const catalog = new BlockCatalog();
catalog.registerMany(exampleCatalog);

// ── Build a small vehicle: cube → hinge → cube + thruster ───────────────
const graph = new BlockGraph();

// Base cube (fixed to the world)
graph.addNode({
  id: "base",
  typeId: "frame.cube.1",
  transform: TRANSFORM_IDENTITY,
});

// Hinge connected to the base
graph.addNode({
  id: "hinge",
  typeId: "joint.hinge.small",
  transform: transform(vec3(1.25, 0, 0), QUAT_IDENTITY),
});

// Arm cube connected to the hinge rotor
graph.addNode({
  id: "arm",
  typeId: "frame.cube.1",
  transform: transform(vec3(2.5, 0, 0), QUAT_IDENTITY),
});

// Thruster on the arm
graph.addNode({
  id: "thruster",
  typeId: "utility.thruster.small",
  transform: transform(vec3(3.5, 0, 0), QUAT_IDENTITY),
});

// Connect: base.xp → hinge.base.xn
graph.addConnection({
  a: { blockId: "base", anchorId: "xp" },
  b: { blockId: "hinge", anchorId: "base.xn" },
});

// Connect: hinge.rotor.xp → arm.xn
graph.addConnection({
  a: { blockId: "hinge", anchorId: "rotor.xp" },
  b: { blockId: "arm", anchorId: "xn" },
});

// Connect: arm.xp → thruster.mount
graph.addConnection({
  a: { blockId: "arm", anchorId: "xp" },
  b: { blockId: "thruster", anchorId: "mount" },
});

// ── Compile the machine ─────────────────────────────────────────────────
const plan = compileMachinePlan(graph, catalog);

console.log("=== Machine Plan ===");
console.log(`Bodies: ${plan.bodies.length}`);
for (const body of plan.bodies) {
  console.log(`  ${body.id}: kind=${body.kind}, colliders=${body.colliders.length}, blocks=[${body.sourceBlocks.join(", ")}]`);
}

console.log(`\nJoints: ${plan.joints.length}`);
for (const joint of plan.joints) {
  console.log(`  ${joint.id}: kind=${joint.kind}, ${joint.bodyAId} ↔ ${joint.bodyBId}`);
  if (joint.motor) {
    console.log(`    motor: mode=${joint.motor.mode}, stiffness=${joint.motor.stiffness}, damping=${joint.motor.damping}`);
  }
}

console.log(`\nMounts: ${plan.mounts.length}`);
for (const mount of plan.mounts) {
  console.log(`  ${mount.id}: block=${mount.blockId}, body=${mount.bodyId}`);
}

console.log(`\nBehaviors: ${plan.behaviors.length}`);
for (const behavior of plan.behaviors) {
  console.log(`  ${behavior.id}: kind=${behavior.kind}, body=${behavior.bodyId}`);
}

console.log(`\nDiagnostics: ${plan.diagnostics.length}`);
for (const diag of plan.diagnostics) {
  console.log(`  [${diag.level}] ${diag.message}`);
}
