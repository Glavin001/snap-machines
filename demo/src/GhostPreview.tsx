import { useMemo } from "react";
import {
  BlockCatalog,
  NormalizedGeometryDefinition,
  Transform,
} from "snap-construction-system";

interface GhostPreviewProps {
  typeId: string;
  blockTransform: Transform;
  catalog: BlockCatalog;
}

export function GhostPreview({ typeId, blockTransform, catalog }: GhostPreviewProps) {
  const block = useMemo(() => catalog.get(typeId), [catalog, typeId]);
  const pos = blockTransform.position;
  const rot = blockTransform.rotation;

  return (
    <group
      position={[pos.x, pos.y, pos.z]}
      quaternion={[rot.x, rot.y, rot.z, rot.w]}
    >
      {block.geometry.map((geo) => (
        <GhostGeometry key={geo.id} geometry={geo} />
      ))}
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
              >
                <boxGeometry args={[he.x * 2, he.y * 2, he.z * 2]} />
                <meshStandardMaterial
                  color="#88ff88"
                  transparent
                  opacity={0.4}
                  depthWrite={false}
                />
              </mesh>
            );
          }
          return null;
        })}
    </group>
  );
}

function GhostGeometry({ geometry }: { geometry: NormalizedGeometryDefinition }) {
  const t = geometry.transform;
  const materialProps = {
    color: "#88ff88",
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  } as const;

  switch (geometry.kind) {
    case "box":
      return (
        <mesh
          position={[t.position.x, t.position.y, t.position.z]}
          quaternion={[t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w]}
        >
          <boxGeometry args={[geometry.size.x, geometry.size.y, geometry.size.z]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      );
    case "sphere":
      return (
        <mesh position={[t.position.x, t.position.y, t.position.z]}>
          <sphereGeometry args={[geometry.radius, 24, 24]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      );
    default:
      return null;
  }
}
