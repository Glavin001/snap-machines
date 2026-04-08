import { AnchorRef, BlockGraph } from "./graph.js";
import {
  BlockCatalog,
  NormalizedAnchorDefinition,
  NormalizedBlockDefinition,
  structuralPolarityMatch,
} from "./schema.js";
import {
  QUAT_IDENTITY,
  VEC3_Y,
  VEC3_Z,
  Vec3,
  Quat,
  Transform,
  addVec3,
  clamp,
  composeTransforms,
  degToRad,
  distanceVec3,
  dotVec3,
  ensureAnchorOrientation,
  inverseTransform,
  mulQuat,
  normalizeVec3,
  quantizeAngle,
  quatFromAxisAngle,
  radToDeg,
  relativeTransform,
  rotateVec3,
  signedAngleAroundAxis,
  subVec3,
  transformDirection,
  transformPoint,
  transform,
  vec3,
} from "./math.js";

export interface RaycastHit {
  blockId: string;
  point: Vec3;
  normal?: Vec3;
  distance?: number;
}

export interface SnapOcclusionQuery {
  isSphereBlocked(args: {
    center: Vec3;
    radius: number;
    ignoreBlockIds: string[];
    candidatePlacement: Transform;
  }): boolean;
}

export interface SnapRules {
  searchDistance: number;
  maxAngleDeg: number;
  useTypes: boolean;
  usePolarity: boolean;
  snapOpenOnly: boolean;
  openCheckRadius: number;
  hitDistanceWeight: number;
  angleWeight: number;
  travelWeight: number;
  requireTargetAnchorFree: boolean;
}

export interface SnapQuery {
  graph: BlockGraph;
  catalog: BlockCatalog;
  candidateTypeId: string;
  hit: RaycastHit;
  previewTransform?: Transform;
  rules?: Partial<SnapRules>;
  occlusion?: SnapOcclusionQuery;
}

export interface ResolvedAnchor {
  blockId: string;
  blockTypeId: string;
  block: NormalizedBlockDefinition;
  anchor: NormalizedAnchorDefinition;
  localTransform: Transform;
  worldTransform: Transform;
  worldNormal: Vec3;
}

export interface SnapCandidate {
  score: number;
  hitDistance: number;
  angleErrorDeg: number;
  travelDistance: number;
  placement: Transform;
  target: ResolvedAnchor;
  sourceAnchor: NormalizedAnchorDefinition;
}

export interface SnapResult extends SnapCandidate {
  connection: {
    a: AnchorRef;
    b: AnchorRef;
  };
}

const DEFAULT_SNAP_RULES: SnapRules = {
  searchDistance: 1.2,
  maxAngleDeg: 75,
  useTypes: true,
  usePolarity: true,
  snapOpenOnly: false,
  openCheckRadius: 0.05,
  hitDistanceWeight: 1.0,
  angleWeight: 0.15,
  travelWeight: 0.1,
  requireTargetAnchorFree: true,
};

const SOCKET_MATE_FLIP = quatFromAxisAngle(VEC3_Y, Math.PI);

export function resolveSnapRules(input?: Partial<SnapRules>): SnapRules {
  return { ...DEFAULT_SNAP_RULES, ...(input ?? {}) };
}

export function getAnchorLocalTransform(anchor: NormalizedAnchorDefinition): Transform {
  return {
    position: anchor.position,
    rotation: ensureAnchorOrientation(anchor.normal, anchor.orientation),
  };
}

export function getWorldAnchorTransform(blockTransform: Transform, anchor: NormalizedAnchorDefinition): Transform {
  return composeTransforms(blockTransform, getAnchorLocalTransform(anchor));
}

export function anchorsAreCompatible(
  source: NormalizedAnchorDefinition,
  target: NormalizedAnchorDefinition,
  rules: SnapRules,
): boolean {
  if (rules.useTypes && source.type.toLowerCase() !== target.type.toLowerCase()) {
    return false;
  }
  if (rules.usePolarity && !structuralPolarityMatch(source.polarity, target.polarity)) {
    return false;
  }
  return true;
}

export function alignAnchorPair(
  targetAnchorWorld: Transform,
  sourceAnchor: NormalizedAnchorDefinition,
  previewTransform?: Transform,
  rotationSnapStepDeg?: number,
): Transform {
  const desiredAnchorWorldRotationBase = mulQuat(targetAnchorWorld.rotation, SOCKET_MATE_FLIP);
  const preview = previewTransform ?? transform(targetAnchorWorld.position, QUAT_IDENTITY);

  const sourceLocal = getAnchorLocalTransform(sourceAnchor);
  const sourcePreviewWorld = composeTransforms(preview, sourceLocal);
  const currentUp = rotateVec3(sourcePreviewWorld.rotation, VEC3_Y);
  const desiredUp = rotateVec3(desiredAnchorWorldRotationBase, VEC3_Y);
  const axis = rotateVec3(targetAnchorWorld.rotation, VEC3_Z);
  const rawTwist = signedAngleAroundAxis(desiredUp, currentUp, axis);
  const twist = quantizeAngle(rawTwist, rotationSnapStepDeg);
  const desiredAnchorWorldRotation = mulQuat(
    mulQuat(targetAnchorWorld.rotation, quatFromAxisAngle(VEC3_Z, twist)),
    SOCKET_MATE_FLIP,
  );

  const sourceAnchorInv = inverseTransform({
    position: sourceAnchor.position,
    rotation: ensureAnchorOrientation(sourceAnchor.normal, sourceAnchor.orientation),
  });

  return composeTransforms(
    {
      position: targetAnchorWorld.position,
      rotation: desiredAnchorWorldRotation,
    },
    sourceAnchorInv,
  );
}

export function findSnapCandidates(query: SnapQuery): SnapCandidate[] {
  const rules = resolveSnapRules(query.rules);
  const catalog = query.catalog;
  const graph = query.graph;
  const hitNode = graph.getNode(query.hit.blockId);
  if (!hitNode) {
    return [];
  }

  const targetBlock = catalog.get(hitNode.typeId);
  const candidateBlock = catalog.get(query.candidateTypeId);
  const preview = query.previewTransform ?? transform(query.hit.point, QUAT_IDENTITY);

  const candidates: SnapCandidate[] = [];

  for (const targetAnchor of targetBlock.anchors) {
    const targetRef: AnchorRef = { blockId: hitNode.id, anchorId: targetAnchor.id };
    if (rules.requireTargetAnchorFree && graph.isAnchorOccupied(targetRef)) {
      continue;
    }

    const targetWorldTransform = getWorldAnchorTransform(hitNode.transform, targetAnchor);
    const hitDistance = distanceVec3(query.hit.point, targetWorldTransform.position);
    const distanceThreshold = Math.min(
      rules.searchDistance,
      targetAnchor.distanceThreshold ?? rules.searchDistance,
    );

    if (hitDistance > distanceThreshold) {
      continue;
    }

    const worldTargetNormal = normalizeVec3(rotateVec3(targetWorldTransform.rotation, VEC3_Z));

    for (const sourceAnchor of candidateBlock.anchors) {
      if (!anchorsAreCompatible(sourceAnchor, targetAnchor, rules)) {
        continue;
      }

      const placement = alignAnchorPair(
        targetWorldTransform,
        sourceAnchor,
        preview,
        sourceAnchor.rotationSnapStepDeg ?? targetAnchor.rotationSnapStepDeg,
      );

      const sourceWorld = composeTransforms(placement, getAnchorLocalTransform(sourceAnchor));
      const worldSourceNormal = normalizeVec3(rotateVec3(sourceWorld.rotation, VEC3_Z));
      const angleError = radToDeg(Math.acos(clamp(dotVec3(worldSourceNormal, { x: -worldTargetNormal.x, y: -worldTargetNormal.y, z: -worldTargetNormal.z }), -1, 1)));
      const angleTolerance = Math.min(
        rules.maxAngleDeg,
        sourceAnchor.angleToleranceDeg ?? rules.maxAngleDeg,
        targetAnchor.angleToleranceDeg ?? rules.maxAngleDeg,
      );
      if (angleError > angleTolerance) {
        continue;
      }

      if (rules.snapOpenOnly && query.occlusion) {
        const sourceRadius = sourceAnchor.openCheckRadius ?? rules.openCheckRadius;
        const targetRadius = targetAnchor.openCheckRadius ?? rules.openCheckRadius;
        const sourceBlockIds: string[] = [query.hit.blockId];
        const targetBlocked = query.occlusion.isSphereBlocked({
          center: addVec3(sourceWorld.position, mulNormal(worldSourceNormal, sourceRadius)),
          radius: sourceRadius,
          ignoreBlockIds: sourceBlockIds,
          candidatePlacement: placement,
        });
        if (targetBlocked) {
          continue;
        }

        const targetBlockedByExisting = query.occlusion.isSphereBlocked({
          center: addVec3(targetWorldTransform.position, mulNormal(worldTargetNormal, targetRadius)),
          radius: targetRadius,
          ignoreBlockIds: [query.hit.blockId],
          candidatePlacement: placement,
        });
        if (targetBlockedByExisting) {
          continue;
        }
      }

      const travelDistance = distanceVec3(preview.position, placement.position);
      const score =
        hitDistance * rules.hitDistanceWeight + angleError * rules.angleWeight + travelDistance * rules.travelWeight;

      candidates.push({
        score,
        hitDistance,
        angleErrorDeg: angleError,
        travelDistance,
        placement,
        target: {
          blockId: hitNode.id,
          blockTypeId: targetBlock.id,
          block: targetBlock,
          anchor: targetAnchor,
          localTransform: getAnchorLocalTransform(targetAnchor),
          worldTransform: targetWorldTransform,
          worldNormal: worldTargetNormal,
        },
        sourceAnchor,
      });
    }
  }

  return candidates.sort((a, b) => a.score - b.score);
}

export function findBestSnap(query: SnapQuery): SnapResult | null {
  const best = findSnapCandidates(query)[0];
  if (!best) {
    return null;
  }

  return {
    ...best,
    connection: {
      a: { blockId: query.hit.blockId, anchorId: best.target.anchor.id },
      b: { blockId: "__candidate__", anchorId: best.sourceAnchor.id },
    },
  };
}

export function addSnappedBlockToGraph(args: {
  graph: BlockGraph;
  nodeId?: string;
  typeId: string;
  snap: SnapResult;
  metadata?: Record<string, unknown>;
}): { nodeId: string; connectionId: string } {
  const node = args.graph.addNode({
    id: args.nodeId,
    typeId: args.typeId,
    transform: args.snap.placement,
    metadata: args.metadata,
  });
  const connection = args.graph.addConnection({
    a: { blockId: args.snap.target.blockId, anchorId: args.snap.target.anchor.id },
    b: { blockId: node.id, anchorId: args.snap.sourceAnchor.id },
  });
  return { nodeId: node.id, connectionId: connection.id };
}

export function remapSnapResultForPlacedNode(snap: SnapResult, nodeId: string): SnapResult {
  return {
    ...snap,
    connection: {
      a: { ...snap.connection.a },
      b: { blockId: nodeId, anchorId: snap.connection.b.anchorId },
    },
  };
}

export function measureAnchorAngleDeg(
  worldAnchorA: Transform,
  anchorA: NormalizedAnchorDefinition,
  worldAnchorB: Transform,
  anchorB: NormalizedAnchorDefinition,
): number {
  const worldNormalA = normalizeVec3(rotateVec3(worldAnchorA.rotation, VEC3_Z));
  const worldNormalB = normalizeVec3(rotateVec3(worldAnchorB.rotation, VEC3_Z));
  return radToDeg(
    Math.acos(clamp(dotVec3(worldNormalA, { x: -worldNormalB.x, y: -worldNormalB.y, z: -worldNormalB.z }), -1, 1)),
  );
}

export function getAnchorWorldPoseForNode(
  graph: BlockGraph,
  catalog: BlockCatalog,
  anchor: AnchorRef,
): Transform {
  const node = graph.getNode(anchor.blockId);
  if (!node) {
    throw new Error(`Unknown block '${anchor.blockId}'.`);
  }
  const block = catalog.get(node.typeId);
  const anchorDef = block.anchors.find((entry) => entry.id === anchor.anchorId);
  if (!anchorDef) {
    throw new Error(`Unknown anchor '${anchor.anchorId}' on block '${anchor.blockId}'.`);
  }
  return getWorldAnchorTransform(node.transform, anchorDef);
}

function mulNormal(v: Vec3, scalar: number): Vec3 {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}
