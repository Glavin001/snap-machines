import { describe, expect, it } from "vitest";
import { BlockCatalog, BlockDefinition } from "../schema.js";
import { QUAT_IDENTITY, TRANSFORM_IDENTITY, almostEqual, composeTransforms, quatFromAxisAngle, rotateVec3, transform, vec3 } from "../math.js";
import { getBlockPreviewAnchorWorldTransform, getBlockPreviewJointIndicator, getBlockPreviewPartTransforms } from "../preview.js";

function previewHingeBlock(): BlockDefinition {
  return {
    id: "preview-hinge",
    name: "Preview Hinge",
    parts: [
      { id: "base", mass: 1 },
      { id: "rotor", mass: 1 },
    ],
    geometry: [
      { kind: "box", partId: "base", size: vec3(1, 1, 1), transform: transform(vec3(-0.5, 0, 0), QUAT_IDENTITY) },
      { kind: "box", partId: "rotor", size: vec3(2, 0.4, 0.4), transform: transform(vec3(1, 0, 0), QUAT_IDENTITY) },
    ],
    colliders: [
      { kind: "box", partId: "base", halfExtents: vec3(0.5, 0.5, 0.5), transform: transform(vec3(-0.5, 0, 0), QUAT_IDENTITY) },
      { kind: "box", partId: "rotor", halfExtents: vec3(1, 0.2, 0.2), transform: transform(vec3(1, 0, 0), QUAT_IDENTITY) },
    ],
    anchors: [
      { id: "base.mount", partId: "base", position: vec3(-1, 0, 0), normal: vec3(-1, 0, 0), type: "struct" },
      { id: "base.joint", partId: "base", position: vec3(0, 0, 0), normal: vec3(1, 0, 0), type: "joint", polarity: "positive" },
      { id: "rotor.joint", partId: "rotor", position: vec3(0, 0, 0), normal: vec3(-1, 0, 0), type: "joint", polarity: "negative" },
      { id: "rotor.tip", partId: "rotor", position: vec3(2, 0, 0), normal: vec3(1, 0, 0), type: "struct" },
    ],
    joint: {
      kind: "revolute",
      partA: "base",
      partB: "rotor",
      anchorA: "base.joint",
      anchorB: "rotor.joint",
      axis: vec3(0, 0, 1),
      limits: { min: -Math.PI / 4, max: Math.PI / 4 },
      motor: {
        mode: "position",
        targetPosition: 0,
        stiffness: 100,
        damping: 10,
        inputTarget: "position",
      },
    },
  };
}

describe("getBlockPreviewPartTransforms", () => {
  it("returns identity transforms for non-joint blocks or zero pose", () => {
    const catalog = new BlockCatalog();
    catalog.register({
      id: "cube",
      name: "Cube",
      colliders: [{ kind: "box", halfExtents: vec3(0.5, 0.5, 0.5) }],
      anchors: [{ id: "xp", position: vec3(0.5, 0, 0), normal: vec3(1, 0, 0), type: "struct" }],
    });
    catalog.register(previewHingeBlock());

    const cube = catalog.get("cube");
    const hinge = catalog.get("preview-hinge");

    expect(getBlockPreviewPartTransforms(cube, Math.PI / 4).main).toEqual(TRANSFORM_IDENTITY);
    expect(getBlockPreviewPartTransforms(hinge, 0).rotor).toEqual(TRANSFORM_IDENTITY);
  });

  it("rotates the moving joint part around the joint axis", () => {
    const catalog = new BlockCatalog();
    catalog.register(previewHingeBlock());
    const hinge = catalog.get("preview-hinge");

    const partTransforms = getBlockPreviewPartTransforms(hinge, Math.PI / 4);
    const rotorPose = partTransforms.rotor!;
    const expected = quatFromAxisAngle(vec3(0, 0, 1), Math.PI / 4);

    expect(rotorPose.position.x).toBeCloseTo(0);
    expect(rotorPose.position.y).toBeCloseTo(0);
    expect(rotorPose.position.z).toBeCloseTo(0);
    expect(rotorPose.rotation.x).toBeCloseTo(expected.x);
    expect(rotorPose.rotation.y).toBeCloseTo(expected.y);
    expect(rotorPose.rotation.z).toBeCloseTo(expected.z);
    expect(rotorPose.rotation.w).toBeCloseTo(expected.w);
  });

  it("clamps the preview pose to joint limits", () => {
    const catalog = new BlockCatalog();
    catalog.register(previewHingeBlock());
    const hinge = catalog.get("preview-hinge");

    const partTransforms = getBlockPreviewPartTransforms(hinge, Math.PI / 2);
    const rotorPose = partTransforms.rotor!;
    const expected = quatFromAxisAngle(vec3(0, 0, 1), Math.PI / 4);

    expect(rotorPose.rotation.z).toBeCloseTo(expected.z);
    expect(rotorPose.rotation.w).toBeCloseTo(expected.w);
  });
});

describe("getBlockPreviewAnchorWorldTransform", () => {
  it("moves anchors on the rotating part with the previewed joint pose", () => {
    const catalog = new BlockCatalog();
    catalog.register(previewHingeBlock());
    const hinge = catalog.get("preview-hinge");

    const worldAnchor = getBlockPreviewAnchorWorldTransform(
      hinge,
      TRANSFORM_IDENTITY,
      "rotor.tip",
      Math.PI / 4,
    );

    const expectedTip = rotateVec3(quatFromAxisAngle(vec3(0, 0, 1), Math.PI / 4), vec3(2, 0, 0));
    expect(worldAnchor.position.x).toBeCloseTo(expectedTip.x);
    expect(worldAnchor.position.y).toBeCloseTo(expectedTip.y);
    expect(worldAnchor.position.z).toBeCloseTo(expectedTip.z);
  });

  it("includes the parent block transform", () => {
    const catalog = new BlockCatalog();
    catalog.register(previewHingeBlock());
    const hinge = catalog.get("preview-hinge");
    const blockTransform = transform(vec3(5, 1, -2), quatFromAxisAngle(vec3(0, 1, 0), Math.PI / 2));

    const worldAnchor = getBlockPreviewAnchorWorldTransform(
      hinge,
      blockTransform,
      "rotor.tip",
      Math.PI / 4,
    );

    const localAnchor = getBlockPreviewAnchorWorldTransform(hinge, TRANSFORM_IDENTITY, "rotor.tip", Math.PI / 4);
    const expected = composeTransforms(blockTransform, localAnchor);

    expect(almostEqual(worldAnchor.position.x, expected.position.x)).toBe(true);
    expect(almostEqual(worldAnchor.position.y, expected.position.y)).toBe(true);
    expect(almostEqual(worldAnchor.position.z, expected.position.z)).toBe(true);
  });
});

describe("getBlockPreviewJointIndicator", () => {
  it("returns the joint pivot and world axis for a joint block", () => {
    const catalog = new BlockCatalog();
    catalog.register(previewHingeBlock());
    const hinge = catalog.get("preview-hinge");

    const indicator = getBlockPreviewJointIndicator(
      hinge,
      transform(vec3(5, 1, -2), quatFromAxisAngle(vec3(0, 1, 0), Math.PI / 2)),
      Math.PI / 4,
    );

    expect(indicator).not.toBeNull();
    expect(indicator!.position.x).toBeCloseTo(5);
    expect(indicator!.position.y).toBeCloseTo(1);
    expect(indicator!.position.z).toBeCloseTo(-2);
    expect(indicator!.axis.x).toBeCloseTo(1);
    expect(indicator!.axis.y).toBeCloseTo(0);
    expect(indicator!.axis.z).toBeCloseTo(0);
  });

  it("returns null for non-joint blocks", () => {
    const catalog = new BlockCatalog();
    catalog.register({
      id: "cube",
      name: "Cube",
      colliders: [{ kind: "box", halfExtents: vec3(0.5, 0.5, 0.5) }],
      anchors: [{ id: "xp", position: vec3(0.5, 0, 0), normal: vec3(1, 0, 0), type: "struct" }],
    });
    const cube = catalog.get("cube");

    expect(getBlockPreviewJointIndicator(cube, TRANSFORM_IDENTITY, 0)).toBeNull();
  });
});
