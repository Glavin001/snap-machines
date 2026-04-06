import {
  EPSILON,
  QUAT_IDENTITY,
  TRANSFORM_IDENTITY,
  Vec3,
  Quat,
  Transform,
  cloneTransform,
  cloneVec3,
  ensureAnchorOrientation,
  isFiniteQuat,
  isFiniteVec3,
  normalizeVec3,
} from "./math.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type AnchorPolarity = "positive" | "negative" | "neutral";
export type JointKind = "fixed" | "revolute" | "prismatic" | "spherical";
export type RigidBodyKind = "dynamic" | "fixed" | "kinematicPosition" | "kinematicVelocity";

export interface GeometryBase {
  id?: string;
  partId?: string;
  transform?: Transform;
  materialId?: string;
  metadata?: JsonObject;
}

export interface BoxGeometry extends GeometryBase {
  kind: "box";
  size: Vec3;
}

export interface SphereGeometry extends GeometryBase {
  kind: "sphere";
  radius: number;
}

export interface CapsuleGeometry extends GeometryBase {
  kind: "capsule";
  radius: number;
  halfHeight: number;
  axis?: "x" | "y" | "z";
}

export interface CylinderGeometry extends GeometryBase {
  kind: "cylinder";
  radius: number;
  halfHeight: number;
  axis?: "x" | "y" | "z";
}

export interface MeshGeometry extends GeometryBase {
  kind: "mesh";
  meshId: string;
}

export type GeometryDefinition =
  | BoxGeometry
  | SphereGeometry
  | CapsuleGeometry
  | CylinderGeometry
  | MeshGeometry;

export interface ColliderBase {
  id?: string;
  partId?: string;
  transform?: Transform;
  sensor?: boolean;
  includeInMass?: boolean;
  mass?: number;
  friction?: number;
  restitution?: number;
  collisionGroups?: number;
  solverGroups?: number;
  metadata?: JsonObject;
}

export interface BoxCollider extends ColliderBase {
  kind: "box";
  halfExtents: Vec3;
}

export interface SphereCollider extends ColliderBase {
  kind: "sphere";
  radius: number;
}

export interface CapsuleCollider extends ColliderBase {
  kind: "capsule";
  radius: number;
  halfHeight: number;
  axis?: "x" | "y" | "z";
}

export interface CylinderCollider extends ColliderBase {
  kind: "cylinder";
  radius: number;
  halfHeight: number;
  axis?: "x" | "y" | "z";
}

export interface ConvexHullCollider extends ColliderBase {
  kind: "convexHull";
  points: Vec3[];
}

export interface TrimeshCollider extends ColliderBase {
  kind: "trimesh";
  vertices: number[];
  indices: number[];
}

export type ColliderDefinition =
  | BoxCollider
  | SphereCollider
  | CapsuleCollider
  | CylinderCollider
  | ConvexHullCollider
  | TrimeshCollider;

export interface AnchorDefinition {
  id: string;
  partId?: string;
  position: Vec3;
  normal: Vec3;
  orientation?: Quat;
  type: string;
  polarity?: AnchorPolarity;
  angleToleranceDeg?: number;
  distanceThreshold?: number;
  openCheckRadius?: number;
  rotationSnapStepDeg?: number;
  metadata?: JsonObject;
}

export interface InputBinding {
  action: string;
  scale?: number;
  invert?: boolean;
  deadzone?: number;
  clamp?: [number, number];
}

export interface JointMotorDefinition {
  mode?: "position" | "velocity" | "full";
  targetPosition?: number;
  targetVelocity?: number;
  stiffness?: number;
  damping?: number;
  maxForce?: number;
  input?: InputBinding;
  inputTarget?: "position" | "velocity" | "both";
}

export interface JointDefinition {
  kind: JointKind;
  partA: string;
  partB: string;
  anchorA: string;
  anchorB: string;
  axis?: Vec3;
  tangent?: Vec3;
  limits?: {
    min: number;
    max: number;
  };
  motor?: JointMotorDefinition;
  collideConnected?: boolean;
  metadata?: JsonObject;
}

export interface BlockBehaviorDefinition {
  kind: string;
  partId?: string;
  props?: JsonObject;
  input?: InputBinding;
  metadata?: JsonObject;
}

export interface BlockPartDefinition {
  id: string;
  mass?: number;
  rigidBodyKind?: RigidBodyKind;
  metadata?: JsonObject;
}

export interface BlockDefinition {
  id: string;
  name: string;
  category?: string;
  mass?: number;
  geometry?: GeometryDefinition[];
  colliders: ColliderDefinition[];
  anchors: AnchorDefinition[];
  parts?: BlockPartDefinition[];
  joint?: JointDefinition;
  behaviors?: BlockBehaviorDefinition[];
  metadata?: JsonObject;
}

export interface NormalizedAnchorDefinition extends AnchorDefinition {
  partId: string;
  orientation: Quat;
  normal: Vec3;
  polarity: AnchorPolarity;
}

export interface NormalizedColliderBase extends ColliderBase {
  id: string;
  partId: string;
  transform: Transform;
  includeInMass: boolean;
  sensor: boolean;
}

export type NormalizedColliderDefinition =
  | (BoxCollider & NormalizedColliderBase)
  | (SphereCollider & NormalizedColliderBase)
  | (CapsuleCollider & NormalizedColliderBase)
  | (CylinderCollider & NormalizedColliderBase)
  | (ConvexHullCollider & NormalizedColliderBase)
  | (TrimeshCollider & NormalizedColliderBase);

export type NormalizedGeometryDefinition = (GeometryDefinition & {
  id: string;
  partId: string;
  transform: Transform;
});

export interface NormalizedBlockBehaviorDefinition extends BlockBehaviorDefinition {
  partId: string;
  props: JsonObject;
}

export interface NormalizedBlockPartDefinition extends BlockPartDefinition {
  mass?: number;
  rigidBodyKind: RigidBodyKind;
}

export interface NormalizedJointDefinition extends JointDefinition {
  collideConnected: boolean;
}

export interface NormalizedBlockDefinition extends Omit<BlockDefinition, "anchors" | "colliders" | "geometry" | "parts" | "behaviors" | "joint"> {
  parts: NormalizedBlockPartDefinition[];
  anchors: NormalizedAnchorDefinition[];
  colliders: NormalizedColliderDefinition[];
  geometry: NormalizedGeometryDefinition[];
  behaviors: NormalizedBlockBehaviorDefinition[];
  joint?: NormalizedJointDefinition;
}

export function normalizeBlockDefinition(definition: BlockDefinition): NormalizedBlockDefinition {
  validateBlockDefinition(definition);

  const parts = normalizeParts(definition);
  const defaultPartId = parts[0]!.id;

  const geometry = (definition.geometry ?? []).map((entry, index) => ({
    ...entry,
    id: entry.id ?? `${definition.id}:geometry:${index}`,
    partId: entry.partId ?? defaultPartId,
    transform: entry.transform ? cloneTransform(entry.transform) : cloneTransform(TRANSFORM_IDENTITY),
  }));

  const colliders = definition.colliders.map((entry, index) => ({
    ...entry,
    id: entry.id ?? `${definition.id}:collider:${index}`,
    partId: entry.partId ?? defaultPartId,
    transform: entry.transform ? cloneTransform(entry.transform) : cloneTransform(TRANSFORM_IDENTITY),
    sensor: entry.sensor ?? false,
    includeInMass: entry.includeInMass ?? !(entry.sensor ?? false),
  })) as NormalizedColliderDefinition[];

  const anchors = definition.anchors.map((entry) => ({
    ...entry,
    partId: entry.partId ?? defaultPartId,
    orientation: ensureAnchorOrientation(entry.normal, entry.orientation),
    normal: normalizeVec3(entry.normal),
    polarity: entry.polarity ?? "neutral",
  })) as NormalizedAnchorDefinition[];

  const behaviors = (definition.behaviors ?? []).map((behavior) => ({
    ...behavior,
    partId: behavior.partId ?? defaultPartId,
    props: { ...(behavior.props ?? {}) },
  })) as NormalizedBlockBehaviorDefinition[];

  const joint = definition.joint
    ? {
        ...definition.joint,
        collideConnected: definition.joint.collideConnected ?? false,
      }
    : undefined;

  return {
    ...definition,
    parts,
    geometry,
    colliders,
    anchors,
    behaviors,
    joint,
  };
}

export function validateBlockDefinition(definition: BlockDefinition): void {
  if (!definition.id.trim()) {
    throw new Error("Block definition id must be non-empty.");
  }
  if (!definition.name.trim()) {
    throw new Error(`Block definition '${definition.id}' must have a non-empty name.`);
  }
  if (definition.anchors.length === 0) {
    throw new Error(`Block definition '${definition.id}' must declare at least one anchor.`);
  }
  if (definition.colliders.length === 0) {
    throw new Error(`Block definition '${definition.id}' must declare at least one collider.`);
  }

  const parts = normalizeParts(definition);
  const partIds = new Set(parts.map((part) => part.id));

  const anchorIds = new Set<string>();
  for (const anchor of definition.anchors) {
    if (!anchor.id.trim()) {
      throw new Error(`Block '${definition.id}' contains an anchor with an empty id.`);
    }
    if (anchorIds.has(anchor.id)) {
      throw new Error(`Block '${definition.id}' contains duplicate anchor id '${anchor.id}'.`);
    }
    anchorIds.add(anchor.id);

    if (!isFiniteVec3(anchor.position) || !isFiniteVec3(anchor.normal)) {
      throw new Error(`Block '${definition.id}' anchor '${anchor.id}' must use finite vectors.`);
    }
    if (anchor.orientation && !isFiniteQuat(anchor.orientation)) {
      throw new Error(`Block '${definition.id}' anchor '${anchor.id}' must use a finite orientation.`);
    }
    if (Math.abs(anchor.normal.x) + Math.abs(anchor.normal.y) + Math.abs(anchor.normal.z) <= EPSILON) {
      throw new Error(`Block '${definition.id}' anchor '${anchor.id}' cannot use a zero normal.`);
    }
    if (!anchor.type.trim()) {
      throw new Error(`Block '${definition.id}' anchor '${anchor.id}' must declare a type.`);
    }
    if (anchor.partId && !partIds.has(anchor.partId)) {
      throw new Error(`Block '${definition.id}' anchor '${anchor.id}' references unknown part '${anchor.partId}'.`);
    }
  }

  for (const collider of definition.colliders) {
    if (collider.partId && !partIds.has(collider.partId)) {
      throw new Error(`Block '${definition.id}' collider '${collider.id ?? collider.kind}' references unknown part '${collider.partId}'.`);
    }
    if (collider.transform && (!isFiniteVec3(collider.transform.position) || !isFiniteQuat(collider.transform.rotation))) {
      throw new Error(`Block '${definition.id}' collider '${collider.id ?? collider.kind}' must use finite transforms.`);
    }
    validateColliderShape(definition.id, collider);
  }

  for (const geometry of definition.geometry ?? []) {
    if (geometry.partId && !partIds.has(geometry.partId)) {
      throw new Error(`Block '${definition.id}' geometry '${geometry.id ?? geometry.kind}' references unknown part '${geometry.partId}'.`);
    }
    if (geometry.transform && (!isFiniteVec3(geometry.transform.position) || !isFiniteQuat(geometry.transform.rotation))) {
      throw new Error(`Block '${definition.id}' geometry '${geometry.id ?? geometry.kind}' must use finite transforms.`);
    }
  }

  for (const behavior of definition.behaviors ?? []) {
    if (!behavior.kind.trim()) {
      throw new Error(`Block '${definition.id}' contains a behavior with an empty kind.`);
    }
    if (behavior.partId && !partIds.has(behavior.partId)) {
      throw new Error(`Block '${definition.id}' behavior '${behavior.kind}' references unknown part '${behavior.partId}'.`);
    }
  }

  if (definition.joint) {
    if (parts.length !== 2) {
      throw new Error(
        `Joint block '${definition.id}' must declare exactly two parts. This keeps the compile step deterministic and easy to partition.`,
      );
    }
    if (!partIds.has(definition.joint.partA) || !partIds.has(definition.joint.partB)) {
      throw new Error(`Joint block '${definition.id}' references unknown joint parts.`);
    }
    if (definition.joint.partA === definition.joint.partB) {
      throw new Error(`Joint block '${definition.id}' must connect two distinct parts.`);
    }
    if (!anchorIds.has(definition.joint.anchorA) || !anchorIds.has(definition.joint.anchorB)) {
      throw new Error(`Joint block '${definition.id}' references unknown joint anchors.`);
    }
    const anchorA = definition.anchors.find((anchor) => anchor.id === definition.joint!.anchorA)!;
    const anchorB = definition.anchors.find((anchor) => anchor.id === definition.joint!.anchorB)!;
    if ((anchorA.partId ?? parts[0]!.id) !== definition.joint.partA) {
      throw new Error(`Joint block '${definition.id}' anchor '${anchorA.id}' must belong to part '${definition.joint.partA}'.`);
    }
    if ((anchorB.partId ?? parts[0]!.id) !== definition.joint.partB) {
      throw new Error(`Joint block '${definition.id}' anchor '${anchorB.id}' must belong to part '${definition.joint.partB}'.`);
    }
  }
}

function normalizeParts(definition: BlockDefinition): NormalizedBlockPartDefinition[] {
  const parts = definition.parts && definition.parts.length > 0 ? definition.parts : [{ id: "main", mass: definition.mass }];
  const ids = new Set<string>();
  return parts.map((part) => {
    if (!part.id.trim()) {
      throw new Error(`Block '${definition.id}' contains a part with an empty id.`);
    }
    if (ids.has(part.id)) {
      throw new Error(`Block '${definition.id}' contains duplicate part id '${part.id}'.`);
    }
    ids.add(part.id);
    return {
      ...part,
      rigidBodyKind: part.rigidBodyKind ?? "dynamic",
    };
  });
}

function validateColliderShape(blockId: string, collider: ColliderDefinition): void {
  switch (collider.kind) {
    case "box":
      if (!isFiniteVec3(collider.halfExtents) || collider.halfExtents.x <= 0 || collider.halfExtents.y <= 0 || collider.halfExtents.z <= 0) {
        throw new Error(`Block '${blockId}' contains a box collider with invalid half-extents.`);
      }
      return;
    case "sphere":
      if (!Number.isFinite(collider.radius) || collider.radius <= 0) {
        throw new Error(`Block '${blockId}' contains a sphere collider with an invalid radius.`);
      }
      return;
    case "capsule":
    case "cylinder":
      if (!Number.isFinite(collider.radius) || collider.radius <= 0 || !Number.isFinite(collider.halfHeight) || collider.halfHeight <= 0) {
        throw new Error(`Block '${blockId}' contains a ${collider.kind} collider with invalid dimensions.`);
      }
      return;
    case "convexHull":
      if (collider.points.length < 4) {
        throw new Error(`Block '${blockId}' convex hull colliders require at least 4 points.`);
      }
      if (collider.points.some((point) => !isFiniteVec3(point))) {
        throw new Error(`Block '${blockId}' convex hull colliders require finite points.`);
      }
      return;
    case "trimesh":
      if (collider.vertices.length < 9 || collider.indices.length < 3) {
        throw new Error(`Block '${blockId}' trimesh colliders require at least one triangle.`);
      }
      return;
    default:
      throw new Error(`Block '${blockId}' contains an unsupported collider kind.`);
  }
}

export class BlockCatalog {
  private readonly blocks = new Map<string, NormalizedBlockDefinition>();

  register(definition: BlockDefinition): this {
    const normalized = normalizeBlockDefinition(definition);
    if (this.blocks.has(normalized.id)) {
      throw new Error(`Block catalog already contains a block named '${normalized.id}'.`);
    }
    this.blocks.set(normalized.id, normalized);
    return this;
  }

  registerMany(definitions: readonly BlockDefinition[]): this {
    for (const definition of definitions) {
      this.register(definition);
    }
    return this;
  }

  has(blockId: string): boolean {
    return this.blocks.has(blockId);
  }

  get(blockId: string): NormalizedBlockDefinition {
    const result = this.blocks.get(blockId);
    if (!result) {
      throw new Error(`Unknown block definition '${blockId}'.`);
    }
    return result;
  }

  list(): NormalizedBlockDefinition[] {
    return [...this.blocks.values()];
  }

  getAnchor(blockId: string, anchorId: string): NormalizedAnchorDefinition {
    const block = this.get(blockId);
    const anchor = block.anchors.find((entry) => entry.id === anchorId);
    if (!anchor) {
      throw new Error(`Unknown anchor '${anchorId}' on block '${blockId}'.`);
    }
    return anchor;
  }

  getPart(blockId: string, partId: string): NormalizedBlockPartDefinition {
    const block = this.get(blockId);
    const part = block.parts.find((entry) => entry.id === partId);
    if (!part) {
      throw new Error(`Unknown part '${partId}' on block '${blockId}'.`);
    }
    return part;
  }
}

export function structuralPolarityMatch(a: AnchorPolarity, b: AnchorPolarity): boolean {
  if (a === "neutral" || b === "neutral") {
    return true;
  }
  return a !== b;
}

export function cloneBlockDefinition(block: NormalizedBlockDefinition): NormalizedBlockDefinition {
  return {
    ...block,
    parts: block.parts.map((part) => ({ ...part })),
    anchors: block.anchors.map((anchor) => ({
      ...anchor,
      position: cloneVec3(anchor.position),
      normal: cloneVec3(anchor.normal),
      orientation: anchor.orientation ? { ...anchor.orientation } : { ...QUAT_IDENTITY },
    })),
    colliders: block.colliders.map((collider) => ({ ...collider, transform: cloneTransform(collider.transform) })),
    geometry: block.geometry.map((geometry) => ({ ...geometry, transform: cloneTransform(geometry.transform) })),
    behaviors: block.behaviors.map((behavior) => ({ ...behavior, props: { ...behavior.props } })),
    joint: block.joint ? { ...block.joint } : undefined,
  };
}
