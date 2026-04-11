import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Environment } from "@react-three/drei";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  BlockCatalog,
  BlockGraph,
  TRANSFORM_IDENTITY,
  compileMachineEnvelope,
  SerializedBlockGraph,
  ControlMap,
  MachinePlan,
  rewritePlanActions,
  generateControlMap,
} from "@snap-machines/core";
import { SnapScene, PhysicsScene } from "@snap-machines/react";
import { demoCatalog } from "./catalog.js";
import { MACHINE_PRESETS, MachinePreset } from "./machines.js";
import { ControlPanel } from "./ControlPanel.js";

// Block categories for the toolbar
const BLOCK_CATEGORIES = {
  Structural: [
    { id: "primitive.block.1x1", label: "Block 1x1" },
    { id: "primitive.block.2x1", label: "Block 2x1" },
    { id: "primitive.plate.2x1", label: "Plate" },
    { id: "primitive.cylinder", label: "Cylinder" },
    { id: "primitive.sphere", label: "Sphere" },
    { id: "frame.cube.1", label: "Frame Cube" },
    { id: "frame.plank.3x1", label: "Plank 3x1" },
    { id: "frame.beam.5x1", label: "Beam 5x1" },
  ],
  Joints: [
    { id: "joint.hinge.small", label: "Hinge" },
    { id: "joint.hinge.passive", label: "Passive Hinge" },
    { id: "joint.fixed", label: "Fixed Joint" },
    { id: "joint.slider", label: "Slider" },
    { id: "joint.ball", label: "Ball Joint" },
  ],
  Locomotion: [
    { id: "compound.wheel", label: "Wheel" },
    { id: "joint.motor.wheel", label: "Motor Wheel" },
    { id: "compound.shock", label: "Shock Absorber" },
  ],
  Flight: [
    { id: "compound.propeller", label: "Propeller" },
    { id: "compound.jet", label: "Jet Engine" },
    { id: "compound.flap", label: "Control Surface" },
    { id: "utility.thruster.small", label: "Thruster" },
  ],
  Manipulation: [
    { id: "compound.arm", label: "Arm Segment" },
    { id: "compound.arm.yaw", label: "Yaw Arm" },
  ],
} as const;

// Flat list for compatibility
const BLOCK_TYPES = Object.values(BLOCK_CATEGORIES).flatMap((items) => items.map((b) => b.id));
type BlockType = string;

type Mode = "gallery" | "build" | "play";

export function App() {
  const [selectedType, setSelectedType] = useState<BlockType>("primitive.block.1x1");
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

  const exportMachineEnvelope = useCallback(
    (currentMode: Mode, currentGraph: BlockGraph, currentPlayGraph: BlockGraph | null) => {
      const source = currentMode === "play" ? (currentPlayGraph ?? currentGraph) : currentGraph;
      const envelope = compileMachineEnvelope(source, catalog, {
        metadata: {
          builder: "snap-machines-demo",
          mode: currentMode,
          presetName: activePreset?.name ?? null,
        },
      });
      const json = JSON.stringify(envelope, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const baseName = (activePreset?.name ?? "machine")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      link.href = url;
      link.download = `${baseName || "machine"}.envelope.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
    [activePreset?.name, catalog],
  );

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

  // Per-motor control map (generated from the compiled plan)
  const [controlMap, setControlMap] = useState<ControlMap | null>(null);
  const [showControls, setShowControls] = useState(false);
  // Hovered actuator entry — drives 3D part highlighting + joint axis indicator
  const [hoveredEntry, setHoveredEntry] = useState<{ blockId: string; id: string } | null>(null);
  const keysDown = useRef(new Set<string>());

  // Track pressed keys (used by PhysicsScene's updateControlMapInput via ref)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if ((e.target as HTMLElement)?.tagName === "BUTTON") return;
      keysDown.current.add(e.key.toLowerCase());
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysDown.current.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // When the plan is ready (compiled by PhysicsScene), generate the ControlMap
  const handlePlanReady = useCallback(
    (plan: MachinePlan) => {
      const originals = rewritePlanActions(plan);
      const map = generateControlMap(plan, originals, catalog, playGraph ?? graph);
      setControlMap(map);
    },
    [catalog, graph, playGraph],
  );

  // Handle preset auto-input: simulate key presses for the preset's autoInput actions
  // We detect which keys the controlMap needs and inject them into keysDown
  useEffect(() => {
    if (mode !== "play" || !activePreset || !controlMap) return;

    // For presets with autoInput, look up which original actions are active
    // and inject the corresponding positive keys into keysDown
    const autoKeys = new Set<string>();
    const autoInput = activePreset.autoInput;
    for (const entry of controlMap) {
      const autoValue = autoInput[entry.originalAction];
      if (typeof autoValue === "number" && autoValue > 0 && entry.positiveKey) {
        autoKeys.add(entry.positiveKey);
      } else if (typeof autoValue === "number" && autoValue < 0 && entry.negativeKey) {
        autoKeys.add(entry.negativeKey);
      }
    }
    // Inject auto-keys
    for (const key of autoKeys) {
      keysDown.current.add(key);
    }
    return () => {
      // Clean up auto-injected keys on unmount
      for (const key of autoKeys) {
        keysDown.current.delete(key);
      }
    };
  }, [mode, activePreset, controlMap]);

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
    setControlMap(null);
    setMode("play");
  }, [graph, graphToJsonText]);

  // Play → Stop: return to build mode
  const handleStop = useCallback(() => {
    setPlayGraph(null);
    setPhysicsReady(false);
    setFirstPerson(false);
    setControlMap(null);
    setShowControls(false);
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
    setControlMap(null);
    setShowControls(false);
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
        setControlMap(null);
      }
      setJsonError(null);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
    }
  }, [jsonText, catalog, mode]);

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
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(BLOCK_CATEGORIES).map(([category, items]) => (
                <div key={category}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", opacity: 0.5, marginBottom: 3, letterSpacing: 1 }}>
                    {category}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {items.map((block) => (
                      <button
                        key={block.id}
                        onClick={() => setSelectedType(block.id)}
                        style={{
                          padding: "4px 8px",
                          border: selectedType === block.id ? "1px solid #6c63ff" : "1px solid transparent",
                          borderRadius: 5,
                          background: selectedType === block.id ? "rgba(108,99,255,0.25)" : "rgba(255,255,255,0.08)",
                          color: "#fff",
                          cursor: "pointer",
                          fontSize: 11,
                          transition: "all 0.15s",
                        }}
                      >
                        {block.label}
                      </button>
                    ))}
                  </div>
                </div>
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
            <button
              onClick={() => exportMachineEnvelope(mode, graph, playGraph)}
              style={{
                marginTop: 6,
                padding: "6px 10px",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6,
                background: "rgba(76,175,80,0.12)",
                color: "#b7f0ba",
                cursor: "pointer",
                fontSize: 12,
                width: "100%",
                transition: "all 0.15s",
              }}
            >
              Export Machine JSON
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
            {!firstPerson && controlMap && controlMap.length > 0 && (
              <>
                <button
                  onClick={() => setShowControls((v) => !v)}
                  style={{
                    marginTop: 4,
                    padding: "6px 10px",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: 6,
                    background: showControls ? "rgba(108,99,255,0.2)" : "transparent",
                    color: showControls ? "#c0b8ff" : "#ccc",
                    cursor: "pointer",
                    fontSize: 12,
                    width: "100%",
                    transition: "all 0.15s",
                  }}
                >
                  {showControls ? "Hide" : "Show"} Controls
                </button>
                {showControls && (
                  <div style={{ marginTop: 8 }}>
                    <ControlPanel
                      controlMap={controlMap}
                      onControlMapChange={setControlMap}
                      keysDownRef={keysDown}
                      onHoverEntry={setHoveredEntry}
                    />
                  </div>
                )}
              </>
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
            <button
              onClick={() => exportMachineEnvelope(mode, graph, playGraph)}
              style={{
                marginTop: 6,
                padding: "6px 10px",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6,
                background: "rgba(76,175,80,0.12)",
                color: "#b7f0ba",
                cursor: "pointer",
                fontSize: 12,
                width: "100%",
                transition: "all 0.15s",
              }}
            >
              Export Machine JSON
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
            controlMap={controlMap ?? undefined}
            keysDownRef={keysDown}
            firstPerson={firstPerson}
            gravity={activePreset?.gravity}
            onReady={() => setPhysicsReady(true)}
            onPlanReady={handlePlanReady}
            highlightBlockId={hoveredEntry?.blockId}
            highlightJointId={hoveredEntry?.id}
          />
        )}
      </Canvas>
    </div>
  );
}
