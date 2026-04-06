import { useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  BlockCatalog,
  NormalizedBlockDefinition,
  NormalizedGeometryDefinition,
  Transform,
  composeTransforms,
} from "snap-construction-system";

interface BlockMeshProps {
  nodeId: string;
  typeId: string;
  blockTransform: Transform;
  catalog: BlockCatalog;
}

const BLOCK_COLORS: Record<string, string> = {
  "frame.cube.1": "#5b8def",
  "joint.hinge.small": "#e8a838",
  "utility.thruster.small": "#ef5b5b",
};

export function BlockMesh({ nodeId, typeId, blockTransform, catalog }: BlockMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const block = useMemo(() => catalog.get(typeId), [catalog, typeId]);
  const color = BLOCK_COLORS[typeId] ?? "#999";

  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.userData.snapBlockId = nodeId;
    }
  }, [nodeId]);

  const pos = blockTransform.position;
  const rot = blockTransform.rotation;

  return (
    <group
      ref={groupRef}
      position={[pos.x, pos.y, pos.z]}
      quaternion={[rot.x, rot.y, rot.z, rot.w]}
    >
      {block.geometry.map((geo) => (
        <GeometryMesh key={geo.id} geometry={geo} color={color} />
      ))}
      {/* Fallback: if no geometry, render from colliders */}
      {block.geometry.length === 0 &&
        block.colliders.map((col) => {
          if (col.kind === "box") {
            const he = col.halfExtents!;
            const ct = col.transform;
            return (
              <mesh
                key={col.id}
                position={[ct.position.x, ct.position.y, ct.position.z]}
                quaternion={[ct.rotation.x, ct.rotation.y, ct.rotation.z, ct.rotation.w]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[he.x * 2, he.y * 2, he.z * 2]} />
                <meshStandardMaterial color={color} />
              </mesh>
            );
          }
          if (col.kind === "sphere") {
            const ct = col.transform;
            return (
              <mesh
                key={col.id}
                position={[ct.position.x, ct.position.y, ct.position.z]}
                castShadow
                receiveShadow
              >
                <sphereGeometry args={[col.radius!, 16, 16]} />
                <meshStandardMaterial color={color} />
              </mesh>
            );
          }
          return null;
        })}
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
    case "cylinder":
      return (
        <mesh
          position={[t.position.x, t.position.y, t.position.z]}
          quaternion={[t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w]}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[geometry.radius, geometry.radius, geometry.halfHeight * 2, 24]} />
          <meshStandardMaterial color={color} />
        </mesh>
      );
    default:
      return null;
  }
}
