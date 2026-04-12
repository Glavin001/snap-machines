import {
  QUAT_IDENTITY,
  TRANSFORM_IDENTITY,
  Transform,
  VEC3_X,
  addVec3,
  clamp,
  composeTransforms,
  divVec3Scalar,
  mulVec3Scalar,
  quatFromAxisAngle,
  rotateVec3,
  transform,
  normalizeVec3,
} from "./math.js";
import { NormalizedBlockDefinition, NormalizedAnchorDefinition } from "./schema.js";

export function getBlockPreviewPartTransforms(
  definition: NormalizedBlockDefinition,
  requestedPosition = 0,
): Record<string, Transform> {
  const partTransforms = Object.fromEntries(
    definition.parts.map((part) => [part.id, TRANSFORM_IDENTITY] as const),
  );
  const joint = definition.joint;
  if (!joint) {
    return partTransforms;
  }

  const position = clampJointPreviewPosition(joint.limits, requestedPosition);
  if (Math.abs(position) < 1e-6) {
    return partTransforms;
  }

  const anchorA = definition.anchors.find((anchor) => anchor.id === joint.anchorA);
  const anchorB = definition.anchors.find((anchor) => anchor.id === joint.anchorB);
  if (!anchorA || !anchorB) {
    return partTransforms;
  }

  const axisLocalBlock = joint.axis ?? anchorAxisFromAnchor(anchorA);

  if (joint.kind === "revolute") {
    // Use the midpoint between joint anchors as the preview pivot.
    // Well-authored joint blocks place these anchors at the same position;
    // the midpoint keeps the preview stable if there is minor authoring drift.
    const pivot = divVec3Scalar(addVec3(anchorA.position, anchorB.position), 2);
    const rotateAroundPivot = composeTransforms(
      transform(pivot, quatFromAxisAngle(axisLocalBlock, position)),
      transform(mulVec3Scalar(pivot, -1), QUAT_IDENTITY),
    );
    partTransforms[joint.partB] = rotateAroundPivot;
    return partTransforms;
  }

  if (joint.kind === "prismatic") {
    partTransforms[joint.partB] = transform(mulVec3Scalar(axisLocalBlock, position), QUAT_IDENTITY);
  }

  return partTransforms;
}

export function getBlockPreviewAnchorWorldTransform(
  definition: NormalizedBlockDefinition,
  blockTransform: Transform,
  anchorId: string,
  requestedPosition = 0,
): Transform {
  const anchor = definition.anchors.find((entry) => entry.id === anchorId);
  if (!anchor) {
    throw new Error(`Unknown anchor '${anchorId}' on block '${definition.id}'.`);
  }

  const partTransforms = getBlockPreviewPartTransforms(definition, requestedPosition);
  const partTransform = partTransforms[anchor.partId] ?? TRANSFORM_IDENTITY;
  const localAnchor = {
    position: anchor.position,
    rotation: anchor.orientation,
  };
  return composeTransforms(blockTransform, composeTransforms(partTransform, localAnchor));
}

export function getBlockPreviewJointIndicator(
  definition: NormalizedBlockDefinition,
  blockTransform: Transform,
  requestedPosition = 0,
): { position: Transform["position"]; axis: ReturnType<typeof normalizeVec3> } | null {
  const joint = definition.joint;
  if (!joint) {
    return null;
  }

  const anchorA = definition.anchors.find((entry) => entry.id === joint.anchorA);
  const anchorB = definition.anchors.find((entry) => entry.id === joint.anchorB);
  if (!anchorA || !anchorB) {
    return null;
  }

  const anchorAWorld = getBlockPreviewAnchorWorldTransform(definition, blockTransform, anchorA.id, requestedPosition);
  const anchorBWorld = getBlockPreviewAnchorWorldTransform(definition, blockTransform, anchorB.id, requestedPosition);
  const axisLocalBlock = joint.axis ?? anchorAxisFromAnchor(anchorA);

  return {
    position: divVec3Scalar(addVec3(anchorAWorld.position, anchorBWorld.position), 2),
    axis: normalizeVec3(rotateVec3(blockTransform.rotation, axisLocalBlock)),
  };
}

function clampJointPreviewPosition(
  limits: { min: number; max: number } | undefined,
  requestedPosition: number,
): number {
  if (!limits) {
    return requestedPosition;
  }
  return clamp(requestedPosition, limits.min, limits.max);
}

function anchorAxisFromAnchor(anchor: NormalizedAnchorDefinition) {
  return rotateVec3(anchor.orientation, VEC3_X);
}
