import { useRef, useState, useCallback, useEffect } from "react";
import { ThreeEvent, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  BlockCatalog,
  BlockGraph,
  findBestSnap,
  addSnappedBlockToGraph,
  TRANSFORM_IDENTITY,
  Transform,
} from "snap-machines";
import { BlockMesh } from "./BlockMesh.js";
import { GhostPreview } from "./GhostPreview.js";

interface SnapSceneProps {
  graph: BlockGraph;
  catalog: BlockCatalog;
  selectedType: string;
  onBlockPlaced: () => void;
  onBlockRemoved: () => void;
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

export function SnapScene({ graph, catalog, selectedType, onBlockPlaced, onBlockRemoved }: SnapSceneProps) {
  const graphRef = useRef<BlockGraph>(graph);
  graphRef.current = graph;

  const [blocks, setBlocks] = useState<PlacedBlock[]>(() =>
    graph.listNodes().map((n) => ({ nodeId: n.id, typeId: n.typeId, transform: n.transform })),
  );

  // ---------------------------------------------------------------------------
  // Ghost preview – all fast-changing state lives in refs so pointer-move
  // updates never trigger React re-renders.  useFrame syncs the visual.
  // ---------------------------------------------------------------------------
  const ghostGroupRef = useRef<THREE.Group>(null);
  const snapTransformRef = useRef<Transform | null>(null);
  const lastHitRef = useRef<HitInfo | null>(null);

  // Apply the latest snap transform to the ghost group every frame.
  // This is the ONLY place position / visibility are touched — no setState.
  useFrame(() => {
    const group = ghostGroupRef.current;
    if (!group) return;
    const t = snapTransformRef.current;
    if (t) {
      group.position.set(t.position.x, t.position.y, t.position.z);
      group.quaternion.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
      group.visible = true;
    } else {
      group.visible = false;
    }
  });

  // Compute snap and store result in the ref (no setState, no re-render).
  const computeSnap = useCallback(
    (hit: HitInfo) => {
      const snap = findBestSnap({
        graph: graphRef.current,
        catalog,
        candidateTypeId: selectedType,
        hit: { blockId: hit.blockId, point: hit.point },
      });
      snapTransformRef.current = snap ? snap.placement : null;
      return snap ?? null;
    },
    [catalog, selectedType],
  );

  // When selectedType changes, recompute snap at the last pointer position so
  // the ghost updates immediately without requiring mouse movement.
  useEffect(() => {
    if (lastHitRef.current) {
      computeSnap(lastHitRef.current);
    }
  }, [computeSnap]);

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const blockId = findBlockId(e.object);
      if (!blockId) {
        // Pointer is between faces or on empty space inside the group.
        // Keep the ghost at its last valid position — it will be cleared
        // when the pointer leaves the group entirely (handlePointerLeave).
        return;
      }

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

      const point = e.point;
      const snap = findBestSnap({
        graph: graphRef.current,
        catalog,
        candidateTypeId: selectedType,
        hit: { blockId, point: { x: point.x, y: point.y, z: point.z } },
      });

      if (!snap) return;

      const { nodeId } = addSnappedBlockToGraph({
        graph: graphRef.current,
        typeId: selectedType,
        snap,
      });

      setBlocks((prev) => [
        ...prev,
        { nodeId, typeId: selectedType, transform: snap.placement },
      ]);

      // Recompute ghost targeting the newly placed block so the preview
      // persists for rapid stacking without waiting for a pointer move.
      const updatedHit: HitInfo = { blockId: nodeId, point: { x: point.x, y: point.y, z: point.z } };
      lastHitRef.current = updatedHit;
      computeSnap(updatedHit);

      onBlockPlaced();
    },
    [catalog, selectedType, onBlockPlaced, computeSnap],
  );

  const handlePointerLeave = useCallback(() => {
    lastHitRef.current = null;
    snapTransformRef.current = null;
  }, []);

  const handleContextMenu = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      // Prevent browser context menu
      e.nativeEvent.preventDefault();

      const blockId = findBlockId(e.object);
      if (!blockId) return;

      // Don't allow deleting the origin block — it's the seed
      if (blockId === "origin") return;

      graphRef.current.removeNode(blockId);
      setBlocks((prev) => prev.filter((b) => b.nodeId !== blockId));

      // Clear ghost since the surface we were hovering may be gone
      lastHitRef.current = null;
      snapTransformRef.current = null;

      onBlockRemoved();
    },
    [onBlockRemoved],
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
        />
      ))}
      {/* Ghost is always mounted; visibility is driven by useFrame above. */}
      <GhostPreview
        ref={ghostGroupRef}
        typeId={selectedType}
        catalog={catalog}
      />
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
