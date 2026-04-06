import { describe, it, expect } from "vitest";
import {
  EPSILON,
  QUAT_IDENTITY,
  TRANSFORM_IDENTITY,
  VEC3_ONE,
  VEC3_X,
  VEC3_Y,
  VEC3_Z,
  VEC3_ZERO,
  addVec3,
  almostEqual,
  averageVec3,
  axisNameToVector,
  clamp,
  cloneQuat,
  cloneTransform,
  cloneVec3,
  composeTransforms,
  crossVec3,
  degToRad,
  distanceSqVec3,
  distanceVec3,
  divVec3Scalar,
  dotVec3,
  ensureAnchorOrientation,
  inverseTransform,
  isFiniteQuat,
  isFiniteVec3,
  lengthSqVec3,
  lengthVec3,
  lookRotation,
  mulQuat,
  mulQuatRaw,
  mulVec3Scalar,
  normalizeVec3,
  projectOnPlane,
  quat,
  quatConjugate,
  quatFromAxisAngle,
  quatFromBasis,
  quatFromUnitVectors,
  quatInverse,
  quatNormalize,
  quantizeAngle,
  radToDeg,
  relativeTransform,
  rotateVec3,
  saturate,
  signedAngleAroundAxis,
  subVec3,
  transform,
  transformDirection,
  transformPoint,
  vec3,
  weightedAverageVec3,
} from "../math.js";

const CLOSE = 1e-5;

function expectVec3Close(actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }) {
  expect(actual.x).toBeCloseTo(expected.x, 4);
  expect(actual.y).toBeCloseTo(expected.y, 4);
  expect(actual.z).toBeCloseTo(expected.z, 4);
}

function expectQuatClose(actual: { x: number; y: number; z: number; w: number }, expected: { x: number; y: number; z: number; w: number }) {
  // Quaternions q and -q represent the same rotation
  const sign = Math.sign(actual.w * expected.w + actual.x * expected.x + actual.y * expected.y + actual.z * expected.z) || 1;
  expect(actual.x * sign).toBeCloseTo(expected.x, 4);
  expect(actual.y * sign).toBeCloseTo(expected.y, 4);
  expect(actual.z * sign).toBeCloseTo(expected.z, 4);
  expect(actual.w * sign).toBeCloseTo(expected.w, 4);
}

describe("vec3 / quat constructors", () => {
  it("creates a vec3 with defaults", () => {
    expect(vec3()).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("creates a vec3 with values", () => {
    expect(vec3(1, 2, 3)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("creates a quat with defaults", () => {
    expect(quat()).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it("creates a transform with defaults", () => {
    const t = transform();
    expect(t.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(t.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});

describe("clone functions", () => {
  it("cloneVec3 creates a copy", () => {
    const original = vec3(1, 2, 3);
    const copy = cloneVec3(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
  });

  it("cloneQuat creates a copy", () => {
    const original = quat(0.1, 0.2, 0.3, 0.9);
    const copy = cloneQuat(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
  });

  it("cloneTransform creates a deep copy", () => {
    const original = transform(vec3(1, 2, 3), quat(0, 0, 0, 1));
    const copy = cloneTransform(original);
    expect(copy).toEqual(original);
    expect(copy.position).not.toBe(original.position);
    expect(copy.rotation).not.toBe(original.rotation);
  });
});

describe("vec3 arithmetic", () => {
  it("adds vectors", () => {
    expect(addVec3(vec3(1, 2, 3), vec3(4, 5, 6))).toEqual({ x: 5, y: 7, z: 9 });
  });

  it("subtracts vectors", () => {
    expect(subVec3(vec3(5, 7, 9), vec3(1, 2, 3))).toEqual({ x: 4, y: 5, z: 6 });
  });

  it("scales a vector", () => {
    expect(mulVec3Scalar(vec3(1, 2, 3), 2)).toEqual({ x: 2, y: 4, z: 6 });
  });

  it("divides by scalar", () => {
    expect(divVec3Scalar(vec3(2, 4, 6), 2)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("divides by near-zero returns zero", () => {
    expect(divVec3Scalar(vec3(1, 2, 3), 0)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("dot product", () => {
    expect(dotVec3(vec3(1, 0, 0), vec3(0, 1, 0))).toBe(0);
    expect(dotVec3(vec3(1, 0, 0), vec3(1, 0, 0))).toBe(1);
    expect(dotVec3(vec3(1, 2, 3), vec3(4, 5, 6))).toBe(32);
  });

  it("cross product", () => {
    expectVec3Close(crossVec3(VEC3_X, VEC3_Y), VEC3_Z);
    expectVec3Close(crossVec3(VEC3_Y, VEC3_Z), VEC3_X);
    expectVec3Close(crossVec3(VEC3_Z, VEC3_X), VEC3_Y);
  });
});

describe("vec3 length & distance", () => {
  it("lengthSq", () => {
    expect(lengthSqVec3(vec3(3, 4, 0))).toBe(25);
  });

  it("length", () => {
    expect(lengthVec3(vec3(3, 4, 0))).toBe(5);
  });

  it("normalize", () => {
    const n = normalizeVec3(vec3(0, 3, 0));
    expectVec3Close(n, vec3(0, 1, 0));
  });

  it("normalize zero vector", () => {
    expect(normalizeVec3(vec3(0, 0, 0))).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("distanceSq", () => {
    expect(distanceSqVec3(vec3(0, 0, 0), vec3(3, 4, 0))).toBe(25);
  });

  it("distance", () => {
    expect(distanceVec3(vec3(0, 0, 0), vec3(3, 4, 0))).toBe(5);
  });
});

describe("scalar utilities", () => {
  it("clamp", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("saturate", () => {
    expect(saturate(0.5)).toBe(0.5);
    expect(saturate(-1)).toBe(0);
    expect(saturate(2)).toBe(1);
  });

  it("degToRad / radToDeg roundtrip", () => {
    expect(radToDeg(degToRad(90))).toBeCloseTo(90);
    expect(radToDeg(degToRad(180))).toBeCloseTo(180);
  });

  it("almostEqual", () => {
    expect(almostEqual(1.0, 1.0 + 1e-7)).toBe(true);
    expect(almostEqual(1.0, 2.0)).toBe(false);
  });
});

describe("quaternion operations", () => {
  it("normalize identity", () => {
    expectQuatClose(quatNormalize(QUAT_IDENTITY), QUAT_IDENTITY);
  });

  it("normalize non-unit quaternion", () => {
    const q = quatNormalize(quat(0, 0, 0, 2));
    expectQuatClose(q, QUAT_IDENTITY);
  });

  it("normalize zero quat returns identity", () => {
    expectQuatClose(quatNormalize(quat(0, 0, 0, 0)), QUAT_IDENTITY);
  });

  it("conjugate", () => {
    const q = quat(1, 2, 3, 4);
    const c = quatConjugate(q);
    expect(c).toEqual({ x: -1, y: -2, z: -3, w: 4 });
  });

  it("inverse of identity is identity", () => {
    expectQuatClose(quatInverse(QUAT_IDENTITY), QUAT_IDENTITY);
  });

  it("mulQuat identity * q = q", () => {
    const q = quatFromAxisAngle(VEC3_Y, Math.PI / 4);
    expectQuatClose(mulQuat(QUAT_IDENTITY, q), q);
  });

  it("q * inverse(q) = identity", () => {
    const q = quatFromAxisAngle(VEC3_X, Math.PI / 3);
    expectQuatClose(mulQuat(q, quatInverse(q)), QUAT_IDENTITY);
  });

  it("quatFromAxisAngle 90 degrees around Y", () => {
    const q = quatFromAxisAngle(VEC3_Y, Math.PI / 2);
    const rotated = rotateVec3(q, VEC3_X);
    expectVec3Close(rotated, vec3(0, 0, -1));
  });

  it("quatFromAxisAngle 180 degrees around Z", () => {
    const q = quatFromAxisAngle(VEC3_Z, Math.PI);
    const rotated = rotateVec3(q, VEC3_X);
    expectVec3Close(rotated, vec3(-1, 0, 0));
  });

  it("rotateVec3 identity rotation", () => {
    expectVec3Close(rotateVec3(QUAT_IDENTITY, vec3(1, 2, 3)), vec3(1, 2, 3));
  });

  it("quatFromUnitVectors X->Y", () => {
    const q = quatFromUnitVectors(VEC3_X, VEC3_Y);
    expectVec3Close(rotateVec3(q, VEC3_X), VEC3_Y);
  });

  it("quatFromUnitVectors opposite directions", () => {
    const q = quatFromUnitVectors(VEC3_X, vec3(-1, 0, 0));
    const rotated = rotateVec3(q, VEC3_X);
    expectVec3Close(rotated, vec3(-1, 0, 0));
  });

  it("quatFromBasis standard basis", () => {
    const q = quatFromBasis(VEC3_X, VEC3_Y, VEC3_Z);
    expectQuatClose(q, QUAT_IDENTITY);
  });
});

describe("lookRotation", () => {
  it("forward = +Z returns identity-like rotation", () => {
    const q = lookRotation(VEC3_Z);
    const forward = rotateVec3(q, VEC3_Z);
    expectVec3Close(forward, VEC3_Z);
  });

  it("forward = +X rotates Z to X", () => {
    const q = lookRotation(VEC3_X);
    const forward = rotateVec3(q, VEC3_Z);
    expectVec3Close(forward, VEC3_X);
  });
});

describe("transform operations", () => {
  it("composeTransforms with identity", () => {
    const t = transform(vec3(1, 2, 3), QUAT_IDENTITY);
    const result = composeTransforms(TRANSFORM_IDENTITY, t);
    expectVec3Close(result.position, vec3(1, 2, 3));
  });

  it("compose then inverse yields identity", () => {
    const t = transform(vec3(1, 2, 3), quatFromAxisAngle(VEC3_Y, Math.PI / 4));
    const inv = inverseTransform(t);
    const result = composeTransforms(t, inv);
    expectVec3Close(result.position, VEC3_ZERO);
    expectQuatClose(result.rotation, QUAT_IDENTITY);
  });

  it("transformPoint applies translation and rotation", () => {
    const t = transform(vec3(10, 0, 0), QUAT_IDENTITY);
    expectVec3Close(transformPoint(t, vec3(1, 0, 0)), vec3(11, 0, 0));
  });

  it("transformDirection ignores translation", () => {
    const t = transform(vec3(10, 0, 0), QUAT_IDENTITY);
    expectVec3Close(transformDirection(t, vec3(1, 0, 0)), vec3(1, 0, 0));
  });

  it("relativeTransform recovers child local", () => {
    const parent = transform(vec3(5, 0, 0), QUAT_IDENTITY);
    const child = transform(vec3(8, 0, 0), QUAT_IDENTITY);
    const relative = relativeTransform(parent, child);
    expectVec3Close(relative.position, vec3(3, 0, 0));
  });
});

describe("projection and angles", () => {
  it("projectOnPlane removes normal component", () => {
    const result = projectOnPlane(vec3(1, 1, 0), VEC3_Y);
    expectVec3Close(result, vec3(1, 0, 0));
  });

  it("signedAngleAroundAxis 90 degrees", () => {
    const angle = signedAngleAroundAxis(VEC3_X, VEC3_Y, VEC3_Z);
    expect(angle).toBeCloseTo(Math.PI / 2, 4);
  });

  it("signedAngleAroundAxis returns 0 for zero vectors", () => {
    expect(signedAngleAroundAxis(VEC3_ZERO, VEC3_Y, VEC3_Z)).toBe(0);
  });

  it("quantizeAngle snaps to step", () => {
    const step = 45;
    const input = degToRad(50);
    const snapped = quantizeAngle(input, step);
    expect(radToDeg(snapped)).toBeCloseTo(45, 1);
  });

  it("quantizeAngle with no step returns unchanged", () => {
    const input = degToRad(33);
    expect(quantizeAngle(input)).toBe(input);
    expect(quantizeAngle(input, 0)).toBe(input);
  });
});

describe("averageVec3 / weightedAverageVec3", () => {
  it("average of empty returns zero", () => {
    expect(averageVec3([])).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("average of two points", () => {
    expectVec3Close(averageVec3([vec3(0, 0, 0), vec3(2, 4, 6)]), vec3(1, 2, 3));
  });

  it("weighted average", () => {
    const result = weightedAverageVec3([vec3(0, 0, 0), vec3(10, 0, 0)], [1, 3]);
    expectVec3Close(result, vec3(7.5, 0, 0));
  });

  it("weighted average with zero weights falls back to average", () => {
    const result = weightedAverageVec3([vec3(0, 0, 0), vec3(10, 0, 0)], [0, 0]);
    expectVec3Close(result, vec3(5, 0, 0));
  });

  it("weighted average empty returns zero", () => {
    expect(weightedAverageVec3([], [])).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("weighted average mismatched lengths returns zero", () => {
    expect(weightedAverageVec3([vec3(1, 0, 0)], [1, 2])).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("isFinite checks", () => {
  it("isFiniteVec3", () => {
    expect(isFiniteVec3(vec3(1, 2, 3))).toBe(true);
    expect(isFiniteVec3(vec3(NaN, 0, 0))).toBe(false);
    expect(isFiniteVec3(vec3(0, Infinity, 0))).toBe(false);
  });

  it("isFiniteQuat", () => {
    expect(isFiniteQuat(QUAT_IDENTITY)).toBe(true);
    expect(isFiniteQuat(quat(NaN, 0, 0, 1))).toBe(false);
  });
});

describe("axisNameToVector", () => {
  it("maps axis names", () => {
    expect(axisNameToVector("x")).toEqual(VEC3_X);
    expect(axisNameToVector("y")).toEqual(VEC3_Y);
    expect(axisNameToVector("z")).toEqual(VEC3_Z);
  });
});

describe("ensureAnchorOrientation", () => {
  it("returns normalized orientation when provided", () => {
    const q = quatFromAxisAngle(VEC3_Y, Math.PI / 4);
    const result = ensureAnchorOrientation(VEC3_Z, q);
    expectQuatClose(result, quatNormalize(q));
  });

  it("derives orientation from normal via lookRotation when not provided", () => {
    const result = ensureAnchorOrientation(VEC3_X);
    const forward = rotateVec3(result, VEC3_Z);
    expectVec3Close(forward, normalizeVec3(VEC3_X));
  });
});
