import { AnchorRef, BlockConnection, BlockGraph, BlockNode } from "../graph.js";
import {
  BlockBehaviorDefinition,
  BlockCatalog,
  ColliderDefinition,
  InputBinding,
  JointKind,
  JsonObject,
  NormalizedAnchorDefinition,
  NormalizedBlockBehaviorDefinition,
  NormalizedBlockDefinition,
  NormalizedColliderDefinition,
  NormalizedGeometryDefinition,
  NormalizedJointDefinition,
  RigidBodyKind,
} from "../schema.js";
import {
  QUAT_IDENTITY,
  Transform,
  Vec3,
  addVec3,
  averageVec3,
  cloneTransform,
  cloneVec3,
  composeTransforms,
  normalizeVec3,
  relativeTransform,
  rotateVec3,
  transformDirection,
  weightedAverageVec3,
} from "../math.js";

export interface CompileDiagnostic {
  level: "info" | "warning" | "error";
  message: string;
  blockId?: string;
  connectionId?: string;
}

export interface MachinePartMountPlan {
  id: string;
  blockId: string;
  blockTypeId: string;
  partId: string;
  bodyId: string;
  localTransform: Transform;
  geometry: NormalizedGeometryDefinition[];
  metadata?: JsonObject;
}

export interface PlannedCollider {
  id: string;
  blockId: string;
  partId: string;
  kind: NormalizedColliderDefinition["kind"];
  localTransform: Transform;
  mass?: number;
  sensor: boolean;
  includeInMass: boolean;
  friction?: number;
  restitution?: number;
  collisionGroups?: number;
  solverGroups?: number;
  halfExtents?: Vec3;
  radius?: number;
  halfHeight?: number;
  axis?: "x" | "y" | "z";
  points?: Vec3[];
  vertices?: number[];
  indices?: number[];
  metadata?: JsonObject;
}

export interface MachineBodyPlan {
  id: string;
  kind: RigidBodyKind;
  origin: Transform;
  sourceBlocks: string[];
  sourceParts: { blockId: string; partId: string }[];
  colliders: PlannedCollider[];
}

export interface PlannedJointMotor {
  mode: "position" | "velocity" | "full";
  targetPosition: number;
  targetVelocity: number;
  stiffness: number;
  damping: number;
  maxForce?: number;
  input?: InputBinding;
  inputTarget: "position" | "velocity" | "both";
}

export interface BuilderJointMotorOverrides {
  mode?: PlannedJointMotor["mode"];
  targetPosition?: number;
  targetVelocity?: number;
  stiffness?: number;
  damping?: number;
  maxForce?: number;
  inputTarget?: PlannedJointMotor["inputTarget"];
}

export interface MachineJointPlan {
  id: string;
  blockId: string;
  kind: JointKind;
  bodyAId: string;
  bodyBId: string;
  localAnchorA: Vec3;
  localAnchorB: Vec3;
  localFrameA?: Transform["rotation"];
  localFrameB?: Transform["rotation"];
  localAxisA?: Vec3;
  localAxisB?: Vec3;
  limits?: { min: number; max: number };
  collideConnected: boolean;
  motor?: PlannedJointMotor;
  metadata?: JsonObject;
}

export interface MachineBehaviorPlan {
  id: string;
  blockId: string;
  blockTypeId: string;
  partId: string;
  bodyId: string;
  kind: string;
  props: JsonObject;
  input?: InputBinding;
  metadata?: JsonObject;
}

export interface MachinePlan {
  bodies: MachineBodyPlan[];
  joints: MachineJointPlan[];
  mounts: MachinePartMountPlan[];
  behaviors: MachineBehaviorPlan[];
  diagnostics: CompileDiagnostic[];
}

export interface CompileMachineOptions {
  defaultRigidBodyKind?: RigidBodyKind;
}

interface PartInstance {
  key: string;
  block: BlockNode;
  blockDef: NormalizedBlockDefinition;
  partId: string;
  partMass: number;
  rigidBodyKind: RigidBodyKind;
}

function partKey(blockId: string, partId: string): string {
  return `${blockId}::${partId}`;
}

function anchorPartKey(block: BlockNode, definition: NormalizedBlockDefinition, anchorId: string): string {
  const anchor = definition.anchors.find((entry) => entry.id === anchorId);
  if (!anchor) {
    throw new Error(`Unknown anchor '${anchorId}' on block '${definition.id}'.`);
  }
  return partKey(block.id, anchor.partId);
}

export function compileMachinePlan(
  graph: BlockGraph,
  catalog: BlockCatalog,
  options: CompileMachineOptions = {},
): MachinePlan {
  const diagnostics: CompileDiagnostic[] = [];
  const validation = graph.validateAgainstCatalog(catalog);
  for (const error of validation.errors) {
    diagnostics.push({ level: "error", message: error });
  }
  for (const warning of validation.warnings) {
    diagnostics.push({ level: "warning", message: warning });
  }
  if (!validation.ok) {
    return {
      bodies: [],
      joints: [],
      mounts: [],
      behaviors: [],
      diagnostics,
    };
  }

  const partInstances = buildPartInstances(graph, catalog, options);
  const adjacency = buildStructuralAdjacency(graph, partInstances, diagnostics);
  const components = connectedComponents(adjacency);

  const bodyPlans = new Map<string, MachineBodyPlan>();
  const bodyIdByPartKey = new Map<string, string>();
  const partInstancesByKey = new Map(partInstances.map((part) => [part.key, part] as const));

  let bodyIndex = 0;
  for (const component of components) {
    const componentParts = component.map((key) => partInstancesByKey.get(key)!).filter(Boolean);
    const bodyId = `body:${bodyIndex.toString(36)}`;
    bodyIndex += 1;
    const origin = computeBodyOrigin(componentParts);
    const kind = resolveBodyKind(componentParts, options.defaultRigidBodyKind ?? "dynamic");
    const colliders = collectBodyColliders(componentParts, origin);

    bodyPlans.set(bodyId, {
      id: bodyId,
      kind,
      origin,
      sourceBlocks: unique(componentParts.map((part) => part.block.id)),
      sourceParts: componentParts.map((part) => ({ blockId: part.block.id, partId: part.partId })),
      colliders,
    });

    for (const part of componentParts) {
      bodyIdByPartKey.set(part.key, bodyId);
    }
  }

  const mounts = buildMounts(partInstances, bodyIdByPartKey, bodyPlans);
  const joints = buildJointPlans(graph, catalog, partInstances, bodyIdByPartKey, bodyPlans, diagnostics);
  const behaviors = buildBehaviorPlans(graph, catalog, partInstances, bodyIdByPartKey);

  return {
    bodies: [...bodyPlans.values()],
    joints,
    mounts,
    behaviors,
    diagnostics,
  };
}

function buildPartInstances(
  graph: BlockGraph,
  catalog: BlockCatalog,
  options: CompileMachineOptions,
): PartInstance[] {
  const result: PartInstance[] = [];

  for (const node of graph.listNodes()) {
    const definition = catalog.get(node.typeId);
    for (const part of definition.parts) {
      result.push({
        key: partKey(node.id, part.id),
        block: node,
        blockDef: definition,
        partId: part.id,
        partMass: resolvePartMass(definition, part.id),
        rigidBodyKind: part.rigidBodyKind ?? options.defaultRigidBodyKind ?? "dynamic",
      });
    }
  }

  return result;
}

function buildStructuralAdjacency(
  graph: BlockGraph,
  partInstances: PartInstance[],
  diagnostics: CompileDiagnostic[],
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const part of partInstances) {
    adjacency.set(part.key, new Set<string>());
  }

  for (const part of partInstances) {
    if (!part.blockDef.joint && part.blockDef.parts.length > 1) {
      for (const other of part.blockDef.parts) {
        const otherKey = partKey(part.block.id, other.id);
        if (otherKey !== part.key) {
          adjacency.get(part.key)!.add(otherKey);
        }
      }
    }
  }

  for (const connection of graph.listConnections()) {
    const nodeA = graph.getNode(connection.a.blockId)!;
    const nodeB = graph.getNode(connection.b.blockId)!;
    const defA = partInstances.find((entry) => entry.block.id === nodeA.id)?.blockDef;
    const defB = partInstances.find((entry) => entry.block.id === nodeB.id)?.blockDef;
    if (!defA || !defB) {
      continue;
    }

    const partAKey = anchorPartKey(nodeA, defA, connection.a.anchorId);
    const partBKey = anchorPartKey(nodeB, defB, connection.b.anchorId);
    if (!adjacency.has(partAKey) || !adjacency.has(partBKey)) {
      diagnostics.push({
        level: "error",
        message: `Connection '${connection.id}' points at a missing part during compile.`,
        connectionId: connection.id,
      });
      continue;
    }
    adjacency.get(partAKey)!.add(partBKey);
    adjacency.get(partBKey)!.add(partAKey);
  }

  return adjacency;
}

function connectedComponents(adjacency: Map<string, Set<string>>): string[][] {
  const components: string[][] = [];
  const visited = new Set<string>();

  for (const key of adjacency.keys()) {
    if (visited.has(key)) {
      continue;
    }
    const queue = [key];
    const component: string[] = [];
    visited.add(key);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbour of adjacency.get(current) ?? []) {
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
    components.push(component);
  }

  return components;
}

function computeBodyOrigin(parts: PartInstance[]): Transform {
  const positions = parts.map((part) => part.block.transform.position);
  const weights = parts.map((part) => Math.max(part.partMass, 0.001));
  const position = weightedAverageVec3(positions, weights);
  return {
    position,
    rotation: { ...QUAT_IDENTITY },
  };
}

function resolveBodyKind(parts: PartInstance[], fallback: RigidBodyKind): RigidBodyKind {
  const kinds = new Set(parts.map((part) => part.rigidBodyKind));
  if (kinds.has("fixed")) {
    return "fixed";
  }
  if (kinds.has("kinematicPosition")) {
    return "kinematicPosition";
  }
  if (kinds.has("kinematicVelocity")) {
    return "kinematicVelocity";
  }
  return kinds.values().next().value ?? fallback;
}

function collectBodyColliders(parts: PartInstance[], bodyOrigin: Transform): PlannedCollider[] {
  const result: PlannedCollider[] = [];

  for (const part of parts) {
    const colliders = part.blockDef.colliders.filter((entry) => entry.partId === part.partId);
    const massAssignments = distributeColliderMass(part.partMass, colliders);

    colliders.forEach((collider, index) => {
      const worldTransform = composeTransforms(part.block.transform, collider.transform);
      const localTransform = relativeTransform(bodyOrigin, worldTransform);
      const planned: PlannedCollider = {
        id: collider.id,
        blockId: part.block.id,
        partId: part.partId,
        kind: collider.kind,
        localTransform,
        mass: massAssignments[index],
        sensor: collider.sensor,
        includeInMass: collider.includeInMass,
        friction: collider.friction,
        restitution: collider.restitution,
        collisionGroups: collider.collisionGroups,
        solverGroups: collider.solverGroups,
        metadata: collider.metadata,
      };

      switch (collider.kind) {
        case "box":
          planned.halfExtents = cloneVec3(collider.halfExtents);
          break;
        case "sphere":
          planned.radius = collider.radius;
          break;
        case "capsule":
        case "cylinder":
          planned.radius = collider.radius;
          planned.halfHeight = collider.halfHeight;
          planned.axis = collider.axis ?? "y";
          break;
        case "convexHull":
          planned.points = collider.points.map(cloneVec3);
          break;
        case "trimesh":
          planned.vertices = [...collider.vertices];
          planned.indices = [...collider.indices];
          break;
        default:
          break;
      }

      result.push(planned);
    });
  }

  return result;
}

function distributeColliderMass(partMass: number, colliders: readonly NormalizedColliderDefinition[]): Array<number | undefined> {
  const result: Array<number | undefined> = new Array(colliders.length).fill(undefined);
  let explicitMass = 0;
  let implicitCount = 0;

  colliders.forEach((collider, index) => {
    if (collider.mass !== undefined) {
      result[index] = collider.mass;
      explicitMass += collider.mass;
      return;
    }
    if (collider.includeInMass) {
      implicitCount += 1;
    }
  });

  if (implicitCount === 0) {
    return result;
  }

  const remainder = Math.max(partMass - explicitMass, 0);
  const share = remainder > 0 ? remainder / implicitCount : undefined;

  colliders.forEach((collider, index) => {
    if (result[index] !== undefined) {
      return;
    }
    if (!collider.includeInMass) {
      result[index] = undefined;
      return;
    }
    result[index] = share;
  });

  return result;
}

function buildMounts(
  partInstances: PartInstance[],
  bodyIdByPartKey: Map<string, string>,
  bodyPlans: Map<string, MachineBodyPlan>,
): MachinePartMountPlan[] {
  return partInstances.map((part) => {
    const bodyId = bodyIdByPartKey.get(part.key)!;
    const body = bodyPlans.get(bodyId)!;
    return {
      id: `mount:${part.key}`,
      blockId: part.block.id,
      blockTypeId: part.block.typeId,
      partId: part.partId,
      bodyId,
      localTransform: relativeTransform(body.origin, part.block.transform),
      geometry: part.blockDef.geometry.filter((entry) => entry.partId === part.partId).map((entry) => ({
        ...entry,
        transform: cloneTransform(entry.transform),
      })),
      metadata: part.blockDef.metadata,
    };
  });
}

function buildJointPlans(
  graph: BlockGraph,
  catalog: BlockCatalog,
  partInstances: PartInstance[],
  bodyIdByPartKey: Map<string, string>,
  bodyPlans: Map<string, MachineBodyPlan>,
  diagnostics: CompileDiagnostic[],
): MachineJointPlan[] {
  const result: MachineJointPlan[] = [];
  const partMap = new Map(partInstances.map((part) => [part.key, part] as const));

  for (const node of graph.listNodes()) {
    const definition = catalog.get(node.typeId);
    const joint = definition.joint;
    if (!joint) {
      continue;
    }

    const bodyAId = bodyIdByPartKey.get(partKey(node.id, joint.partA));
    const bodyBId = bodyIdByPartKey.get(partKey(node.id, joint.partB));
    if (!bodyAId || !bodyBId) {
      diagnostics.push({
        level: "error",
        message: `Joint block '${node.id}' failed to resolve its bodies during compile.`,
        blockId: node.id,
      });
      continue;
    }
    if (bodyAId === bodyBId) {
      diagnostics.push({
        level: "warning",
        message: `Joint block '${node.id}' collapsed into a single rigid body because there is an alternate structural path around the joint. The joint is skipped.`,
        blockId: node.id,
      });
      continue;
    }

    const anchorA = definition.anchors.find((anchor) => anchor.id === joint.anchorA)!;
    const anchorB = definition.anchors.find((anchor) => anchor.id === joint.anchorB)!;
    const anchorAWorld = composeTransforms(node.transform, { position: anchorA.position, rotation: anchorA.orientation });
    const anchorBWorld = composeTransforms(node.transform, { position: anchorB.position, rotation: anchorB.orientation });
    const bodyA = bodyPlans.get(bodyAId)!;
    const bodyB = bodyPlans.get(bodyBId)!;
    const axisLocalBlock = joint.axis ?? anchorAxisFromAnchor(anchorA);
    const axisWorld = normalizeVec3(rotateVec3(node.transform.rotation, axisLocalBlock));

    result.push({
      id: `joint:${node.id}`,
      blockId: node.id,
      kind: joint.kind,
      bodyAId,
      bodyBId,
      localAnchorA: relativeTransform(bodyA.origin, anchorAWorld).position,
      localAnchorB: relativeTransform(bodyB.origin, anchorBWorld).position,
      localFrameA: relativeTransform(bodyA.origin, anchorAWorld).rotation,
      localFrameB: relativeTransform(bodyB.origin, anchorBWorld).rotation,
      localAxisA: axisWorld,
      localAxisB: axisWorld,
      limits: joint.limits ? { ...joint.limits } : undefined,
      collideConnected: joint.collideConnected,
      motor: joint.motor ? applyBuilderJointMotorOverrides(normalizeMotor(joint.motor), node) : undefined,
      metadata: joint.metadata,
    });
  }

  return result;
}

function buildBehaviorPlans(
  graph: BlockGraph,
  catalog: BlockCatalog,
  partInstances: PartInstance[],
  bodyIdByPartKey: Map<string, string>,
): MachineBehaviorPlan[] {
  const result: MachineBehaviorPlan[] = [];
  const definitionByNode = new Map(graph.listNodes().map((node) => [node.id, catalog.get(node.typeId)] as const));

  for (const node of graph.listNodes()) {
    const definition = definitionByNode.get(node.id)!;
    for (const behavior of definition.behaviors) {
      const bodyId = bodyIdByPartKey.get(partKey(node.id, behavior.partId));
      if (!bodyId) {
        continue;
      }
      result.push({
        id: `behavior:${node.id}:${behavior.kind}:${behavior.partId}`,
        blockId: node.id,
        blockTypeId: node.typeId,
        partId: behavior.partId,
        bodyId,
        kind: behavior.kind,
        props: { ...behavior.props },
        input: behavior.input,
        metadata: behavior.metadata,
      });
    }
  }

  return result;
}

function resolvePartMass(definition: NormalizedBlockDefinition, partId: string): number {
  const part = definition.parts.find((entry) => entry.id === partId)!;
  if (part.mass !== undefined) {
    return part.mass;
  }
  const colliders = definition.colliders.filter((entry) => entry.partId === partId && entry.includeInMass);
  const explicitMass = colliders.reduce((sum, collider) => sum + (collider.mass ?? 0), 0);
  if (explicitMass > 0) {
    return explicitMass;
  }
  if (definition.mass !== undefined) {
    if (definition.parts.length === 1) {
      return definition.mass;
    }
    return definition.mass / definition.parts.length;
  }
  return Math.max(colliders.length, 1);
}

function anchorAxisFromAnchor(anchor: NormalizedAnchorDefinition): Vec3 {
  return rotateVec3(anchor.orientation, { x: 1, y: 0, z: 0 });
}

function normalizeMotor(motor: NormalizedJointDefinition["motor"]): PlannedJointMotor {
  return {
    mode: motor?.mode ?? "velocity",
    targetPosition: motor?.targetPosition ?? 0,
    targetVelocity: motor?.targetVelocity ?? 0,
    stiffness: motor?.stiffness ?? 50,
    damping: motor?.damping ?? 4,
    maxForce: motor?.maxForce,
    input: motor?.input,
    inputTarget: motor?.inputTarget ?? "velocity",
  };
}

function applyBuilderJointMotorOverrides(motor: PlannedJointMotor, node: BlockNode): PlannedJointMotor {
  const overrides = getBuilderJointMotorOverrides(node);
  if (!overrides) {
    return motor;
  }

  return {
    ...motor,
    ...(overrides.mode ? { mode: overrides.mode } : null),
    ...(overrides.targetPosition !== undefined ? { targetPosition: overrides.targetPosition } : null),
    ...(overrides.targetVelocity !== undefined ? { targetVelocity: overrides.targetVelocity } : null),
    ...(overrides.stiffness !== undefined ? { stiffness: overrides.stiffness } : null),
    ...(overrides.damping !== undefined ? { damping: overrides.damping } : null),
    ...(overrides.maxForce !== undefined ? { maxForce: overrides.maxForce } : null),
    ...(overrides.inputTarget ? { inputTarget: overrides.inputTarget } : null),
  };
}

function getBuilderJointMotorOverrides(node: BlockNode): BuilderJointMotorOverrides | undefined {
  const metadata = node.metadata;
  if (!isRecord(metadata)) {
    return undefined;
  }
  const builder = metadata.builder;
  if (!isRecord(builder)) {
    return undefined;
  }
  const motor = builder.motor;
  if (!isRecord(motor)) {
    return undefined;
  }

  const overrides: BuilderJointMotorOverrides = {};

  if (motor.mode === "position" || motor.mode === "velocity" || motor.mode === "full") {
    overrides.mode = motor.mode;
  }
  if (isFiniteNumber(motor.targetPosition)) {
    overrides.targetPosition = motor.targetPosition;
  }
  if (isFiniteNumber(motor.targetVelocity)) {
    overrides.targetVelocity = motor.targetVelocity;
  }
  if (isFiniteNumber(motor.stiffness)) {
    overrides.stiffness = motor.stiffness;
  }
  if (isFiniteNumber(motor.damping)) {
    overrides.damping = motor.damping;
  }
  if (isFiniteNumber(motor.maxForce)) {
    overrides.maxForce = motor.maxForce;
  }
  if (motor.inputTarget === "position" || motor.inputTarget === "velocity" || motor.inputTarget === "both") {
    overrides.inputTarget = motor.inputTarget;
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
