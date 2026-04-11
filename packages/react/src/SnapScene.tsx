import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { ThreeEvent, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  BlockCatalog,
  BlockGraph,
  SnapResult,
  addSnappedBlockToGraph,
  findSnapCandidates,
  getWorldAnchorTransform,
  transform,
  Transform,
} from "@snap-machines/core";
import { BlockMesh } from "./BlockMesh.js";
import { GhostPreview } from "./GhostPreview.js";

export type SnapSceneToolMode = "place" | "select" | "move" | "rotate";

export interface SnapSceneProps {
  graph: BlockGraph;
  catalog: BlockCatalog;
  selectedType: string;
  selectedNodeId?: string | null;
  selectedNodeIds?: string[];
  toolMode?: SnapSceneToolMode;
  previewRotation?: { x: number; y: number; z: number };
  colorMap?: Record<string, string>;
  onGraphChange?: (graph: BlockGraph) => void;
  onSelectionChange?: (nodeId: string | null, options?: { toggle?: boolean }) => void;
  onSnapChange?: (snap: SnapResult | null) => void;
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
  previewRotation = { x: 0, y: 0, z: 0 },
  colorMap,
  onGraphChange,
  onSelectionChange,
  onSnapChange,
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
  const preferredSourceAnchorIdRef = useRef<string | null>(null);

  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [activeSnap, setActiveSnap] = useState<SnapResult | null>(null);

  useFrame(() => {
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
  });

  const computeSnap = useCallback(
    (hit: HitInfo) => {
      setHoveredBlockId(hit.blockId);

      if (toolMode !== "place") {
        snapTransformRef.current = null;
        setActiveSnap(null);
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
      const preview = transform(hit.point, {
        x: previewQuat.x,
        y: previewQuat.y,
        z: previewQuat.z,
        w: previewQuat.w,
      });
      const candidates = findSnapCandidates({
        graph,
        catalog,
        candidateTypeId: selectedType,
        hit: { blockId: hit.blockId, point: hit.point },
        previewTransform: preview,
      });
      const preferred = preferredSourceAnchorIdRef.current
        ? candidates.find((candidate) => candidate.sourceAnchor.id === preferredSourceAnchorIdRef.current)
        : undefined;
      const best = preferred ?? candidates[0];
      const snap = best
        ? {
            ...best,
            connection: {
              a: { blockId: hit.blockId, anchorId: best.target.anchor.id },
              b: { blockId: "__candidate__", anchorId: best.sourceAnchor.id },
            },
          }
        : null;
      preferredSourceAnchorIdRef.current = snap?.sourceAnchor.id ?? null;
      snapTransformRef.current = snap ? snap.placement : null;
      setActiveSnap(snap);
      onSnapChange?.(snap);
      return snap ?? null;
    },
    [catalog, graph, onSnapChange, previewRotation, selectedType, toolMode],
  );

  useEffect(() => {
    preferredSourceAnchorIdRef.current = null;
  }, [selectedType]);

  useEffect(() => {
    if (toolMode === "place" && lastHitRef.current) {
      computeSnap(lastHitRef.current);
      return;
    }
    snapTransformRef.current = null;
    setActiveSnap(null);
    preferredSourceAnchorIdRef.current = null;
    onSnapChange?.(null);
  }, [computeSnap, onSnapChange, toolMode]);

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const blockId = findBlockId(e.object);
      if (!blockId) return;

      const point = e.point;
      const hit: HitInfo = { blockId, point: { x: point.x, y: point.y, z: point.z } };
      lastHitRef.current = hit;
      computeSnap(hit);
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

      const point = e.point;
      const hit: HitInfo = { blockId, point: { x: point.x, y: point.y, z: point.z } };
      const snap = computeSnap(hit);
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
      preferredSourceAnchorIdRef.current = null;
    },
    [computeSnap, graph, onBlockPlaced, onGraphChange, onSelectionChange, selectedType, toolMode],
  );

  const handlePointerLeave = useCallback(() => {
    lastHitRef.current = null;
    setHoveredBlockId(null);
    snapTransformRef.current = null;
    setActiveSnap(null);
    preferredSourceAnchorIdRef.current = null;
    onSnapChange?.(null);
  }, [onSnapChange]);

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
      preferredSourceAnchorIdRef.current = null;
      onSnapChange?.(null);

      onBlockRemoved?.();
    },
    [graph, onBlockRemoved, onGraphChange, onSelectionChange, onSnapChange, selectedNodeIds],
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
          highlight={selectedNodeIds.includes(block.nodeId) || block.nodeId === hoveredBlockId}
        />
      ))}

      {selectedNodeIds.map((nodeId) => (
        <AnchorMarkers
          key={`selected-anchor:${nodeId}`}
          graph={graph}
          catalog={catalog}
          nodeId={nodeId}
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
    </group>
  );
}

interface AnchorMarkersProps {
  graph: BlockGraph;
  catalog: BlockCatalog;
  nodeId: string;
  getColor: (anchorId: string, occupied: boolean) => string;
}

function AnchorMarkers({ graph, catalog, nodeId, getColor }: AnchorMarkersProps) {
  const node = graph.getNode(nodeId);
  const block = node ? catalog.get(node.typeId) : null;

  if (!node || !block) {
    return null;
  }

  return (
    <group>
      {block.anchors.map((anchor) => {
        const world = getWorldAnchorTransform(node.transform, anchor);
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
