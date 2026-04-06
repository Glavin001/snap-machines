export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Transform {
  position: Vec3;
  rotation: Quat;
}

export const EPSILON = 1e-6;

export const VEC3_ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
export const VEC3_ONE: Vec3 = Object.freeze({ x: 1, y: 1, z: 1 });
export const VEC3_X: Vec3 = Object.freeze({ x: 1, y: 0, z: 0 });
export const VEC3_Y: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 });
export const VEC3_Z: Vec3 = Object.freeze({ x: 0, y: 0, z: 1 });
export const QUAT_IDENTITY: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
export const TRANSFORM_IDENTITY: Transform = Object.freeze({
  position: VEC3_ZERO,
  rotation: QUAT_IDENTITY,
});

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function quat(x = 0, y = 0, z = 0, w = 1): Quat {
  return { x, y, z, w };
}

export function transform(position: Vec3 = VEC3_ZERO, rotation: Quat = QUAT_IDENTITY): Transform {
  return { position: cloneVec3(position), rotation: cloneQuat(rotation) };
}

export function cloneVec3(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function cloneQuat(q: Quat): Quat {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

export function cloneTransform(t: Transform): Transform {
  return { position: cloneVec3(t.position), rotation: cloneQuat(t.rotation) };
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function mulVec3Scalar(v: Vec3, scalar: number): Vec3 {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

export function divVec3Scalar(v: Vec3, scalar: number): Vec3 {
  if (Math.abs(scalar) <= EPSILON) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: v.x / scalar, y: v.y / scalar, z: v.z / scalar };
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lengthSqVec3(v: Vec3): number {
  return dotVec3(v, v);
}

export function lengthVec3(v: Vec3): number {
  return Math.sqrt(lengthSqVec3(v));
}

export function normalizeVec3(v: Vec3): Vec3 {
  const length = lengthVec3(v);
  if (length <= EPSILON) {
    return { x: 0, y: 0, z: 0 };
  }
  return divVec3Scalar(v, length);
}

export function distanceSqVec3(a: Vec3, b: Vec3): number {
  return lengthSqVec3(subVec3(a, b));
}

export function distanceVec3(a: Vec3, b: Vec3): number {
  return Math.sqrt(distanceSqVec3(a, b));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function saturate(value: number): number {
  return clamp(value, 0, 1);
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function almostEqual(a: number, b: number, epsilon = EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

export function quatNormalize(q: Quat): Quat {
  const mag = Math.hypot(q.x, q.y, q.z, q.w);
  if (mag <= EPSILON) {
    return cloneQuat(QUAT_IDENTITY);
  }
  return {
    x: q.x / mag,
    y: q.y / mag,
    z: q.z / mag,
    w: q.w / mag,
  };
}

export function quatConjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function quatInverse(q: Quat): Quat {
  return quatNormalize(quatConjugate(q));
}

export function mulQuatRaw(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function mulQuat(a: Quat, b: Quat): Quat {
  return quatNormalize(mulQuatRaw(a, b));
}

export function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const n = normalizeVec3(axis);
  const s = Math.sin(angleRad * 0.5);
  return quatNormalize({
    x: n.x * s,
    y: n.y * s,
    z: n.z * s,
    w: Math.cos(angleRad * 0.5),
  });
}

export function rotateVec3(q: Quat, v: Vec3): Vec3 {
  const u = { x: q.x, y: q.y, z: q.z };
  const s = q.w;
  const uv = crossVec3(u, v);
  const uuv = crossVec3(u, uv);
  return addVec3(v, addVec3(mulVec3Scalar(uv, 2 * s), mulVec3Scalar(uuv, 2)));
}

export function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const f = normalizeVec3(from);
  const t = normalizeVec3(to);
  const dot = clamp(dotVec3(f, t), -1, 1);

  if (dot < -1 + EPSILON) {
    const axis = normalizeVec3(
      Math.abs(f.x) > Math.abs(f.z) ? { x: -f.y, y: f.x, z: 0 } : { x: 0, y: -f.z, z: f.y },
    );
    return quatFromAxisAngle(axis, Math.PI);
  }

  const cross = crossVec3(f, t);
  return quatNormalize({
    x: cross.x,
    y: cross.y,
    z: cross.z,
    w: 1 + dot,
  });
}

export function quatFromBasis(right: Vec3, up: Vec3, forward: Vec3): Quat {
  const m00 = right.x;
  const m01 = up.x;
  const m02 = forward.x;
  const m10 = right.y;
  const m11 = up.y;
  const m12 = forward.y;
  const m20 = right.z;
  const m21 = up.z;
  const m22 = forward.z;

  const trace = m00 + m11 + m22;
  let x = 0;
  let y = 0;
  let z = 0;
  let w = 1;

  if (trace > 0) {
    const s = Math.sqrt(trace + 1.0) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }

  return quatNormalize({ x, y, z, w });
}

export function lookRotation(forward: Vec3, upHint: Vec3 = VEC3_Y): Quat {
  const z = normalizeVec3(forward);
  let x = normalizeVec3(crossVec3(upHint, z));
  if (lengthSqVec3(x) <= EPSILON) {
    x = normalizeVec3(crossVec3(Math.abs(z.y) < 0.99 ? VEC3_Y : VEC3_X, z));
  }
  const y = normalizeVec3(crossVec3(z, x));
  return quatFromBasis(x, y, z);
}

export function ensureAnchorOrientation(normal: Vec3, orientation?: Quat): Quat {
  if (orientation) {
    return quatNormalize(orientation);
  }
  return lookRotation(normal);
}

export function composeTransforms(a: Transform, b: Transform): Transform {
  return {
    position: addVec3(a.position, rotateVec3(a.rotation, b.position)),
    rotation: mulQuat(a.rotation, b.rotation),
  };
}

export function inverseTransform(t: Transform): Transform {
  const invRot = quatInverse(t.rotation);
  return {
    position: rotateVec3(invRot, mulVec3Scalar(t.position, -1)),
    rotation: invRot,
  };
}

export function transformPoint(t: Transform, point: Vec3): Vec3 {
  return addVec3(t.position, rotateVec3(t.rotation, point));
}

export function transformDirection(t: Transform, dir: Vec3): Vec3 {
  return rotateVec3(t.rotation, dir);
}

export function relativeTransform(parentWorld: Transform, childWorld: Transform): Transform {
  return composeTransforms(inverseTransform(parentWorld), childWorld);
}

export function projectOnPlane(vector: Vec3, normal: Vec3): Vec3 {
  const n = normalizeVec3(normal);
  return subVec3(vector, mulVec3Scalar(n, dotVec3(vector, n)));
}

export function signedAngleAroundAxis(from: Vec3, to: Vec3, axis: Vec3): number {
  const a = normalizeVec3(projectOnPlane(from, axis));
  const b = normalizeVec3(projectOnPlane(to, axis));
  if (lengthSqVec3(a) <= EPSILON || lengthSqVec3(b) <= EPSILON) {
    return 0;
  }
  const angle = Math.acos(clamp(dotVec3(a, b), -1, 1));
  const sign = dotVec3(crossVec3(a, b), normalizeVec3(axis)) >= 0 ? 1 : -1;
  return angle * sign;
}

export function quantizeAngle(angleRad: number, stepDeg?: number): number {
  if (!stepDeg || stepDeg <= EPSILON) {
    return angleRad;
  }
  const stepRad = degToRad(stepDeg);
  return Math.round(angleRad / stepRad) * stepRad;
}

export function averageVec3(points: readonly Vec3[]): Vec3 {
  if (points.length === 0) {
    return cloneVec3(VEC3_ZERO);
  }
  const sum = points.reduce((acc, point) => addVec3(acc, point), vec3());
  return divVec3Scalar(sum, points.length);
}

export function weightedAverageVec3(points: readonly Vec3[], weights: readonly number[]): Vec3 {
  if (points.length === 0 || points.length !== weights.length) {
    return cloneVec3(VEC3_ZERO);
  }
  let totalWeight = 0;
  let acc = vec3();
  for (let i = 0; i < points.length; i += 1) {
    const weight = weights[i] ?? 0;
    totalWeight += weight;
    acc = addVec3(acc, mulVec3Scalar(points[i]!, weight));
  }
  if (Math.abs(totalWeight) <= EPSILON) {
    return averageVec3(points);
  }
  return divVec3Scalar(acc, totalWeight);
}

export function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function isFiniteQuat(q: Quat): boolean {
  return Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);
}

export function axisNameToVector(axis: "x" | "y" | "z"): Vec3 {
  switch (axis) {
    case "x":
      return cloneVec3(VEC3_X);
    case "y":
      return cloneVec3(VEC3_Y);
    case "z":
      return cloneVec3(VEC3_Z);
    default:
      return cloneVec3(VEC3_Z);
  }
}
