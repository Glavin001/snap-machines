import { useRef, useState, useCallback, useMemo } from "react";
import { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import {
  BlockCatalog,
  BlockGraph,
  NormalizedBlockDefinition,
  findBestSnap,
  addSnappedBlockToGraph,
  TRANSFORM_IDENTITY,
  QUAT_IDENTITY,
  vec3,
  transform,
  Vec3,
  Transform,
} from "snap-construction-system";
import { exampleCatalog } from "snap-construction-system/examples/catalog.js";
import { BlockMesh } from "./BlockMesh.js";
import { GhostPreview } from "./GhostPreview.js";

interface SnapSceneProps {
  selectedType: string;
  onBlockPlaced: () => void;
}

interface PlacedBlock {
  nodeId: string;
  typeId: string;
  transform: Transform;
}

export function SnapScene({ selectedType, onBlockPlaced }: SnapSceneProps) {
  const catalog = useMemo(() => {
    const c = new BlockCatalog();
    c.registerMany(exampleCatalog);
    return c;
  }, []);

  const [graph] = useState(() => {
    const g = new BlockGraph();
    g.addNode({ id: "origin", typeId: "frame.cube.1", transform: TRANSFORM_IDENTITY });
    return g;
  });
  const graphRef = useRef<BlockGraph>(graph);

  const [blocks, setBlocks] = useState<PlacedBlock[]>([
    { nodeId: "origin", typeId: "frame.cube.1", transform: TRANSFORM_IDENTITY },
  ]);

  const [ghostTransform, setGhostTransform] = useState<Transform | null>(null);
  const [ghostType, setGhostType] = useState<string>(selectedType);

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const blockId = findBlockId(e.object);
      if (!blockId) {
        setGhostTransform(null);
        return;
      }

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

      if (snap) {
        setGhostTransform(snap.placement);
        setGhostType(selectedType);
      } else {
        setGhostTransform(null);
      }
    },
    [catalog, selectedType],
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

      setBlocks((prev) => [
        ...prev,
        { nodeId, typeId: selectedType, transform: snap.placement },
      ]);
      setGhostTransform(null);
      onBlockPlaced();
    },
    [catalog, selectedType, onBlockPlaced],
  );

  const handlePointerLeave = useCallback(() => {
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
          typeId={ghostType}
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
