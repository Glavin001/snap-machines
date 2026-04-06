import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import {
  BlockCatalog,
  BlockGraph,
  findBestSnap,
  addSnappedBlockToGraph,
  TRANSFORM_IDENTITY,
  Transform,
} from "snap-construction-system";
import { BlockMesh } from "./BlockMesh.js";
import { GhostPreview } from "./GhostPreview.js";

interface SnapSceneProps {
  graph: BlockGraph;
  catalog: BlockCatalog;
  selectedType: string;
  onBlockPlaced: () => void;
}

interface PlacedBlock {
  nodeId: string;
  typeId: string;
  transform: Transform;
}

/** Cached hit info so we can recompute snaps without a new pointer event. */
interface HitInfo {
  blockId: string;
  point: { x: number; y: number; z: number };
}

export function SnapScene({ graph, catalog, selectedType, onBlockPlaced }: SnapSceneProps) {
  const graphRef = useRef<BlockGraph>(graph);
  graphRef.current = graph;

  const [blocks, setBlocks] = useState<PlacedBlock[]>(() =>
    graph.listNodes().map((n) => ({ nodeId: n.id, typeId: n.typeId, transform: n.transform })),
  );

  const [ghostTransform, setGhostTransform] = useState<Transform | null>(null);

  // Store the last valid hit so we can recompute the snap when selectedType changes
  // or after placing a block, without requiring a new pointer event.
  const lastHitRef = useRef<HitInfo | null>(null);

  // Helper: run findBestSnap and update ghost transform.
  const recomputeSnap = useCallback(
    (hit: HitInfo) => {
      const snap = findBestSnap({
        graph: graphRef.current,
        catalog,
        candidateTypeId: selectedType,
        hit: {
          blockId: hit.blockId,
          point: hit.point,
        },
      });
      setGhostTransform(snap ? snap.placement : null);
      return snap;
    },
    [catalog, selectedType],
  );

  // When selectedType changes, immediately recompute the snap at the last
  // known pointer position so the ghost updates without requiring mouse movement.
  useEffect(() => {
    if (lastHitRef.current) {
      recomputeSnap(lastHitRef.current);
    }
  }, [recomputeSnap]);

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const blockId = findBlockId(e.object);
      if (!blockId) {
        // Pointer is between faces or over empty space inside the group.
        // Keep the ghost at its last valid position to avoid flicker — it
        // will be cleared properly when the pointer leaves the group entirely.
        return;
      }

      const point = e.point;
      const hit: HitInfo = { blockId, point: { x: point.x, y: point.y, z: point.z } };
      lastHitRef.current = hit;
      recomputeSnap(hit);
    },
    [recomputeSnap],
  );

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const blockId = findBlockId(e.object);
      if (!blockId) return;

      const point = e.point;
      const snap = findBestSnap({
        graph: graphRef.current,
        catalog,
        candidateTypeId: selectedType,
        hit: {
          blockId,
          point: { x: point.x, y: point.y, z: point.z },
        },
      });

      if (!snap) return;

      const { nodeId } = addSnappedBlockToGraph({
        graph: graphRef.current,
        typeId: selectedType,
        snap,
      });

      const newBlock = { nodeId, typeId: selectedType, transform: snap.placement };
      setBlocks((prev) => [...prev, newBlock]);

      // After placement, recompute the ghost targeting the newly placed block
      // so the preview stays visible if the user wants to stack more blocks.
      const updatedHit: HitInfo = { blockId: nodeId, point: { x: point.x, y: point.y, z: point.z } };
      lastHitRef.current = updatedHit;
      const nextSnap = findBestSnap({
        graph: graphRef.current,
        catalog,
        candidateTypeId: selectedType,
        hit: { blockId: nodeId, point: updatedHit.point },
      });
      setGhostTransform(nextSnap ? nextSnap.placement : null);

      onBlockPlaced();
    },
    [catalog, selectedType, onBlockPlaced],
  );

  const handlePointerLeave = useCallback(() => {
    lastHitRef.current = null;
    setGhostTransform(null);
  }, []);

  return (
    <group
      onPointerMove={handlePointerMove}
      onClick={handleClick}
      onPointerLeave={handlePointerLeave}
    >
      {blocks.map((block) => (
        <BlockMesh
          key={block.nodeId}
          nodeId={block.nodeId}
          typeId={block.typeId}
          blockTransform={block.transform}
          catalog={catalog}
        />
      ))}
      {ghostTransform && (
        <GhostPreview
          typeId={selectedType}
          blockTransform={ghostTransform}
          catalog={catalog}
        />
      )}
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
