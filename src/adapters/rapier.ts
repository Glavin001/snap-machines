import { BlockCatalog } from "../schema.js";
import { BlockGraph } from "../graph.js";
import { compileMachinePlan, MachineBehaviorPlan, MachineJointPlan, MachinePartMountPlan, MachinePlan, PlannedCollider } from "../compile/plan.js";
import {
  QUAT_IDENTITY,
  Transform,
  VEC3_X,
  VEC3_Y,
  VEC3_Z,
  Vec3,
  addVec3,
  axisNameToVector,
  composeTransforms,
  quatFromUnitVectors,
  rotateVec3,
  transformPoint,
} from "../math.js";
import type { CompileMachineOptions, CompileDiagnostic } from "../compile/plan.js";

export interface RapierRigidBodyLike {
  translation(): Vec3;
  rotation(): { x: number; y: number; z: number; w: number };
  recomputeMassPropertiesFromColliders?(): void;
  addForce?(force: Vec3, wakeUp: boolean): void;
  addForceAtPoint?(force: Vec3, point: Vec3, wakeUp: boolean): void;
  addTorque?(torque: Vec3, wakeUp: boolean): void;
  applyImpulse?(impulse: Vec3, wakeUp: boolean): void;
  applyImpulseAtPoint?(impulse: Vec3, point: Vec3, wakeUp: boolean): void;
}

export interface RapierColliderDescLike {
  setTranslation(x: number, y: number, z: number): this;
  setRotation(rotation: { x: number; y: number; z: number; w: number }): this;
  setMass?(mass: number): this;
  setSensor?(sensor: boolean): this;
  setFriction?(friction: number): this;
  setRestitution?(restitution: number): this;
  setCollisionGroups?(groups: number): this;
  setSolverGroups?(groups: number): this;
}

export interface RapierRigidBodyDescLike {
  setTranslation(x: number, y: number, z: number): this;
  setRotation(rotation: { x: number; y: number; z: number; w: number }): this;
}

export interface RapierImpulseJointLike {
  configureMotorPosition?(targetPos: number, stiffness: number, damping: number): void;
  configureMotorVelocity?(targetVel: number, factor: number): void;
  configureMotor?(targetPos: number, targetVel: number, stiffness: number, damping: number): void;
  setMotorMaxForce?(maxForce: number): void;
  setLimits?(min: number, max: number): void;
  setContactsEnabled?(enabled: boolean): void;
}

export interface RapierWorldLike {
  createRigidBody(desc: RapierRigidBodyDescLike): RapierRigidBodyLike;
  createCollider(desc: RapierColliderDescLike, parent?: RapierRigidBodyLike): unknown;
  createImpulseJoint(
    params: unknown,
    parent1: RapierRigidBodyLike,
    parent2: RapierRigidBodyLike,
    wakeUp: boolean,
  ): RapierImpulseJointLike;
  removeImpulseJoint?(joint: RapierImpulseJointLike, wakeUp: boolean): void;
  removeRigidBody(body: RapierRigidBodyLike): void;
}

export interface RapierModuleLike {
  RigidBodyDesc: {
    dynamic(): RapierRigidBodyDescLike;
    fixed(): RapierRigidBodyDescLike;
    kinematicPositionBased(): RapierRigidBodyDescLike;
    kinematicVelocityBased(): RapierRigidBodyDescLike;
  };
  ColliderDesc: {
    cuboid(x: number, y: number, z: number): RapierColliderDescLike;
    ball(radius: number): RapierColliderDescLike;
    capsule(halfHeight: number, radius: number): RapierColliderDescLike;
    cylinder?(halfHeight: number, radius: number): RapierColliderDescLike;
    convexHull?(points: Float32Array): RapierColliderDescLike | null;
    trimesh(vertices: Float32Array, indices: Uint32Array): RapierColliderDescLike;
  };
  JointData: {
    fixed(anchor1: Vec3, frame1: { x: number; y: number; z: number; w: number }, anchor2: Vec3, frame2: { x: number; y: number; z: number; w: number }): unknown;
    spherical(anchor1: Vec3, anchor2: Vec3): unknown;
    revolute(anchor1: Vec3, anchor2: Vec3, axis: Vec3): unknown;
    prismatic(anchor1: Vec3, anchor2: Vec3, axis: Vec3): unknown;
  };
}

export type RuntimeInputState = Record<string, number | boolean | undefined>;

export interface RapierBehaviorUpdateContext {
  runtime: RapierMachineRuntime;
  world: RapierWorldLike;
  RAPIER: RapierModuleLike;
  dt: number;
  input: RuntimeInputState;
}

export interface RapierBehaviorController {
  update?(context: RapierBehaviorUpdateContext): void;
  destroy?(): void;
}

export type RapierBehaviorFactory = (
  behavior: MachineBehaviorPlan,
  context: {
    runtime: RapierMachineRuntime;
    world: RapierWorldLike;
    RAPIER: RapierModuleLike;
  },
) => RapierBehaviorController | void;

export interface RapierInstantiationOptions {
  behaviorFactories?: Record<string, RapierBehaviorFactory>;
}

export interface RapierBuildResult {
  plan: MachinePlan;
  runtime: RapierMachineRuntime;
}

export class RapierMachineRuntime {
  readonly diagnostics: CompileDiagnostic[];
  readonly bodies = new Map<string, RapierRigidBodyLike>();
  readonly joints = new Map<string, RapierImpulseJointLike>();
  readonly mounts = new Map<string, MachinePartMountPlan>();
  private readonly behaviorControllers: RapierBehaviorController[] = [];

  constructor(
    readonly world: RapierWorldLike,
    readonly RAPIER: RapierModuleLike,
    readonly plan: MachinePlan,
    options: RapierInstantiationOptions = {},
  ) {
    this.diagnostics = [...plan.diagnostics];
    this.instantiateBodies();
    this.instantiateJoints();
    this.instantiateBehaviors(options.behaviorFactories ?? {});
  }

  update(input: RuntimeInputState = {}, dt = 1 / 60): void {
    for (const jointPlan of this.plan.joints) {
      const joint = this.joints.get(jointPlan.id);
      if (!joint || !jointPlan.motor) {
        continue;
      }
      applyMotorPlan(joint, jointPlan, input);
    }

    const context: RapierBehaviorUpdateContext = {
      runtime: this,
      world: this.world,
      RAPIER: this.RAPIER,
      dt,
      input,
    };
    for (const controller of this.behaviorControllers) {
      controller.update?.(context);
    }
  }

  destroy(): void {
    for (const controller of this.behaviorControllers) {
      controller.destroy?.();
    }
    for (const joint of this.joints.values()) {
      this.world.removeImpulseJoint?.(joint, true);
    }
    this.joints.clear();
    for (const body of this.bodies.values()) {
      this.world.removeRigidBody(body);
    }
    this.bodies.clear();
  }

  getBody(bodyId: string): RapierRigidBodyLike {
    const body = this.bodies.get(bodyId);
    if (!body) {
      throw new Error(`Unknown Rapier body '${bodyId}'.`);
    }
    return body;
  }

  getJoint(jointId: string): RapierImpulseJointLike {
    const joint = this.joints.get(jointId);
    if (!joint) {
      throw new Error(`Unknown Rapier joint '${jointId}'.`);
    }
    return joint;
  }

  getBodyWorldTransform(bodyId: string): Transform {
    const body = this.getBody(bodyId);
    return {
      position: body.translation(),
      rotation: body.rotation(),
    };
  }

  getMountWorldTransform(mountId: string): Transform {
    const mount = this.mounts.get(mountId);
    if (!mount) {
      throw new Error(`Unknown mount '${mountId}'.`);
    }
    const bodyWorld = this.getBodyWorldTransform(mount.bodyId);
    return composeTransforms(bodyWorld, mount.localTransform);
  }

  private instantiateBodies(): void {
    for (const bodyPlan of this.plan.bodies) {
      const bodyDesc = createRigidBodyDesc(this.RAPIER, bodyPlan);
      const body = this.world.createRigidBody(bodyDesc);
      for (const colliderPlan of bodyPlan.colliders) {
        const desc = createColliderDesc(this.RAPIER, colliderPlan);
        this.world.createCollider(desc, body);
      }
      body.recomputeMassPropertiesFromColliders?.();
      this.bodies.set(bodyPlan.id, body);
    }

    for (const mount of this.plan.mounts) {
      this.mounts.set(mount.id, mount);
    }
  }

  private instantiateJoints(): void {
    for (const jointPlan of this.plan.joints) {
      const bodyA = this.getBody(jointPlan.bodyAId);
      const bodyB = this.getBody(jointPlan.bodyBId);
      const params = createJointData(this.RAPIER, jointPlan);
      const joint = this.world.createImpulseJoint(params, bodyA, bodyB, true);
      if (jointPlan.limits) {
        joint.setLimits?.(jointPlan.limits.min, jointPlan.limits.max);
      }
      joint.setContactsEnabled?.(jointPlan.collideConnected);
      if (jointPlan.motor?.maxForce !== undefined) {
        joint.setMotorMaxForce?.(jointPlan.motor.maxForce);
      }
      this.joints.set(jointPlan.id, joint);
    }
  }

  private instantiateBehaviors(factories: Record<string, RapierBehaviorFactory>): void {
    for (const behavior of this.plan.behaviors) {
      const factory = factories[behavior.kind];
      if (!factory) {
        continue;
      }
      const controller = factory(behavior, {
        runtime: this,
        world: this.world,
        RAPIER: this.RAPIER,
      });
      if (controller) {
        this.behaviorControllers.push(controller);
      }
    }
  }
}

export function buildGraphIntoRapier(
  graph: BlockGraph,
  catalog: BlockCatalog,
  RAPIER: RapierModuleLike,
  world: RapierWorldLike,
  options: CompileMachineOptions & RapierInstantiationOptions = {},
): RapierBuildResult {
  const plan = compileMachinePlan(graph, catalog, options);
  const runtime = new RapierMachineRuntime(world, RAPIER, plan, options);
  return { plan, runtime };
}

export function createRigidBodyDesc(RAPIER: RapierModuleLike, bodyPlan: MachinePlan["bodies"][number]): RapierRigidBodyDescLike {
  const desc = (() => {
    switch (bodyPlan.kind) {
      case "fixed":
        return RAPIER.RigidBodyDesc.fixed();
      case "kinematicPosition":
        return RAPIER.RigidBodyDesc.kinematicPositionBased();
      case "kinematicVelocity":
        return RAPIER.RigidBodyDesc.kinematicVelocityBased();
      case "dynamic":
      default:
        return RAPIER.RigidBodyDesc.dynamic();
    }
  })();

  desc.setTranslation(bodyPlan.origin.position.x, bodyPlan.origin.position.y, bodyPlan.origin.position.z);
  desc.setRotation(bodyPlan.origin.rotation);
  return desc;
}

export function createColliderDesc(RAPIER: RapierModuleLike, collider: PlannedCollider): RapierColliderDescLike {
  const axisRotation = collider.axis ? quatFromUnitVectors(VEC3_Y, axisNameToVector(collider.axis)) : QUAT_IDENTITY;
  const finalRotation = multiplyQuat(collider.localTransform.rotation, axisRotation);

  const desc = (() => {
    switch (collider.kind) {
      case "box":
        return RAPIER.ColliderDesc.cuboid(
          collider.halfExtents!.x,
          collider.halfExtents!.y,
          collider.halfExtents!.z,
        );
      case "sphere":
        return RAPIER.ColliderDesc.ball(collider.radius!);
      case "capsule":
        return RAPIER.ColliderDesc.capsule(collider.halfHeight!, collider.radius!);
      case "cylinder":
        return (RAPIER.ColliderDesc.cylinder?.(collider.halfHeight!, collider.radius!) ??
          RAPIER.ColliderDesc.capsule(collider.halfHeight!, collider.radius!));
      case "convexHull": {
        const points = new Float32Array(flattenVec3Array(collider.points ?? []));
        const built = RAPIER.ColliderDesc.convexHull?.(points);
        if (!built) {
          throw new Error(`Failed to construct Rapier convex hull collider '${collider.id}'.`);
        }
        return built;
      }
      case "trimesh":
        return RAPIER.ColliderDesc.trimesh(new Float32Array(collider.vertices ?? []), new Uint32Array(collider.indices ?? []));
      default:
        throw new Error(`Unsupported collider kind '${(collider as PlannedCollider).kind}'.`);
    }
  })();

  desc.setTranslation(
    collider.localTransform.position.x,
    collider.localTransform.position.y,
    collider.localTransform.position.z,
  );
  desc.setRotation(finalRotation);
  if (collider.mass !== undefined) {
    desc.setMass?.(collider.mass);
  }
  desc.setSensor?.(collider.sensor);
  if (collider.friction !== undefined) {
    desc.setFriction?.(collider.friction);
  }
  if (collider.restitution !== undefined) {
    desc.setRestitution?.(collider.restitution);
  }
  if (collider.collisionGroups !== undefined) {
    desc.setCollisionGroups?.(collider.collisionGroups);
  }
  if (collider.solverGroups !== undefined) {
    desc.setSolverGroups?.(collider.solverGroups);
  }
  return desc;
}

export function createJointData(RAPIER: RapierModuleLike, joint: MachineJointPlan): unknown {
  const params = (() => {
    switch (joint.kind) {
      case "fixed":
        return RAPIER.JointData.fixed(
          joint.localAnchorA,
          joint.localFrameA ?? QUAT_IDENTITY,
          joint.localAnchorB,
          joint.localFrameB ?? QUAT_IDENTITY,
        );
      case "spherical":
        return RAPIER.JointData.spherical(joint.localAnchorA, joint.localAnchorB);
      case "revolute":
        return RAPIER.JointData.revolute(joint.localAnchorA, joint.localAnchorB, joint.localAxisA ?? VEC3_X);
      case "prismatic":
        return RAPIER.JointData.prismatic(joint.localAnchorA, joint.localAnchorB, joint.localAxisA ?? VEC3_X);
      default:
        throw new Error(`Unsupported joint kind '${joint.kind}'.`);
    }
  })() as { limitsEnabled?: boolean; limits?: [number, number] };

  if (joint.limits) {
    params.limitsEnabled = true;
    params.limits = [joint.limits.min, joint.limits.max];
  }

  return params;
}

function applyMotorPlan(joint: RapierImpulseJointLike, jointPlan: MachineJointPlan, input: RuntimeInputState): void {
  const motor = jointPlan.motor;
  if (!motor) {
    return;
  }
  const inputValue = motor.input ? readInputBinding(input, motor.input) : 0;
  let targetPosition = motor.targetPosition;
  let targetVelocity = motor.targetVelocity;

  switch (motor.inputTarget) {
    case "position":
      targetPosition += inputValue;
      break;
    case "velocity":
      targetVelocity += inputValue;
      break;
    case "both":
      targetPosition += inputValue;
      targetVelocity += inputValue;
      break;
    default:
      break;
  }

  switch (motor.mode) {
    case "position":
      joint.configureMotorPosition?.(targetPosition, motor.stiffness, motor.damping);
      break;
    case "full":
      joint.configureMotor?.(targetPosition, targetVelocity, motor.stiffness, motor.damping);
      break;
    case "velocity":
    default:
      joint.configureMotorVelocity?.(targetVelocity, motor.damping);
      break;
  }
  if (motor.maxForce !== undefined) {
    joint.setMotorMaxForce?.(motor.maxForce);
  }
}

export function readInputBinding(input: RuntimeInputState, binding: MachineJointPlan["motor"] extends { input: infer T } ? T : never): number;
export function readInputBinding(input: RuntimeInputState, binding: { action: string; scale?: number; invert?: boolean; deadzone?: number; clamp?: [number, number] }): number;
export function readInputBinding(input: RuntimeInputState, binding: { action: string; scale?: number; invert?: boolean; deadzone?: number; clamp?: [number, number] }): number {
  const raw = input[binding.action];
  const numeric = typeof raw === "boolean" ? (raw ? 1 : 0) : typeof raw === "number" ? raw : 0;
  let value = numeric * (binding.scale ?? 1);
  if (binding.invert) {
    value *= -1;
  }
  if (binding.deadzone !== undefined && Math.abs(value) < binding.deadzone) {
    value = 0;
  }
  if (binding.clamp) {
    value = Math.min(Math.max(value, binding.clamp[0]), binding.clamp[1]);
  }
  return value;
}

export function createThrusterBehaviorFactory(): RapierBehaviorFactory {
  return (behavior, { runtime }) => {
    if (behavior.kind !== "thruster") {
      return undefined;
    }

    const body = runtime.getBody(behavior.bodyId);
    const localDirection = jsonVec3(behavior.props.localDirection, VEC3_Z);
    const localPoint = jsonVec3(behavior.props.localPoint, { x: 0, y: 0, z: 0 });
    const force = jsonNumber(behavior.props.force, 0);
    const binding = behavior.input;

    return {
      update: ({ input }) => {
        if (!body.addForceAtPoint) {
          return;
        }
        const amount = binding ? readInputBinding(input, binding) : 1;
        if (amount === 0) {
          return;
        }
        const bodyTransform = runtime.getBodyWorldTransform(behavior.bodyId);
        const worldDirection = rotateVec3(bodyTransform.rotation, localDirection);
        const worldPoint = transformPoint(bodyTransform, localPoint);
        body.addForceAtPoint(
          {
            x: worldDirection.x * force * amount,
            y: worldDirection.y * force * amount,
            z: worldDirection.z * force * amount,
          },
          worldPoint,
          true,
        );
      },
    };
  };
}

function flattenVec3Array(points: readonly Vec3[]): number[] {
  const result: number[] = [];
  for (const point of points) {
    result.push(point.x, point.y, point.z);
  }
  return result;
}

function multiplyQuat(a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function jsonNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function jsonVec3(value: unknown, fallback: Vec3): Vec3 {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const vector = value as Partial<Vec3>;
  if (typeof vector.x === "number" && typeof vector.y === "number" && typeof vector.z === "number") {
    return { x: vector.x, y: vector.y, z: vector.z };
  }
  return fallback;
}
