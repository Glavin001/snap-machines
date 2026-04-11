import { useRef, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  BlockCatalog,
  BlockGraph,
  RapierMachineRuntime,
  buildGraphIntoRapier,
  createThrusterBehaviorFactory,
  MachinePlan,
  MachineJointPlan,
  MachinePartMountPlan,
  RuntimeInputState,
  ControlMap,
  updateControlMapInput,
} from "@snap-machines/core";
import { GeometryMesh } from "./GeometryMesh.js";
import { DEFAULT_BLOCK_COLORS } from "./colors.js";
import { PlayerController } from "./PlayerController.js";

/**
 * Compute the angle of a revolute/prismatic impulse joint from body rotations
 * and joint frame transforms. Returns the scalar angle (radians) around the
 * joint's free axis.
 */
function computeJointAngle(joint: RAPIER.ImpulseJoint): number {
  try {
    const r1 = joint.body1().rotation();
    const r2 = joint.body2().rotation();
    const f1 = joint.frameX1();
    const f2 = joint.frameX2();

    // qRel = fA * conj(qA) * qB * conj(fB)
    // The angle around X axis of qRel is the joint angle
    const qA = new THREE.Quaternion(r1.x, r1.y, r1.z, r1.w);
    const qB = new THREE.Quaternion(r2.x, r2.y, r2.z, r2.w);
    const fA = new THREE.Quaternion(f1.x, f1.y, f1.z, f1.w);
    const fB = new THREE.Quaternion(f2.x, f2.y, f2.z, f2.w);

    const qRel = fA
      .multiply(qA.conjugate())
      .multiply(qB)
      .multiply(fB.conjugate());

    return 2 * Math.atan2(qRel.x, qRel.w);
  } catch {
    return 0;
  }
}

export interface PhysicsSceneProps {
  graph: BlockGraph;
  catalog: BlockCatalog;
  /** Legacy direct input state (used when controlMap is not provided) */
  inputState?: RuntimeInputState;
  /** Per-motor control map — when provided, updateControlMapInput is called each frame */
  controlMap?: ControlMap;
  /** Ref to the set of currently pressed keys (used with controlMap) */
  keysDownRef?: React.RefObject<Set<string>>;
  colorMap?: Record<string, string>;
  firstPerson?: boolean;
  gravity?: number;
  onReady?: () => void;
  /** Called after compilation with the plan, so the parent can generate a ControlMap */
  onPlanReady?: (plan: MachinePlan) => void;
  /** Block ID to highlight in the 3D scene (emissive glow on matching parts) */
  highlightBlockId?: string | null;
  /** Joint plan ID — renders an axis indicator ring at the joint location */
  highlightJointId?: string | null;
}

export function PhysicsScene({ graph, catalog, inputState, controlMap, keysDownRef, colorMap, firstPerson, gravity = 9.81, onReady, onPlanReady, highlightBlockId, highlightJointId }: PhysicsSceneProps) {
  const worldRef = useRef<RAPIER.World | null>(null);
  const runtimeRef = useRef<RapierMachineRuntime | null>(null);
  const [plan, setPlan] = useState<MachinePlan | null>(null);
  const [rapierReady, setRapierReady] = useState(false);
  const meshGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const readyRef = useRef(false);
  const inputRef = useRef<RuntimeInputState>(inputState ?? {});
  const controlMapRef = useRef<ControlMap | undefined>(controlMap);
  const axisIndicatorRef = useRef<THREE.Group>(null);
  const axisIndicatorOrbitRef = useRef<THREE.Group>(null);
  const axisIndicatorPhaseRef = useRef(0);
  const colors = colorMap ?? DEFAULT_BLOCK_COLORS;

  inputRef.current = inputState ?? {};
  controlMapRef.current = controlMap;

  const groundRef = useRef<RAPIER.RigidBody | null>(null);

  useEffect(() => {
    let cancelled = false;

    RAPIER.init().then(() => {
      if (cancelled) return;

      const gravityVec = new RAPIER.Vector3(0, -gravity, 0);
      const world = new RAPIER.World(gravityVec);
      worldRef.current = world;

      // Ground plane
      const groundDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
      const groundBody = world.createRigidBody(groundDesc);
      const groundCollider = RAPIER.ColliderDesc.cuboid(50, 0.5, 50);
      world.createCollider(groundCollider, groundBody);
      groundRef.current = groundBody;

      // Compile and instantiate the machine
      const result = buildGraphIntoRapier(
        graph,
        catalog,
        RAPIER,
        world,
        {
          behaviorFactories: {
            thruster: createThrusterBehaviorFactory(),
          },
        },
      );

      setPlan(result.plan);
      runtimeRef.current = result.runtime;
      readyRef.current = true;
      setRapierReady(true);
      onPlanReady?.(result.plan);
      onReady?.();
    });

    return () => {
      cancelled = true;
      runtimeRef.current?.destroy();
      runtimeRef.current = null;
      if (groundRef.current && worldRef.current) {
        worldRef.current.removeRigidBody(groundRef.current);
        groundRef.current = null;
      }
      worldRef.current?.free();
      worldRef.current = null;
      readyRef.current = false;
      setRapierReady(false);
      setPlan(null);
    };
  }, [graph, catalog, gravity]);

  useFrame((_state, delta) => {
    if (!readyRef.current || !worldRef.current || !runtimeRef.current || !plan) return;

    const dt = Math.min(delta, 1 / 30);

    // Use ControlMap if available, otherwise fall back to direct inputState
    const effectiveInput = controlMapRef.current && keysDownRef?.current
      ? updateControlMapInput(controlMapRef.current, keysDownRef.current, dt)
      : inputRef.current;

    runtimeRef.current.update(effectiveInput, dt);
    worldRef.current.step();

    const runtime = runtimeRef.current;
    for (const mount of plan.mounts) {
      const group = meshGroupsRef.current.get(mount.id);
      if (!group) continue;
      const t = runtime.getMountWorldTransform(mount.id);
      group.position.set(t.position.x, t.position.y, t.position.z);
      group.quaternion.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
    }

    // Update actualPosition on position-mode ControlMap entries
    const cm = controlMapRef.current;
    if (cm) {
      for (const entry of cm) {
        if (entry.actuatorType !== "position") continue;
        if (!entry.actionName.startsWith("ctrl:joint:")) continue;
        const jointId = entry.actionName.slice("ctrl:joint:".length);
        try {
          const rapierJoint = runtime.getJoint(jointId) as unknown as RAPIER.ImpulseJoint;
          entry.actualPosition = computeJointAngle(rapierJoint);
        } catch {
          // Joint not found or angle computation failed
        }
      }
    }

    // Update the joint axis indicator position/orientation
    const indicator = axisIndicatorRef.current;
    if (indicator) {
      const jointPlan = highlightJointId
        ? plan.joints.find((j) => j.id === highlightJointId)
        : undefined;
      if (jointPlan) {
        indicator.visible = true;

        const bodyWorld = runtime.getBodyWorldTransform(jointPlan.bodyAId);
        const currentBodyQuat = new THREE.Quaternion(
          bodyWorld.rotation.x,
          bodyWorld.rotation.y,
          bodyWorld.rotation.z,
          bodyWorld.rotation.w,
        );
        const localAnchor = new THREE.Vector3(
          jointPlan.localAnchorA.x,
          jointPlan.localAnchorA.y,
          jointPlan.localAnchorA.z,
        );
        const worldPos = new THREE.Vector3(
          bodyWorld.position.x,
          bodyWorld.position.y,
          bodyWorld.position.z,
        ).add(localAnchor.applyQuaternion(currentBodyQuat.clone()));

        const axis = jointPlan.localAxisA ?? { x: 1, y: 0, z: 0 };
        const axisAtCompileTime = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
        const bodyPlan = plan.bodies.find((candidate) => candidate.id === jointPlan.bodyAId);
        const initialBodyQuat = bodyPlan
          ? new THREE.Quaternion(
              bodyPlan.origin.rotation.x,
              bodyPlan.origin.rotation.y,
              bodyPlan.origin.rotation.z,
              bodyPlan.origin.rotation.w,
            )
          : new THREE.Quaternion();
        const localAxis = axisAtCompileTime.clone().applyQuaternion(initialBodyQuat.clone().invert());
        const worldAxis = localAxis.applyQuaternion(currentBodyQuat).normalize();

        indicator.position.copy(worldPos);
        // torusGeometry lies in the local XY plane, so its normal is +Z.
        // Align that normal to the joint axis; aligning +Y twists the ring incorrectly.
        const ringNormal = new THREE.Vector3(0, 0, 1);
        const orientQuat = new THREE.Quaternion().setFromUnitVectors(ringNormal, worldAxis);
        indicator.quaternion.copy(orientQuat);

        const orbit = axisIndicatorOrbitRef.current;
        if (orbit) {
          const entry = controlMapRef.current?.find((candidate) => candidate.id === jointPlan.id);
          let direction = entry && entry.scale < 0 ? -1 : 1;

          if (entry) {
            const liveInput = effectiveInput[entry.actionName];
            if (typeof liveInput === "number" && liveInput !== 0) {
              direction = Math.sign(liveInput) || direction;
            }
          }

          if (entry && keysDownRef?.current) {
            const posDown = entry.positiveKey !== "" && keysDownRef.current.has(entry.positiveKey);
            const negDown = entry.negativeKey !== "" && keysDownRef.current.has(entry.negativeKey);
            const keyDirection = (posDown ? 1 : 0) - (negDown ? 1 : 0);
            if (keyDirection !== 0) {
              direction = Math.sign(keyDirection * entry.scale) || direction;
            }
          }

          axisIndicatorPhaseRef.current += dt * 2.8 * direction;
          orbit.rotation.z = axisIndicatorPhaseRef.current;
        }
      } else {
        indicator.visible = false;
      }
    }
  });

  return (
    <group>
      {/* Ground plane visual */}
      <mesh position={[0, -0.5, 0]} receiveShadow>
        <boxGeometry args={[100, 0.05, 100]} />
        <meshStandardMaterial color="#2a2a4a" />
      </mesh>
      {plan?.mounts.map((mount) => (
        <MountMesh
          key={mount.id}
          mount={mount}
          color={colors[mount.blockTypeId] ?? "#999"}
          highlight={highlightBlockId != null && mount.blockId === highlightBlockId}
          onRef={(group) => {
            if (group) {
              meshGroupsRef.current.set(mount.id, group);
            } else {
              meshGroupsRef.current.delete(mount.id);
            }
          }}
        />
      ))}
      {/* Joint axis indicator (torus ring at joint location) */}
      <group ref={axisIndicatorRef} visible={false}>
        <mesh>
          <torusGeometry args={[0.95, 0.075, 18, 72]} />
          <meshStandardMaterial
            color="#33f0ff"
            emissive="#33f0ff"
            emissiveIntensity={2.1}
            transparent
            opacity={0.96}
            depthTest={false}
          />
        </mesh>
        <group ref={axisIndicatorOrbitRef}>
          {/* Large animated arrow showing positive spin direction */}
          <mesh position={[0.95, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.14, 0.34, 12]} />
            <meshStandardMaterial
              color="#33f0ff"
              emissive="#33f0ff"
              emissiveIntensity={2.4}
              transparent
              opacity={1}
              depthTest={false}
            />
          </mesh>
          <mesh position={[0.62, 0, 0]}>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#7df9ff"
              emissiveIntensity={1.2}
              transparent
              opacity={0.9}
              depthTest={false}
            />
          </mesh>
        </group>
      </group>
      {firstPerson && rapierReady && worldRef.current && (
        <PlayerController world={worldRef.current} RAPIER={RAPIER} />
      )}
    </group>
  );
}

interface MountMeshProps {
  mount: MachinePartMountPlan;
  color: string;
  highlight?: boolean;
  onRef: (group: THREE.Group | null) => void;
}

function MountMesh({ mount, color, highlight, onRef }: MountMeshProps) {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    onRef(groupRef.current);
    return () => onRef(null);
  }, []);

  return (
    <group ref={groupRef}>
      {mount.geometry.map((geo) => (
        <GeometryMesh key={geo.id} geometry={geo} color={color} highlight={highlight} />
      ))}
      {mount.geometry.length === 0 && (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.3, 0.3, 0.3]} />
          <meshStandardMaterial
            color={color}
            {...(highlight ? { emissive: "#ffcc00", emissiveIntensity: 0.6 } : {})}
          />
        </mesh>
      )}
    </group>
  );
}
