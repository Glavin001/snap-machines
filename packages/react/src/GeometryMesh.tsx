import {
  NormalizedGeometryDefinition,
  VEC3_Y,
  quatFromUnitVectors,
  axisNameToVector,
  mulQuat,
} from "@snap-machines/core";

export interface GeometryMeshProps {
  geometry: NormalizedGeometryDefinition;
  color: string;
  /** When true, adds a bright emissive glow to highlight this part */
  highlight?: boolean;
}

const HIGHLIGHT_EMISSIVE = "#ffcc00";
const HIGHLIGHT_INTENSITY = 0.6;

export function GeometryMesh({ geometry, color, highlight }: GeometryMeshProps) {
  const t = geometry.transform;
  const matProps = highlight
    ? { color, emissive: HIGHLIGHT_EMISSIVE, emissiveIntensity: HIGHLIGHT_INTENSITY }
    : { color };

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
          <meshStandardMaterial {...matProps} />
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
          <meshStandardMaterial {...matProps} />
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
          <meshStandardMaterial {...matProps} />
        </mesh>
      );
    case "cylinder": {
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
          <meshStandardMaterial {...matProps} />
        </mesh>
      );
    }
    default:
      return null;
  }
}
