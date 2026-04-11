import { memo, useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  BlockCatalog,
  Transform,
} from "@snap-machines/core";
import { GeometryMesh } from "./GeometryMesh.js";
import { DEFAULT_BLOCK_COLORS } from "./colors.js";

export interface BlockMeshProps {
  nodeId: string;
  typeId: string;
  blockTransform: Transform;
  catalog: BlockCatalog;
  colorMap?: Record<string, string>;
  highlight?: boolean;
}

export const BlockMesh = memo(function BlockMesh({
  nodeId,
  typeId,
  blockTransform,
  catalog,
  colorMap,
  highlight,
}: BlockMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const block = useMemo(() => catalog.get(typeId), [catalog, typeId]);
  const colors = colorMap ?? DEFAULT_BLOCK_COLORS;
  const color = colors[typeId] ?? "#999";

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
        <GeometryMesh key={geo.id} geometry={geo} color={color} highlight={highlight} />
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
                <meshStandardMaterial
                  color={color}
                  emissive={highlight ? "#ffcc00" : "#000000"}
                  emissiveIntensity={highlight ? 0.6 : 0}
                />
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
                <meshStandardMaterial
                  color={color}
                  emissive={highlight ? "#ffcc00" : "#000000"}
                  emissiveIntensity={highlight ? 0.6 : 0}
                />
              </mesh>
            );
          }
          return null;
        })}
    </group>
  );
});
