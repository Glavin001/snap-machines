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
  MachinePartMountPlan,
  NormalizedGeometryDefinition,
  RuntimeInputState,
  VEC3_Y,
  quatFromUnitVectors,
  axisNameToVector,
  mulQuat,
} from "snap-construction-system";
import { PlayerController } from "./PlayerController.js";

interface PhysicsSceneProps {
  graph: BlockGraph;
  catalog: BlockCatalog;
  inputState: RuntimeInputState;
  firstPerson?: boolean;
  onReady?: () => void;
}

const BLOCK_COLORS: Record<string, string> = {
  "frame.cube.1": "#5b8def",
  "frame.plank.3x1": "#4a7cd8",
  "frame.beam.5x1": "#3d6bc4",
  "joint.hinge.small": "#e8a838",
  "joint.motor.wheel": "#d4962e",
  "utility.thruster.small": "#ef5b5b",
  "utility.thruster.up": "#ef5b5b",
};

export function PhysicsScene({ graph, catalog, inputState, firstPerson, onReady }: PhysicsSceneProps) {
  const worldRef = useRef<RAPIER.World | null>(null);
  const runtimeRef = useRef<RapierMachineRuntime | null>(null);
  const [plan, setPlan] = useState<MachinePlan | null>(null);
  const [rapierReady, setRapierReady] = useState(false);
  const meshGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const readyRef = useRef(false);
  const inputRef = useRef<RuntimeInputState>(inputState);

  inputRef.current = inputState;

  const groundRef = useRef<RAPIER.RigidBody | null>(null);

  useEffect(() => {
    let cancelled = false;

    RAPIER.init().then(() => {
      if (cancelled) return;

      const gravity = new RAPIER.Vector3(0, -9.81, 0);
      const world = new RAPIER.World(gravity);
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
  }, [graph, catalog]);

  useFrame((_state, delta) => {
    if (!readyRef.current || !worldRef.current || !runtimeRef.current || !plan) return;

    const dt = Math.min(delta, 1 / 30);
    runtimeRef.current.update(inputRef.current, dt);
    worldRef.current.step();

    const runtime = runtimeRef.current;
    for (const mount of plan.mounts) {
      const group = meshGroupsRef.current.get(mount.id);
      if (!group) continue;
      const t = runtime.getMountWorldTransform(mount.id);
      group.position.set(t.position.x, t.position.y, t.position.z);
      group.quaternion.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
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
          onRef={(group) => {
            if (group) {
              meshGroupsRef.current.set(mount.id, group);
            } else {
              meshGroupsRef.current.delete(mount.id);
            }
          }}
        />
      ))}
      {firstPerson && rapierReady && worldRef.current && (
        <PlayerController world={worldRef.current} RAPIER={RAPIER} />
      )}
    </group>
  );
}

interface MountMeshProps {
  mount: MachinePartMountPlan;
  onRef: (group: THREE.Group | null) => void;
}

function MountMesh({ mount, onRef }: MountMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const color = BLOCK_COLORS[mount.blockTypeId] ?? "#999";

  useEffect(() => {
    onRef(groupRef.current);
    return () => onRef(null);
  }, []);

  return (
    <group ref={groupRef}>
      {mount.geometry.map((geo) => (
        <GeometryMesh key={geo.id} geometry={geo} color={color} />
      ))}
      {mount.geometry.length === 0 && (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.3, 0.3, 0.3]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
    </group>
  );
}

function GeometryMesh({ geometry, color }: { geometry: NormalizedGeometryDefinition; color: string }) {
  const t = geometry.transform;

  switch (geometry.kind) {
    case "box":
      return (
        <mesh
          position={[t.position.x, t.position.y, t.position.z]}
          quaternion={[t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[geometry.size.x, geometry.size.y, geometry.size.z]} />
          <meshStandardMaterial color={color} />
        </mesh>
      );
    case "sphere":
      return (
        <mesh
          position={[t.position.x, t.position.y, t.position.z]}
          castShadow
          receiveShadow
        >
          <sphereGeometry args={[geometry.radius, 24, 24]} />
          <meshStandardMaterial color={color} />
        </mesh>
      );
    case "capsule":
      return (
        <mesh
          position={[t.position.x, t.position.y, t.position.z]}
          quaternion={[t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w]}
          castShadow
          receiveShadow
        >
          <capsuleGeometry args={[geometry.radius, geometry.halfHeight * 2, 8, 16]} />
          <meshStandardMaterial color={color} />
        </mesh>
      );
    case "cylinder": {
      // Three.js CylinderGeometry defaults to Y-axis. Apply axis correction.
      const axisRot = geometry.axis && geometry.axis !== "y"
        ? quatFromUnitVectors(VEC3_Y, axisNameToVector(geometry.axis))
        : null;
      const rot = axisRot ? mulQuat(t.rotation, axisRot) : t.rotation;
      return (
        <mesh
          position={[t.position.x, t.position.y, t.position.z]}
          quaternion={[rot.x, rot.y, rot.z, rot.w]}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[geometry.radius, geometry.radius, geometry.halfHeight * 2, 24]} />
          <meshStandardMaterial color={color} />
        </mesh>
      );
    }
    default:
      return null;
  }
}
