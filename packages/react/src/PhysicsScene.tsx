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
  RuntimeInputState,
} from "@snap-machines/core";
import { GeometryMesh } from "./GeometryMesh.js";
import { DEFAULT_BLOCK_COLORS } from "./colors.js";
import { PlayerController } from "./PlayerController.js";

export interface PhysicsSceneProps {
  graph: BlockGraph;
  catalog: BlockCatalog;
  inputState: RuntimeInputState;
  colorMap?: Record<string, string>;
  firstPerson?: boolean;
  gravity?: number;
  onReady?: () => void;
}

export function PhysicsScene({ graph, catalog, inputState, colorMap, firstPerson, gravity = 9.81, onReady }: PhysicsSceneProps) {
  const worldRef = useRef<RAPIER.World | null>(null);
  const runtimeRef = useRef<RapierMachineRuntime | null>(null);
  const [plan, setPlan] = useState<MachinePlan | null>(null);
  const [rapierReady, setRapierReady] = useState(false);
  const meshGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const readyRef = useRef(false);
  const inputRef = useRef<RuntimeInputState>(inputState);
  const colors = colorMap ?? DEFAULT_BLOCK_COLORS;

  inputRef.current = inputState;

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
          color={colors[mount.blockTypeId] ?? "#999"}
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
  color: string;
  onRef: (group: THREE.Group | null) => void;
}

function MountMesh({ mount, color, onRef }: MountMeshProps) {
  const groupRef = useRef<THREE.Group>(null);

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
