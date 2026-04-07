import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Environment } from "@react-three/drei";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  BlockCatalog,
  BlockGraph,
  TRANSFORM_IDENTITY,
  RuntimeInputState,
  SerializedBlockGraph,
} from "snap-construction-system";
import { demoCatalog } from "./catalog.js";
import { MACHINE_PRESETS, MachinePreset } from "./machines.js";
import { SnapScene } from "./SnapScene.js";
import { PhysicsScene } from "./PhysicsScene.js";

const BLOCK_TYPES = [
  "frame.cube.1",
  "frame.plank.3x1",
  "frame.beam.5x1",
  "joint.hinge.small",
  "joint.motor.wheel",
  "utility.thruster.small",
] as const;
type BlockType = (typeof BLOCK_TYPES)[number];

const BLOCK_LABELS: Record<BlockType, string> = {
  "frame.cube.1": "Cube",
  "frame.plank.3x1": "Plank 3x1",
  "frame.beam.5x1": "Beam 5x1",
  "joint.hinge.small": "Hinge",
  "joint.motor.wheel": "Motor Wheel",
  "utility.thruster.small": "Thruster",
};

type Mode = "gallery" | "build" | "play";

export function App() {
  const [selectedType, setSelectedType] = useState<BlockType>("frame.cube.1");
  const [blockCount, setBlockCount] = useState(1);
  const [mode, setMode] = useState<Mode>("gallery");
  const [physicsReady, setPhysicsReady] = useState(false);
  const [firstPerson, setFirstPerson] = useState(false);
  const [activePreset, setActivePreset] = useState<MachinePreset | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  // Increment to force SnapScene remount when graph is replaced wholesale
  const [graphKey, setGraphKey] = useState(0);

  const showJsonRef = useRef(false);
  showJsonRef.current = showJson;

  const catalog = useMemo(() => {
    const c = new BlockCatalog();
    c.registerMany(demoCatalog);
    return c;
  }, []);

  const [graph, setGraph] = useState(() => {
    const g = new BlockGraph();
    g.addNode({ id: "origin", typeId: "frame.cube.1", transform: TRANSFORM_IDENTITY });
    return g;
  });

  // Graph snapshot for physics
  const [playGraph, setPlayGraph] = useState<BlockGraph | null>(null);

  // Serialize a graph to pretty JSON for the editor
  const graphToJsonText = useCallback((g: BlockGraph) => {
    return JSON.stringify(g.toJSON(), null, 2);
  }, []);

  const onBlockPlaced = useCallback(() => {
    setBlockCount((c) => c + 1);
    // Keep JSON panel in sync while building
    if (showJsonRef.current) {
      setJsonText(graphToJsonText(graph));
    }
  }, [graph, graphToJsonText]);

  const onBlockRemoved = useCallback(() => {
    setBlockCount((c) => Math.max(1, c - 1));
    if (showJsonRef.current) {
      setJsonText(graphToJsonText(graph));
    }
  }, [graph, graphToJsonText]);

  // Keyboard input for physics controls
  const [inputState, setInputState] = useState<RuntimeInputState>({});
  const keysDown = useRef(new Set<string>());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture keys when typing in textarea
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      keysDown.current.add(e.key.toLowerCase());
      updateInput();
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysDown.current.delete(e.key.toLowerCase());
      updateInput();
    };
    const updateInput = () => {
      const keys = keysDown.current;
      setInputState({
        hingeSpin: (keys.has("e") ? 1 : 0) - (keys.has("q") ? 1 : 0),
        throttle: keys.has(" ") ? 1 : 0,
        motorSpin: (keys.has("e") ? 1 : 0) - (keys.has("q") ? 1 : 0),
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Toggle JSON panel – sync text on open
  const toggleShowJson = useCallback(
    (currentMode: Mode, currentGraph: BlockGraph, currentPlayGraph: BlockGraph | null) => {
      setShowJson((prev) => {
        const next = !prev;
        if (next) {
          const source = currentMode === "build" ? currentGraph : (currentPlayGraph ?? currentGraph);
          setJsonText(graphToJsonText(source));
          setJsonError(null);
        }
        return next;
      });
    },
    [graphToJsonText],
  );

  // Gallery: select a preset → load into build mode for editing / preview
  const handlePresetSelect = useCallback(
    (preset: MachinePreset) => {
      const g = preset.build(catalog);
      setGraph(g);
      setBlockCount(g.listNodes().length);
      setActivePreset(preset);
      setJsonText(graphToJsonText(g));
      setJsonError(null);
      setGraphKey((k) => k + 1);
      setMode("build");
    },
    [catalog, graphToJsonText],
  );

  // Build Your Own: start a fresh empty machine
  const handleNewBuild = useCallback(() => {
    const g = new BlockGraph();
    g.addNode({ id: "origin", typeId: "frame.cube.1", transform: TRANSFORM_IDENTITY });
    setGraph(g);
    setBlockCount(1);
    setActivePreset(null);
    setJsonText(graphToJsonText(g));
    setJsonError(null);
    setGraphKey((k) => k + 1);
    setMode("build");
  }, [graphToJsonText]);

  // Build → Play: snapshot current graph and run physics
  const handlePlay = useCallback(() => {
    const g = graph.clone();
    setPlayGraph(g);
    setJsonText(graphToJsonText(g));
    setJsonError(null);
    setPhysicsReady(false);
    setMode("play");
  }, [graph, graphToJsonText]);

  // Play → Stop: return to build mode
  const handleStop = useCallback(() => {
    setPlayGraph(null);
    setPhysicsReady(false);
    setFirstPerson(false);
    setJsonText(graphToJsonText(graph));
    setJsonError(null);
    setMode("build");
  }, [graph, graphToJsonText]);

  // Go back to the gallery preset picker
  const handleGallery = useCallback(() => {
    setMode("gallery");
    setPlayGraph(null);
    setActivePreset(null);
    setPhysicsReady(false);
    setFirstPerson(false);
    setShowJson(false);
  }, []);

  // Apply edited JSON – updates build graph or restarts physics depending on mode
  const handleApplyJson = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText) as SerializedBlockGraph;
      const g = BlockGraph.fromJSON(parsed);
      const validation = g.validateAgainstCatalog(catalog);
      if (!validation.ok) {
        setJsonError(validation.errors.join("; "));
        return;
      }
      if (mode === "build") {
        setGraph(g);
        setBlockCount(g.listNodes().length);
        setGraphKey((k) => k + 1);
      } else {
        // Play mode: restart physics with the edited graph
        setPlayGraph(g);
        setPhysicsReady(false);
      }
      setJsonError(null);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
    }
  }, [jsonText, catalog, mode]);

  // Input: use auto-input from preset, or keyboard input
  const effectiveInput = activePreset && mode === "play" ? activePreset.autoInput : inputState;
  const cameraPos: [number, number, number] = activePreset?.cameraPosition ?? [4, 3, 5];

  const jsonPanelVisible = showJson && (mode === "build" || mode === "play");

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
          minWidth: 240,
          maxWidth: 280,
          backdropFilter: "blur(8px)",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 18, color: "#fff" }}>
          Snap Machines
        </h2>

        {/* ── GALLERY ── */}
        {mode === "gallery" && (
          <>
            <p style={{ margin: "0 0 12px", fontSize: 13, opacity: 0.8 }}>
              Pick a preset to load it into build mode, or start fresh.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {MACHINE_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => handlePresetSelect(preset)}
                  style={{
                    padding: "10px 12px",
                    border: "2px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.06)",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 14,
                    textAlign: "left",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#6c63ff";
                    e.currentTarget.style.background = "rgba(108,99,255,0.15)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                    e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{preset.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                    {preset.description}
                  </div>
                </button>
              ))}
            </div>
            <div
              style={{
                marginTop: 16,
                paddingTop: 12,
                borderTop: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <button
                onClick={handleNewBuild}
                style={{
                  padding: "10px 16px",
                  border: "none",
                  borderRadius: 8,
                  background: "#6c63ff",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  width: "100%",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#7c73ff")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#6c63ff")}
              >
                Build Your Own
              </button>
            </div>
          </>
        )}

        {/* ── BUILD ── */}
        {mode === "build" && (
          <>
            {activePreset && (
              <div
                style={{
                  marginBottom: 10,
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: "rgba(108,99,255,0.2)",
                  borderLeft: "3px solid #6c63ff",
                  fontSize: 13,
                  color: "#c0b8ff",
                }}
              >
                Preset: {activePreset.name}
              </div>
            )}
            <p style={{ margin: "0 0 12px", fontSize: 13, opacity: 0.8 }}>
              Click a face to snap a block. Right-click to remove. Hit Play to simulate.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {BLOCK_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  style={{
                    padding: "7px 10px",
                    border: selectedType === type ? "2px solid #6c63ff" : "2px solid transparent",
                    borderRadius: 8,
                    background: selectedType === type ? "rgba(108,99,255,0.25)" : "rgba(255,255,255,0.08)",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 13,
                    textAlign: "left",
                    transition: "all 0.15s",
                  }}
                >
                  {BLOCK_LABELS[type]}
                </button>
              ))}
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 12, opacity: 0.6 }}>
              Blocks: {blockCount}
            </p>
            {/* JSON toggle */}
            <button
              onClick={() => toggleShowJson(mode, graph, playGraph)}
              style={{
                marginTop: 10,
                padding: "6px 10px",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6,
                background: showJson ? "rgba(108,99,255,0.2)" : "transparent",
                color: "#ccc",
                cursor: "pointer",
                fontSize: 12,
                width: "100%",
                transition: "all 0.15s",
              }}
            >
              {showJson ? "Hide" : "Show"} Graph JSON
            </button>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                onClick={handlePlay}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  border: "none",
                  borderRadius: 8,
                  background: "#4caf50",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#66bb6a")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#4caf50")}
              >
                Play
              </button>
              <button
                onClick={handleGallery}
                style={{
                  padding: "10px 12px",
                  border: "none",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.12)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 13,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
              >
                Gallery
              </button>
            </div>
          </>
        )}

        {/* ── PLAY ── */}
        {mode === "play" && (
          <>
            {activePreset && (
              <h3 style={{ margin: "0 0 8px", fontSize: 15, color: "#fff" }}>
                {activePreset.name}
              </h3>
            )}
            <p style={{ margin: "0 0 8px", fontSize: 13, opacity: 0.8 }}>
              {activePreset
                ? "Physics simulation running with auto-input."
                : "Physics simulation running."}
            </p>
            {!physicsReady && (
              <p style={{ margin: "0 0 8px", fontSize: 13, color: "#ffc107" }}>
                Initializing Rapier...
              </p>
            )}
            {!activePreset && !firstPerson && (
              <div style={{ margin: "8px 0", fontSize: 12, opacity: 0.7, lineHeight: 1.6 }}>
                <strong>Controls:</strong><br />
                Q / E &mdash; Spin hinges &amp; motors<br />
                Space &mdash; Fire thrusters
              </div>
            )}
            {firstPerson && (
              <div style={{ margin: "8px 0", fontSize: 12, opacity: 0.7, lineHeight: 1.6 }}>
                <strong>First Person:</strong><br />
                Click canvas to lock mouse<br />
                WASD / Arrows &mdash; Move<br />
                Mouse &mdash; Look<br />
                Space &mdash; Jump<br />
                Esc &mdash; Release mouse
              </div>
            )}
            {/* First person toggle */}
            <button
              onClick={() => setFirstPerson((fp) => !fp)}
              style={{
                marginTop: 4,
                padding: "6px 10px",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6,
                background: firstPerson ? "rgba(76,175,80,0.3)" : "transparent",
                color: firstPerson ? "#a5d6a7" : "#ccc",
                cursor: "pointer",
                fontSize: 12,
                width: "100%",
                transition: "all 0.15s",
              }}
            >
              {firstPerson ? "Exit" : "Enter"} First Person
            </button>
            {/* JSON toggle */}
            <button
              onClick={() => toggleShowJson(mode, graph, playGraph)}
              style={{
                marginTop: 2,
                padding: "6px 10px",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6,
                background: showJson ? "rgba(108,99,255,0.2)" : "transparent",
                color: "#ccc",
                cursor: "pointer",
                fontSize: 12,
                width: "100%",
                transition: "all 0.15s",
              }}
            >
              {showJson ? "Hide" : "Show"} Graph JSON
            </button>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                onClick={handleStop}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  border: "none",
                  borderRadius: 8,
                  background: "#f44336",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#ef5350")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#f44336")}
              >
                Stop
              </button>
            </div>
          </>
        )}
      </div>

      {/* JSON Editor Panel (right side) – available in build and play modes */}
      {jsonPanelVisible && (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            bottom: 16,
            width: 420,
            zIndex: 10,
            color: "#e0e0e0",
            background: "rgba(0,0,0,0.85)",
            borderRadius: 12,
            backdropFilter: "blur(8px)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>
              Machine Graph JSON
            </div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              {mode === "build"
                ? "Edit the graph and click Apply to update the build."
                : "Edit the graph and click Apply to rebuild with physics."}
            </div>
          </div>
          <textarea
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError(null);
            }}
            spellCheck={false}
            style={{
              flex: 1,
              margin: 0,
              padding: "12px 16px",
              border: "none",
              background: "transparent",
              color: "#c8d6e5",
              fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
              fontSize: 11,
              lineHeight: 1.5,
              resize: "none",
              outline: "none",
              whiteSpace: "pre",
              overflowX: "auto",
              tabSize: 2,
            }}
          />
          {jsonError && (
            <div
              style={{
                padding: "8px 16px",
                background: "rgba(244,67,54,0.15)",
                borderTop: "1px solid rgba(244,67,54,0.3)",
                color: "#ef9a9a",
                fontSize: 11,
                lineHeight: 1.4,
                maxHeight: 60,
                overflowY: "auto",
              }}
            >
              {jsonError}
            </div>
          )}
          <div style={{ padding: "8px 16px 12px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
            <button
              onClick={handleApplyJson}
              style={{
                padding: "8px 16px",
                border: "none",
                borderRadius: 6,
                background: "#4caf50",
                color: "#fff",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                width: "100%",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#66bb6a")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#4caf50")}
            >
              Apply Changes
            </button>
          </div>
        </div>
      )}

      {/* Mode indicator */}
      {!jsonPanelVisible && (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            zIndex: 10,
            padding: "8px 16px",
            borderRadius: 8,
            background:
              mode === "gallery"
                ? "rgba(255,255,255,0.15)"
                : mode === "build"
                  ? "rgba(108,99,255,0.8)"
                  : "rgba(76,175,80,0.8)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            backdropFilter: "blur(8px)",
          }}
        >
          {mode === "gallery" ? "GALLERY" : mode === "build" ? "BUILD MODE" : "PLAY MODE"}
        </div>
      )}

      {/* Crosshair for first-person mode */}
      {mode === "play" && firstPerson && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 10,
            pointerEvents: "none",
            width: 20,
            height: 20,
          }}
        >
          <div style={{ position: "absolute", top: 9, left: 2, width: 16, height: 2, background: "rgba(255,255,255,0.6)", borderRadius: 1 }} />
          <div style={{ position: "absolute", top: 2, left: 9, width: 2, height: 16, background: "rgba(255,255,255,0.6)", borderRadius: 1 }} />
        </div>
      )}

      {/* 3D Scene */}
      <Canvas
        camera={{ position: cameraPos, fov: 50 }}
        shadows
        style={{ background: "#1a1a2e" }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 8, 5]} intensity={1} castShadow />
        <Environment preset="city" />
        {!(mode === "play" && firstPerson) && <OrbitControls makeDefault />}

        {(mode === "gallery" || mode === "build") && (
          <Grid
            args={[20, 20]}
            cellSize={1}
            sectionSize={5}
            fadeDistance={30}
            cellColor="#333355"
            sectionColor="#444477"
            position={[0, -0.5, 0]}
          />
        )}

        {mode === "build" && (
          <SnapScene
            key={graphKey}
            graph={graph}
            catalog={catalog}
            selectedType={selectedType}
            onBlockPlaced={onBlockPlaced}
            onBlockRemoved={onBlockRemoved}
          />
        )}

        {mode === "play" && playGraph && (
          <PhysicsScene
            graph={playGraph}
            catalog={catalog}
            inputState={effectiveInput}
            firstPerson={firstPerson}
            onReady={() => setPhysicsReady(true)}
          />
        )}
      </Canvas>
    </div>
  );
}
