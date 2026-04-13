import { useRef, useState, useCallback, useEffect, useMemo, type RefObject } from "react";
import { ThreeEvent, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  BlockCatalog,
  BlockGraph,
  ControlMap,
  getAnchorLocalTransform,
  composeTransforms,
  SnapResult,
  addSnappedBlockToGraph,
  findSnapCandidates,
  getBlockPreviewAnchorWorldTransform,
  getBlockPreviewJointIndicator,
  getWorldAnchorTransform,
  transform,
  Transform,
} from "@snap-machines/core";
import { BlockMesh } from "./BlockMesh.js";
import { GhostPreview } from "./GhostPreview.js";

export type SnapSceneToolMode = "place" | "select" | "move" | "rotate";
export type SnapScenePlacementMode = "manual" | "auto_orient";

export interface SnapSceneProps {
  graph: BlockGraph;
  catalog: BlockCatalog;
  selectedType: string;
  selectedNodeId?: string | null;
  selectedNodeIds?: string[];
  toolMode?: SnapSceneToolMode;
  placementMode?: SnapScenePlacementMode;
  activeSourceAnchorId?: string | null;
  activeSnapCandidateIndex?: number;
  previewRotation?: { x: number; y: number; z: number };
  previewJointAnglesByNodeId?: Record<string, number>;
  controlMap?: ControlMap;
  keysDownRef?: RefObject<Set<string>>;
  highlightBlockId?: string | null;
  highlightJointId?: string | null;
  colorMap?: Record<string, string>;
  onGraphChange?: (graph: BlockGraph) => void;
  onSelectionChange?: (nodeId: string | null, options?: { toggle?: boolean }) => void;
  onSnapChange?: (snap: SnapResult | null) => void;
  onSnapCandidateCountChange?: (count: number) => void;
  onActiveSourceAnchorChange?: (anchorId: string | null) => void;
  onBlockPlaced?: () => void;
  onBlockRemoved?: () => void;
}

interface HitInfo {
  blockId: string;
  point: { x: number; y: number; z: number };
}

const ANCHOR_COLORS = {
  compatible: "#7cff88",
  free: "#63c7ff",
  occupied: "#ff7a7a",
  selected: "#ffd166",
} as const;

export function SnapScene({
  graph,
  catalog,
  selectedType,
  selectedNodeId,
  selectedNodeIds = [],
  toolMode = "place",
  placementMode = "manual",
  activeSourceAnchorId = null,
  activeSnapCandidateIndex = 0,
  previewRotation = { x: 0, y: 0, z: 0 },
  previewJointAnglesByNodeId,
  controlMap,
  keysDownRef,
  highlightBlockId,
  highlightJointId,
  colorMap,
  onGraphChange,
  onSelectionChange,
  onSnapChange,
  onSnapCandidateCountChange,
  onActiveSourceAnchorChange,
  onBlockPlaced,
  onBlockRemoved,
}: SnapSceneProps) {
  const blocks = useMemo(
    () => graph.listNodes().map((n) => ({ nodeId: n.id, typeId: n.typeId, transform: n.transform })),
    [graph],
  );

  const ghostGroupRef = useRef<THREE.Group>(null);
  const snapTransformRef = useRef<Transform | null>(null);
  const lastHitRef = useRef<HitInfo | null>(null);
  const axisIndicatorRef = useRef<THREE.Group>(null);
  const axisIndicatorOrbitRef = useRef<THREE.Group>(null);
  const axisIndicatorPhaseRef = useRef(0);

  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [activeSnap, setActiveSnap] = useState<SnapResult | null>(null);
  const highlightedJointEntry = useMemo(
    () => highlightJointId ? controlMap?.find((entry) => entry.id === highlightJointId) ?? null : null,
    [controlMap, highlightJointId],
  );
  const highlightedJointIndicator = useMemo(() => {
    if (!highlightedJointEntry || !highlightedJointEntry.id.startsWith("joint:")) {
      return null;
    }
    const node = graph.getNode(highlightedJointEntry.blockId);
    if (!node) {
      return null;
    }
    const definition = catalog.get(node.typeId);
    return getBlockPreviewJointIndicator(
      definition,
      node.transform,
      previewJointAnglesByNodeId?.[node.id] ?? 0,
    );
  }, [catalog, graph, highlightedJointEntry, previewJointAnglesByNodeId]);

  useFrame((_state, delta) => {
    const group = ghostGroupRef.current;
    if (!group) return;
    const t = snapTransformRef.current;
    if (toolMode === "place" && t) {
      group.position.set(t.position.x, t.position.y, t.position.z);
      group.quaternion.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
      group.visible = true;
    } else {
      group.visible = false;
    }

    const indicator = axisIndicatorRef.current;
    if (indicator) {
      if (highlightedJointIndicator && highlightedJointEntry) {
        indicator.visible = true;
        indicator.position.set(
          highlightedJointIndicator.position.x,
          highlightedJointIndicator.position.y,
          highlightedJointIndicator.position.z,
        );
        const worldAxis = new THREE.Vector3(
          highlightedJointIndicator.axis.x,
          highlightedJointIndicator.axis.y,
          highlightedJointIndicator.axis.z,
        ).normalize();
        const ringNormal = new THREE.Vector3(0, 0, 1);
        indicator.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(ringNormal, worldAxis));

        const orbit = axisIndicatorOrbitRef.current;
        if (orbit) {
          let direction = highlightedJointEntry.scale < 0 ? -1 : 1;
          if (keysDownRef?.current) {
            const posDown = highlightedJointEntry.positiveKey !== "" && keysDownRef.current.has(highlightedJointEntry.positiveKey);
            const negDown = highlightedJointEntry.negativeKey !== "" && keysDownRef.current.has(highlightedJointEntry.negativeKey);
            const keyDirection = (posDown ? 1 : 0) - (negDown ? 1 : 0);
            if (keyDirection !== 0) {
              direction = Math.sign(keyDirection * highlightedJointEntry.scale) || direction;
            }
          }
          axisIndicatorPhaseRef.current += delta * 2.8 * direction;
          orbit.rotation.z = axisIndicatorPhaseRef.current;
        }
      } else {
        indicator.visible = false;
      }
    }
  });

  const computeSnap = useCallback(
    (hits: HitInfo[]) => {
      const primaryHit = hits[0] ?? null;
      setHoveredBlockId(primaryHit?.blockId ?? null);

      if (toolMode !== "place") {
        snapTransformRef.current = null;
        setActiveSnap(null);
        onSnapChange?.(null);
        return null;
      }

      if (hits.length === 0) {
        snapTransformRef.current = null;
        setActiveSnap(null);
        onSnapCandidateCountChange?.(0);
        onSnapChange?.(null);
        return null;
      }

      const previewQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          THREE.MathUtils.degToRad(previewRotation.x),
          THREE.MathUtils.degToRad(previewRotation.y),
          THREE.MathUtils.degToRad(previewRotation.z),
          "XYZ",
        ),
      );
      const preview = transform(primaryHit.point, {
        x: previewQuat.x,
        y: previewQuat.y,
        z: previewQuat.z,
        w: previewQuat.w,
      });
      const candidates = hits.flatMap((hit) => findSnapCandidates({
        graph,
        catalog,
        candidateTypeId: selectedType,
        hit: { blockId: hit.blockId, point: hit.point },
        previewTransform: preview,
      }));
      candidates.sort((a, b) => a.score - b.score);
      const filteredCandidates = placementMode === "manual" && activeSourceAnchorId
        ? candidates.filter((candidate) => candidate.sourceAnchor.id === activeSourceAnchorId)
        : candidates;
      onSnapCandidateCountChange?.(filteredCandidates.length);
      const best = filteredCandidates.length > 0
        ? filteredCandidates[((activeSnapCandidateIndex % filteredCandidates.length) + filteredCandidates.length) % filteredCandidates.length]!
        : null;
      const snap = best
        ? {
            ...best,
            connection: {
              a: { blockId: best.target.blockId, anchorId: best.target.anchor.id },
              b: { blockId: "__candidate__", anchorId: best.sourceAnchor.id },
            },
          }
        : null;
      if (placementMode === "manual" && !activeSourceAnchorId && snap) {
        onActiveSourceAnchorChange?.(snap.sourceAnchor.id);
      }
      snapTransformRef.current = snap ? snap.placement : null;
      setActiveSnap(snap);
      onSnapChange?.(snap);
      return snap ?? null;
    },
    [activeSourceAnchorId, activeSnapCandidateIndex, catalog, graph, onActiveSourceAnchorChange, onSnapCandidateCountChange, onSnapChange, placementMode, previewRotation, selectedType, toolMode],
  );

  useEffect(() => {
    if (toolMode === "place" && lastHitRef.current) {
      computeSnap([lastHitRef.current]);
      return;
    }
    snapTransformRef.current = null;
    setActiveSnap(null);
    onSnapCandidateCountChange?.(0);
    onSnapChange?.(null);
  }, [computeSnap, onSnapCandidateCountChange, onSnapChange, placementMode, toolMode]);

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const hits = extractHits(e);
      if (hits.length === 0) return;
      lastHitRef.current = hits[0] ?? null;
      computeSnap(hits);
    },
    [computeSnap],
  );

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const blockId = findBlockId(e.object);
      if (!blockId) return;

      if (toolMode !== "place") {
        onSelectionChange?.(blockId, { toggle: e.nativeEvent.shiftKey });
        return;
      }

      const hits = extractHits(e);
      const snap = computeSnap(hits);
      if (!snap) return;

      const nextGraph = graph.clone();
      const { nodeId } = addSnappedBlockToGraph({
        graph: nextGraph,
        typeId: selectedType,
        snap,
      });

      onGraphChange?.(nextGraph);
      onSelectionChange?.(nodeId);
      onBlockPlaced?.();
      onActiveSourceAnchorChange?.(null);
    },
    [computeSnap, graph, onActiveSourceAnchorChange, onBlockPlaced, onGraphChange, onSelectionChange, selectedType, toolMode],
  );

  const handlePointerLeave = useCallback(() => {
    lastHitRef.current = null;
    setHoveredBlockId(null);
    snapTransformRef.current = null;
    setActiveSnap(null);
    onSnapCandidateCountChange?.(0);
    onSnapChange?.(null);
  }, [onSnapCandidateCountChange, onSnapChange]);

  const handleContextMenu = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      e.nativeEvent.preventDefault();

      const blockId = findBlockId(e.object);
      if (!blockId || blockId === "origin") return;

      const nextGraph = graph.clone();
      nextGraph.removeNode(blockId);
      onGraphChange?.(nextGraph);
      const nextSelectedIds = selectedNodeIds.filter((id) => id !== blockId);
      onSelectionChange?.(nextSelectedIds[0] ?? null);

      lastHitRef.current = null;
      setHoveredBlockId(null);
      snapTransformRef.current = null;
      setActiveSnap(null);
      onSnapCandidateCountChange?.(0);
      onSnapChange?.(null);

      onBlockRemoved?.();
    },
    [graph, onBlockRemoved, onGraphChange, onSelectionChange, onSnapCandidateCountChange, onSnapChange, selectedNodeIds],
  );

  return (
    <group
      onPointerMove={handlePointerMove}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onPointerLeave={handlePointerLeave}
    >
      {blocks.map((block) => (
        <BlockMesh
          key={block.nodeId}
          nodeId={block.nodeId}
          typeId={block.typeId}
          blockTransform={block.transform}
          catalog={catalog}
          colorMap={colorMap}
          highlight={
            selectedNodeIds.includes(block.nodeId) ||
            block.nodeId === hoveredBlockId ||
            block.nodeId === highlightBlockId
          }
          previewJointAngleRad={previewJointAnglesByNodeId?.[block.nodeId]}
        />
      ))}

      {selectedNodeIds.map((nodeId) => (
        <AnchorMarkers
          key={`selected-anchor:${nodeId}`}
          graph={graph}
          catalog={catalog}
          nodeId={nodeId}
          previewJointAngleRad={previewJointAnglesByNodeId?.[nodeId]}
          getColor={(anchorId, occupied) => {
            if (activeSnap?.target.blockId === nodeId && activeSnap.target.anchor.id === anchorId) {
              return ANCHOR_COLORS.compatible;
            }
            return occupied ? ANCHOR_COLORS.occupied : ANCHOR_COLORS.selected;
          }}
        />
      ))}

      {toolMode === "place" && hoveredBlockId && hoveredBlockId !== selectedNodeId && (
        <AnchorMarkers
          graph={graph}
          catalog={catalog}
          nodeId={hoveredBlockId}
          previewJointAngleRad={previewJointAnglesByNodeId?.[hoveredBlockId]}
          getColor={(anchorId, occupied) => {
            if (activeSnap?.target.blockId === hoveredBlockId && activeSnap.target.anchor.id === anchorId) {
              return ANCHOR_COLORS.compatible;
            }
            return occupied ? ANCHOR_COLORS.occupied : ANCHOR_COLORS.free;
          }}
        />
      )}

      <GhostPreview
        ref={ghostGroupRef}
        typeId={selectedType}
        catalog={catalog}
      />
      {activeSnap && (
        <GhostAnchorMarkers
          catalog={catalog}
          typeId={selectedType}
          placement={activeSnap.placement}
          activeSourceAnchorId={activeSnap.sourceAnchor.id}
        />
      )}

      <group ref={axisIndicatorRef} visible={false}>
        <mesh>
          <torusGeometry args={[0.95, 0.075, 18, 72]} />
          <meshStandardMaterial
            color="#33f0ff"
            emissive="#33f0ff"
            emissiveIntensity={2.1}
            transparent
            opacity={0.96}
            depthWrite={false}
          />
        </mesh>
        <group ref={axisIndicatorOrbitRef}>
          <mesh position={[0.95, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.14, 0.34, 12]} />
            <meshStandardMaterial
              color="#33f0ff"
              emissive="#33f0ff"
              emissiveIntensity={2.4}
              transparent
              opacity={1}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[0.62, 0, 0]}>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#7df9ff"
              emissiveIntensity={1.2}
              transparent
              opacity={0.9}
              depthWrite={false}
            />
          </mesh>
        </group>
      </group>
    </group>
  );
}

interface AnchorMarkersProps {
  graph: BlockGraph;
  catalog: BlockCatalog;
  nodeId: string;
  previewJointAngleRad?: number;
  getColor: (anchorId: string, occupied: boolean) => string;
}

function AnchorMarkers({ graph, catalog, nodeId, previewJointAngleRad, getColor }: AnchorMarkersProps) {
  const node = graph.getNode(nodeId);
  const block = node ? catalog.get(node.typeId) : null;

  if (!node || !block) {
    return null;
  }

  return (
    <group>
      {block.anchors.map((anchor) => {
        const world = previewJointAngleRad !== undefined
          ? getBlockPreviewAnchorWorldTransform(block, node.transform, anchor.id, previewJointAngleRad)
          : getWorldAnchorTransform(node.transform, anchor);
        const occupied = graph.isAnchorOccupied({ blockId: nodeId, anchorId: anchor.id });
        const color = getColor(anchor.id, occupied);
        return (
          <group
            key={`${nodeId}:${anchor.id}`}
            position={[world.position.x, world.position.y, world.position.z]}
          >
            <mesh renderOrder={3}>
              <sphereGeometry args={[0.11, 18, 18]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function findBlockId(object: THREE.Object3D): string | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    const id = current.userData?.snapBlockId;
    if (typeof id === "string") return id;
    current = current.parent;
  }
  return undefined;
}

function extractHits(event: ThreeEvent<PointerEvent | MouseEvent>): HitInfo[] {
  const hits: HitInfo[] = [];
  const seen = new Set<string>();

  for (const intersection of event.intersections) {
    const blockId = findBlockId(intersection.object);
    if (!blockId || seen.has(blockId)) {
      continue;
    }
    seen.add(blockId);
    hits.push({
      blockId,
      point: {
        x: intersection.point.x,
        y: intersection.point.y,
        z: intersection.point.z,
      },
    });
  }

  return hits;
}

function GhostAnchorMarkers({
  catalog,
  typeId,
  placement,
  activeSourceAnchorId,
}: {
  catalog: BlockCatalog;
  typeId: string;
  placement: Transform;
  activeSourceAnchorId: string;
}) {
  const block = catalog.get(typeId);

  return (
    <group>
      {block.anchors.map((anchor) => {
        const world = composeTransforms(placement, getAnchorLocalTransform(anchor));
        const isActive = anchor.id === activeSourceAnchorId;
        return (
          <group
            key={`ghost-anchor:${anchor.id}`}
            position={[world.position.x, world.position.y, world.position.z]}
          >
            <mesh renderOrder={4}>
              <sphereGeometry args={[isActive ? 0.13 : 0.08, 18, 18]} />
              <meshStandardMaterial
                color={isActive ? "#ff7cf2" : "#9ce7ff"}
                emissive={isActive ? "#ff7cf2" : "#9ce7ff"}
                emissiveIntensity={isActive ? 1.4 : 0.55}
                depthWrite={false}
                transparent
                opacity={isActive ? 0.95 : 0.72}
              />
            </mesh>
            {isActive && (
              <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={4}>
                <torusGeometry args={[0.18, 0.022, 10, 36]} />
                <meshStandardMaterial
                  color="#ff7cf2"
                  emissive="#ff7cf2"
                  emissiveIntensity={1.2}
                  depthWrite={false}
                  transparent
                  opacity={0.9}
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}
