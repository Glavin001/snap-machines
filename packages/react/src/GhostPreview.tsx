import { memo, useMemo, forwardRef, useEffect, useRef } from "react";
import * as THREE from "three";
import {
  BlockCatalog,
  NormalizedGeometryDefinition,
} from "@snap-machines/core";

export interface GhostPreviewProps {
  typeId: string;
  catalog: BlockCatalog;
}

/** Shared ghost material settings. polygonOffset prevents z-fighting when the
 *  ghost overlaps the surface of the block it's snapping to. */
const GHOST_MATERIAL = {
  color: "#88ff88",
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
} as const;

export const GhostPreview = memo(forwardRef<THREE.Group, GhostPreviewProps>(
  function GhostPreview({ typeId, catalog }, ref) {
    const localRef = useRef<THREE.Group>(null);
    const block = useMemo(() => catalog.get(typeId), [catalog, typeId]);

    // Disable raycasting on every mesh inside the ghost so pointer events
    // pass straight through to the actual blocks underneath.
    useEffect(() => {
      const group = localRef.current;
      if (group) {
        group.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.raycast = noop;
          }
        });
      }
    }); // intentionally no deps — re-run after every render to catch new meshes

    return (
      <group
        ref={(node: THREE.Group | null) => {
          localRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) (ref as React.MutableRefObject<THREE.Group | null>).current = node;
        }}
        visible={false}
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
                  <meshStandardMaterial {...GHOST_MATERIAL} />
                </mesh>
              );
            }
            return null;
          })}
      </group>
    );
  },
));

function GhostGeometry({ geometry }: { geometry: NormalizedGeometryDefinition }) {
  const t = geometry.transform;

  switch (geometry.kind) {
    case "box":
      return (
        <mesh
          position={[t.position.x, t.position.y, t.position.z]}
          quaternion={[t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w]}
        >
          <boxGeometry args={[geometry.size.x, geometry.size.y, geometry.size.z]} />
          <meshStandardMaterial {...GHOST_MATERIAL} />
        </mesh>
      );
    case "sphere":
      return (
        <mesh position={[t.position.x, t.position.y, t.position.z]}>
          <sphereGeometry args={[geometry.radius, 24, 24]} />
          <meshStandardMaterial {...GHOST_MATERIAL} />
        </mesh>
      );
    default:
      return null;
  }
}

// Stable no-op function assigned to mesh.raycast to suppress raycasting.
function noop() {}
