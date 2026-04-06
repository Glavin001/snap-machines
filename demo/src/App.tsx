import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Environment } from "@react-three/drei";
import { useState, useCallback } from "react";
import { SnapScene } from "./SnapScene.js";

const BLOCK_TYPES = ["frame.cube.1", "joint.hinge.small", "utility.thruster.small"] as const;
type BlockType = (typeof BLOCK_TYPES)[number];

const BLOCK_LABELS: Record<BlockType, string> = {
  "frame.cube.1": "Cube",
  "joint.hinge.small": "Hinge",
  "utility.thruster.small": "Thruster",
};

export function App() {
  const [selectedType, setSelectedType] = useState<BlockType>("frame.cube.1");
  const [blockCount, setBlockCount] = useState(1);

  const onBlockPlaced = useCallback(() => {
    setBlockCount((c) => c + 1);
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* HUD */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 10,
          color: "#e0e0e0",
          background: "rgba(0,0,0,0.7)",
          padding: "16px 20px",
          borderRadius: 12,
          minWidth: 220,
          backdropFilter: "blur(8px)",
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 18, color: "#fff" }}>
          Snap Machines Demo
        </h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, opacity: 0.8 }}>
          Click a face on any block to snap a new block onto it.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {BLOCK_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              style={{
                padding: "8px 12px",
                border: selectedType === type ? "2px solid #6c63ff" : "2px solid transparent",
                borderRadius: 8,
                background: selectedType === type ? "rgba(108,99,255,0.25)" : "rgba(255,255,255,0.08)",
                color: "#fff",
                cursor: "pointer",
                fontSize: 14,
                textAlign: "left",
                transition: "all 0.15s",
              }}
            >
              {BLOCK_LABELS[type]}
            </button>
          ))}
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 12, opacity: 0.6 }}>
          Blocks placed: {blockCount}
        </p>
      </div>

      {/* 3D Scene */}
      <Canvas
        camera={{ position: [4, 3, 5], fov: 50 }}
        shadows
        style={{ background: "#1a1a2e" }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 8, 5]} intensity={1} castShadow />
        <Environment preset="city" />
        <OrbitControls makeDefault />
        <Grid
          args={[20, 20]}
          cellSize={1}
          sectionSize={5}
          fadeDistance={30}
          cellColor="#333355"
          sectionColor="#444477"
          position={[0, -0.5, 0]}
        />
        <SnapScene
          selectedType={selectedType}
          onBlockPlaced={onBlockPlaced}
        />
      </Canvas>
    </div>
  );
}
