import { Canvas } from "@react-three/fiber";
import { Environment, Grid, OrbitControls, TransformControls } from "@react-three/drei";
import { useState, useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import * as THREE from "three";
import {
  BlockCatalog,
  BlockGraph,
  compileMachinePlan,
  ControlMap,
  degToRad,
  generateControlMap,
  MachinePlan,
  radToDeg,
  resetControlMapState,
  rewritePlanActions,
  RuntimeInputState,
  SerializedBlockGraph,
  SnapResult,
  TRANSFORM_IDENTITY,
  Transform,
  vec3,
} from "@snap-machines/core";
import { PhysicsScene, SnapScene } from "@snap-machines/react";
import { demoCatalog } from "./catalog.js";
import { ControlPanel } from "./ControlPanel.js";
import { MACHINE_PRESETS, MachinePreset } from "./machines.js";

type Mode = "gallery" | "build" | "play";
type BuilderTool = "place" | "select" | "move" | "rotate";
type TransformSpace = "local" | "world";

interface TransformDraft {
  px: string;
  py: string;
  pz: string;
  rx: string;
  ry: string;
  rz: string;
}

const TOOL_OPTIONS: Array<{ id: BuilderTool; label: string }> = [
  { id: "place", label: "Place" },
  { id: "select", label: "Select" },
  { id: "move", label: "Move" },
  { id: "rotate", label: "Rotate" },
];

const ROTATION_STEPS = [90, 45, 15, 5, 1, 0] as const;
const CATEGORY_ORDER = ["structure", "joints", "utility"] as const;

function mergeControlMapSettings(nextMap: ControlMap, previousMap: ControlMap | null): ControlMap {
  if (!previousMap || previousMap.length === 0) return nextMap;

  const previousById = new Map(previousMap.map((entry) => [entry.id, entry] as const));
  return nextMap.map((entry) => {
    const previous = previousById.get(entry.id);
    if (!previous) return entry;
    return {
      ...entry,
      positiveKey: previous.positiveKey,
      negativeKey: previous.negativeKey,
      enabled: previous.enabled,
      scale: previous.scale,
      currentTarget: entry.actuatorType === "position" ? previous.currentTarget : entry.currentTarget,
    };
  });
}

function createFreshGraph(): BlockGraph {
  const g = new BlockGraph();
  g.addNode({ id: "origin", typeId: "frame.cube.1", transform: TRANSFORM_IDENTITY });
  return g;
}

export function App() {
  const [selectedType, setSelectedType] = useState("frame.cube.1");
  const [mode, setMode] = useState<Mode>("gallery");
  const [toolMode, setToolMode] = useState<BuilderTool>("place");
  const [transformSpace, setTransformSpace] = useState<TransformSpace>("local");
  const [placementRotationDeg, setPlacementRotationDeg] = useState(0);
  const [placementStepDeg, setPlacementStepDeg] = useState<number>(15);
  const [partQuery, setPartQuery] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [snapResult, setSnapResult] = useState<SnapResult | null>(null);
  const [physicsReady, setPhysicsReady] = useState(false);
  const [firstPerson, setFirstPerson] = useState(false);
  const [inputsEnabled, setInputsEnabled] = useState(true);
  const [activePreset, setActivePreset] = useState<MachinePreset | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [controlMap, setControlMap] = useState<ControlMap | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [hoveredEntry, setHoveredEntry] = useState<{ blockId: string; id: string } | null>(null);
  const [undoStack, setUndoStack] = useState<SerializedBlockGraph[]>([]);
  const [redoStack, setRedoStack] = useState<SerializedBlockGraph[]>([]);
  const [inspectorDraft, setInspectorDraft] = useState<TransformDraft | null>(null);
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [isTransformDragging, setIsTransformDragging] = useState(false);

  const catalog = useMemo(() => {
    const c = new BlockCatalog();
    c.registerMany(demoCatalog);
    return c;
  }, []);

  const paletteItems = useMemo(
    () =>
      demoCatalog.map((definition) => ({
        id: definition.id,
        label: definition.name ?? definition.id,
        category: definition.category ?? "other",
      })),
    [],
  );

  const [graph, setGraph] = useState(() => createFreshGraph());
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;

  const [playGraph, setPlayGraph] = useState<BlockGraph | null>(null);
  const transformHandleRef = useRef<THREE.Group>(null);
  const dragStartSnapshotRef = useRef<SerializedBlockGraph | null>(null);

  const selectedNode = useMemo(
    () => (selectedNodeId ? graph.getNode(selectedNodeId) ?? null : null),
    [graph, selectedNodeId],
  );
  const selectedDefinition = useMemo(
    () => (selectedNode ? catalog.get(selectedNode.typeId) : null),
    [catalog, selectedNode],
  );
  const selectedConnections = useMemo(
    () => (selectedNode ? graph.getConnectionsForBlock(selectedNode.id) : []),
    [graph, selectedNode],
  );

  const blockCount = graph.listNodes().length;
  const connectionCount = graph.listConnections().length;

  const graphToJsonText = useCallback((g: BlockGraph) => JSON.stringify(g.toJSON(), null, 2), []);

  useEffect(() => {
    if (!showJson) return;
    const source = mode === "play" ? (playGraph ?? graph) : graph;
    setJsonText(graphToJsonText(source));
    setJsonError(null);
  }, [graph, graphToJsonText, mode, playGraph, showJson]);

  useEffect(() => {
    if (mode !== "build") {
      if (mode === "gallery") {
        setControlMap(null);
        setHoveredEntry(null);
      }
      return;
    }

    const plan = compileMachinePlan(graph, catalog);
    const originals = rewritePlanActions(plan);
    const nextMap = generateControlMap(plan, originals, catalog, graph);
    resetControlMapState(nextMap);
    setControlMap((previous) => mergeControlMapSettings(nextMap, previous));
  }, [catalog, graph, mode]);

  useEffect(() => {
    if (!selectedNode) {
      setInspectorDraft(null);
      setInspectorError(null);
      return;
    }
    setInspectorDraft(transformToDraft(selectedNode.transform));
    setInspectorError(null);
  }, [selectedNode]);

  const groupedPalette = useMemo(() => {
    const query = partQuery.trim().toLowerCase();
    const filtered = paletteItems.filter((item) => {
      if (!query) return true;
      return (
        item.label.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query)
      );
    });

    const grouped = new Map<string, typeof filtered>();
    for (const item of filtered) {
      const bucket = grouped.get(item.category);
      if (bucket) bucket.push(item);
      else grouped.set(item.category, [item]);
    }

    return [...grouped.entries()].sort(([a], [b]) => {
      const ia = CATEGORY_ORDER.indexOf(a as (typeof CATEGORY_ORDER)[number]);
      const ib = CATEGORY_ORDER.indexOf(b as (typeof CATEGORY_ORDER)[number]);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [paletteItems, partQuery]);

  const applyBuildGraph = useCallback(
    (
      nextGraph: BlockGraph,
      options?: {
        recordHistory?: boolean;
        selection?: string | null;
        clearRedo?: boolean;
        resetHistory?: boolean;
      },
    ) => {
      const current = graphRef.current;
      if (options?.resetHistory) {
        setUndoStack([]);
        setRedoStack([]);
      } else if (options?.recordHistory !== false) {
        setUndoStack((prev) => [...prev, current.toJSON()]);
        if (options?.clearRedo !== false) {
          setRedoStack([]);
        }
      } else if (options?.clearRedo) {
        setRedoStack([]);
      }

      setGraph(nextGraph);
      setSnapResult(null);
      setJsonError(null);

      if (options && "selection" in options) {
        setSelectedNodeId(options.selection ?? null);
        return;
      }

      const currentSelection = selectedNodeIdRef.current;
      setSelectedNodeId(currentSelection && nextGraph.getNode(currentSelection) ? currentSelection : null);
    },
    [],
  );

  const resetBuildState = useCallback(
    (nextGraph: BlockGraph, preset: MachinePreset | null) => {
      setGraph(nextGraph);
      setActivePreset(preset);
      setSelectedNodeId(null);
      setSnapResult(null);
      setUndoStack([]);
      setRedoStack([]);
      setPlacementRotationDeg(0);
      setPlacementStepDeg(15);
      setToolMode("place");
      setTransformSpace("local");
      setPlayGraph(null);
      setPhysicsReady(false);
      setFirstPerson(false);
      setInputsEnabled(true);
      setControlMap(null);
      setShowControls(true);
      setJsonError(null);
      setMode("build");
    },
    [],
  );

  const handlePresetSelect = useCallback(
    (preset: MachinePreset) => {
      resetBuildState(preset.build(catalog), preset);
    },
    [catalog, resetBuildState],
  );

  const handleNewBuild = useCallback(() => {
    resetBuildState(createFreshGraph(), null);
  }, [resetBuildState]);

  const handlePlay = useCallback(() => {
    setPlayGraph(graph.clone());
    setPhysicsReady(false);
    setFirstPerson(false);
    setInputsEnabled(true);
    setControlMap(null);
    setShowControls(true);
    setMode("play");
  }, [graph]);

  const handleStop = useCallback(() => {
    setPlayGraph(null);
    setPhysicsReady(false);
    setFirstPerson(false);
    setInputsEnabled(true);
    setControlMap(null);
    setShowControls(true);
    setMode("build");
  }, []);

  const handleGallery = useCallback(() => {
    setMode("gallery");
    setPlayGraph(null);
    setActivePreset(null);
    setFirstPerson(false);
    setInputsEnabled(true);
    setPhysicsReady(false);
    setSelectedNodeId(null);
    setSnapResult(null);
    setControlMap(null);
    setShowControls(true);
    setHoveredEntry(null);
    setShowJson(false);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1]!;
      setRedoStack((redoPrev) => [...redoPrev, graphRef.current.toJSON()]);
      const nextGraph = BlockGraph.fromJSON(snapshot);
      setGraph(nextGraph);
      const currentSelection = selectedNodeIdRef.current;
      setSelectedNodeId(currentSelection && nextGraph.getNode(currentSelection) ? currentSelection : null);
      setSnapResult(null);
      setJsonError(null);
      return prev.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1]!;
      setUndoStack((undoPrev) => [...undoPrev, graphRef.current.toJSON()]);
      const nextGraph = BlockGraph.fromJSON(snapshot);
      setGraph(nextGraph);
      const currentSelection = selectedNodeIdRef.current;
      setSelectedNodeId(currentSelection && nextGraph.getNode(currentSelection) ? currentSelection : null);
      setSnapResult(null);
      setJsonError(null);
      return prev.slice(0, -1);
    });
  }, []);

  const updateSelectedTransform = useCallback(
    (nextTransform: Transform, options?: { recordHistory?: boolean; clearRedo?: boolean }) => {
      const nodeId = selectedNodeIdRef.current;
      if (!nodeId) return;
      const nextGraph = graphRef.current.clone();
      nextGraph.updateNodeTransform(nodeId, nextTransform);
      applyBuildGraph(nextGraph, {
        recordHistory: options?.recordHistory,
        clearRedo: options?.clearRedo,
        selection: nodeId,
      });
    },
    [applyBuildGraph],
  );

  const deleteSelectedBlock = useCallback(() => {
    const nodeId = selectedNodeIdRef.current;
    if (!nodeId || nodeId === "origin") return;
    const nextGraph = graphRef.current.clone();
    nextGraph.removeNode(nodeId);
    applyBuildGraph(nextGraph, { selection: null });
  }, [applyBuildGraph]);

  const applyDraftTransform = useCallback(() => {
    if (!selectedNode || !inspectorDraft) return;
    const parsed = parseDraftTransform(inspectorDraft);
    if (!parsed.ok) {
      setInspectorError(parsed.error);
      return;
    }
    updateSelectedTransform(parsed.transform);
    setInspectorError(null);
  }, [inspectorDraft, selectedNode, updateSelectedTransform]);

  const nudgeSelected = useCallback(
    (kind: "position" | "rotation", axis: "x" | "y" | "z", delta: number) => {
      const node = selectedNodeIdRef.current ? graphRef.current.getNode(selectedNodeIdRef.current) : null;
      if (!node) return;

      if (kind === "position") {
        updateSelectedTransform({
          position: { ...node.transform.position, [axis]: node.transform.position[axis] + delta },
          rotation: node.transform.rotation,
        });
        return;
      }

      const euler = quatToEulerDegrees(node.transform.rotation);
      euler[axis] += delta;
      updateSelectedTransform({
        position: node.transform.position,
        rotation: eulerDegreesToQuat(euler),
      });
    },
    [updateSelectedTransform],
  );

  const handleApplyJson = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText) as SerializedBlockGraph;
      const nextGraph = BlockGraph.fromJSON(parsed);
      const validation = nextGraph.validateAgainstCatalog(catalog);
      if (!validation.ok) {
        setJsonError(validation.errors.join("; "));
        return;
      }
      if (mode === "build") {
        applyBuildGraph(nextGraph, { selection: null });
      } else {
        setPlayGraph(nextGraph);
        setPhysicsReady(false);
        setControlMap(null);
        setShowControls(true);
      }
      setJsonError(null);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
    }
  }, [applyBuildGraph, catalog, jsonText, mode]);

  const handlePlanReady = useCallback(
    (plan: MachinePlan) => {
      const sourceGraph = playGraph ?? graphRef.current;
      const originals = rewritePlanActions(plan);
      const nextMap = generateControlMap(plan, originals, catalog, sourceGraph);
      resetControlMapState(nextMap);
      setControlMap((previous) => mergeControlMapSettings(nextMap, previous));
      setShowControls(true);
    },
    [catalog, playGraph],
  );

  const beginTransformDrag = useCallback(() => {
    dragStartSnapshotRef.current = graphRef.current.toJSON();
    setIsTransformDragging(true);
  }, []);

  const handleTransformObjectChange = useCallback(() => {
    const nodeId = selectedNodeIdRef.current;
    const handle = transformHandleRef.current;
    if (!nodeId || !handle) return;
    updateSelectedTransform(
      {
        position: vec3(handle.position.x, handle.position.y, handle.position.z),
        rotation: {
          x: handle.quaternion.x,
          y: handle.quaternion.y,
          z: handle.quaternion.z,
          w: handle.quaternion.w,
        },
      },
      { recordHistory: false },
    );
  }, [updateSelectedTransform]);

  const endTransformDrag = useCallback(() => {
    setIsTransformDragging(false);
    const snapshot = dragStartSnapshotRef.current;
    dragStartSnapshotRef.current = null;
    if (!snapshot) return;

    if (JSON.stringify(snapshot) !== JSON.stringify(graphRef.current.toJSON())) {
      setUndoStack((prev) => [...prev, snapshot]);
      setRedoStack([]);
    }
  }, []);

  const [inputState, setInputState] = useState<RuntimeInputState>({});
  const keysDown = useRef(new Set<string>());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA" || (e.target as HTMLElement)?.tagName === "INPUT") {
        return;
      }
      keysDown.current.add(e.key.toLowerCase());
      setInputState({
        hingeSpin: (keysDown.current.has("e") ? 1 : 0) - (keysDown.current.has("q") ? 1 : 0),
        throttle: keysDown.current.has(" ") ? 1 : 0,
        motorSpin: (keysDown.current.has("e") ? 1 : 0) - (keysDown.current.has("q") ? 1 : 0),
      });
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysDown.current.delete(e.key.toLowerCase());
      setInputState({
        hingeSpin: (keysDown.current.has("e") ? 1 : 0) - (keysDown.current.has("q") ? 1 : 0),
        throttle: keysDown.current.has(" ") ? 1 : 0,
        motorSpin: (keysDown.current.has("e") ? 1 : 0) - (keysDown.current.has("q") ? 1 : 0),
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (mode !== "build") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA" || (e.target as HTMLElement)?.tagName === "INPUT") {
        return;
      }

      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (e.key === "1") setToolMode("place");
      if (e.key === "2") setToolMode("select");
      if (e.key === "3") setToolMode("move");
      if (e.key === "4") setToolMode("rotate");
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        deleteSelectedBlock();
      }
      if (e.key === "[") {
        e.preventDefault();
        const step = placementStepDeg || 5;
        setPlacementRotationDeg((value) => value - step);
      }
      if (e.key === "]") {
        e.preventDefault();
        const step = placementStepDeg || 5;
        setPlacementRotationDeg((value) => value + step);
      }
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        setPlacementRotationDeg(0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelectedBlock, handleRedo, handleUndo, mode, placementStepDeg]);

  useEffect(() => {
    if (mode !== "play" || !inputsEnabled || !activePreset || !controlMap) return;

    const autoKeys = new Set<string>();
    for (const entry of controlMap) {
      if (!entry.enabled) continue;
      const autoValue = activePreset.autoInput[entry.originalAction];
      if (typeof autoValue === "number" && autoValue > 0 && entry.positiveKey) {
        autoKeys.add(entry.positiveKey);
      } else if (typeof autoValue === "number" && autoValue < 0 && entry.negativeKey) {
        autoKeys.add(entry.negativeKey);
      }
    }

    for (const key of autoKeys) {
      keysDown.current.add(key);
    }

    return () => {
      for (const key of autoKeys) {
        keysDown.current.delete(key);
      }
    };
  }, [activePreset, controlMap, inputsEnabled, mode]);

  const effectiveInput = inputsEnabled
    ? activePreset && mode === "play"
      ? activePreset.autoInput
      : inputState
    : {};
  const cameraPos: [number, number, number] = activePreset?.cameraPosition ?? [8, 6, 10];
  const jsonPanelVisible = showJson && (mode === "build" || mode === "play");

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 10,
          color: "#eef2ff",
          background: "rgba(8, 12, 20, 0.88)",
          padding: "16px 18px",
          borderRadius: 16,
          minWidth: 320,
          maxWidth: 340,
          backdropFilter: "blur(16px)",
          border: "1px solid rgba(125, 211, 252, 0.18)",
          maxHeight: "calc(100vh - 32px)",
          overflow: "hidden",
          boxShadow: "0 18px 48px rgba(0,0,0,0.28)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 20, color: "#ffffff", letterSpacing: 0.2 }}>
          Snap Machines
        </h2>
        <div style={{ fontSize: 12, opacity: 0.72, marginBottom: 14 }}>
          Builder-first editor with visible anchors, explicit snap state, and direct transform editing.
        </div>

        {mode === "gallery" && (
          <div style={{ overflowY: "auto", paddingRight: 4 }}>
            <div style={{ fontSize: 13, opacity: 0.78, marginBottom: 12 }}>
              Pick a machine to edit, or start a fresh build.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {MACHINE_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => handlePresetSelect(preset)}
                  style={cardButtonStyle}
                >
                  <div style={{ fontWeight: 700, color: "#fff" }}>{preset.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.66, marginTop: 3 }}>{preset.description}</div>
                </button>
              ))}
            </div>
            <button
              onClick={handleNewBuild}
              style={{ ...primaryButtonStyle, width: "100%", marginTop: 14 }}
            >
              Build From Scratch
            </button>
          </div>
        )}

        {mode === "build" && (
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
            {activePreset && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "rgba(56, 189, 248, 0.12)",
                  border: "1px solid rgba(56, 189, 248, 0.25)",
                  color: "#c7f0ff",
                  fontSize: 12,
                }}
              >
                Editing preset: <strong>{activePreset.name}</strong>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 12 }}>
              {TOOL_OPTIONS.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => setToolMode(tool.id)}
                  style={{
                    ...secondaryButtonStyle,
                    padding: "9px 0",
                    background: toolMode === tool.id ? "rgba(14, 165, 233, 0.28)" : "rgba(255,255,255,0.06)",
                    borderColor: toolMode === tool.id ? "rgba(56,189,248,0.45)" : "rgba(255,255,255,0.08)",
                    color: toolMode === tool.id ? "#e0f7ff" : "#d7def2",
                  }}
                >
                  {tool.label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button onClick={handleUndo} disabled={undoStack.length === 0} style={smallActionButton(undoStack.length > 0)}>
                Undo
              </button>
              <button onClick={handleRedo} disabled={redoStack.length === 0} style={smallActionButton(redoStack.length > 0)}>
                Redo
              </button>
              <button
                onClick={() => setShowJson((value) => !value)}
                style={smallActionButton(true)}
              >
                {showJson ? "Hide JSON" : "JSON"}
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
                marginBottom: 12,
                fontSize: 12,
              }}
            >
              <StatCard label="Blocks" value={String(blockCount)} />
              <StatCard label="Connections" value={String(connectionCount)} />
            </div>

            {toolMode === "place" && (
              <>
                <div style={{ marginBottom: 10, fontSize: 12, opacity: 0.78 }}>
                  Hover to preview anchors. Use <code>[</code> and <code>]</code> to rotate before placing.
                </div>
                <div
                  style={{
                    marginBottom: 10,
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.56, letterSpacing: 0.7 }}>
                    Placement
                  </div>
                  <div style={{ marginTop: 4, fontWeight: 700, color: "#fff" }}>
                    {paletteItems.find((item) => item.id === selectedType)?.label ?? selectedType}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    Rotation: <strong>{normalizeAngle(placementRotationDeg)}°</strong>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    <button
                      onClick={() => setPlacementRotationDeg((value) => value - (placementStepDeg || 5))}
                      style={smallActionButton(true)}
                    >
                      - Step
                    </button>
                    <button
                      onClick={() => setPlacementRotationDeg((value) => value + (placementStepDeg || 5))}
                      style={smallActionButton(true)}
                    >
                      + Step
                    </button>
                    <button
                      onClick={() => setPlacementRotationDeg(0)}
                      style={smallActionButton(true)}
                    >
                      Reset
                    </button>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11, opacity: 0.62 }}>
                    Angle Snap
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    {ROTATION_STEPS.map((step) => (
                      <button
                        key={step}
                        onClick={() => setPlacementStepDeg(step)}
                        style={{
                          ...chipButtonStyle,
                          background: placementStepDeg === step ? "rgba(56,189,248,0.24)" : "rgba(255,255,255,0.06)",
                          borderColor: placementStepDeg === step ? "rgba(56,189,248,0.4)" : "rgba(255,255,255,0.08)",
                          color: placementStepDeg === step ? "#dff6ff" : "#d7def2",
                        }}
                      >
                        {step === 0 ? "Free" : `${step}°`}
                      </button>
                    ))}
                  </div>
                </div>

                <input
                  value={partQuery}
                  onChange={(e) => setPartQuery(e.target.value)}
                  placeholder="Search parts, ids, categories..."
                  style={searchInputStyle}
                />

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    marginTop: 10,
                    overflowY: "auto",
                    minHeight: 0,
                    flex: 1,
                    paddingRight: 4,
                  }}
                >
                  {groupedPalette.map(([category, items]) => (
                    <div key={category}>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, opacity: 0.56, marginBottom: 6 }}>
                        {category}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {items.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => setSelectedType(item.id)}
                            style={{
                              ...cardButtonStyle,
                              padding: "9px 10px",
                              background: selectedType === item.id ? "rgba(14, 165, 233, 0.22)" : "rgba(255,255,255,0.05)",
                              borderColor: selectedType === item.id ? "rgba(56,189,248,0.34)" : "rgba(255,255,255,0.08)",
                            }}
                          >
                            <div style={{ fontWeight: 600, color: "#fff" }}>{item.label}</div>
                            <div style={{ fontSize: 11, opacity: 0.52 }}>{item.id}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {toolMode !== "place" && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  fontSize: 12,
                  lineHeight: 1.6,
                }}
              >
                {toolMode === "select" && "Click a block to inspect it. Anchors stay visible on the selected block."}
                {toolMode === "move" && "Click a block, then drag the gizmo to reposition it. Use local or world space in the inspector."}
                {toolMode === "rotate" && "Click a block, then drag the gizmo to rotate it. Use the numeric inspector for precise angles."}
              </div>
            )}

            {controlMap && (
              <>
                <button
                  onClick={() => setShowControls((value) => !value)}
                  style={{ ...secondaryButtonStyle, width: "100%", marginTop: 12 }}
                >
                  {showControls ? "Hide Controls" : "Show Controls"}
                </button>
                {showControls && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
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

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={handlePlay} style={{ ...primaryButtonStyle, flex: 1 }}>
                Play
              </button>
              <button onClick={handleGallery} style={{ ...secondaryButtonStyle, flex: 1 }}>
                Gallery
              </button>
            </div>
          </div>
        )}

        {mode === "play" && (
          <div style={{ overflowY: "auto", paddingRight: 4 }}>
            {activePreset && (
              <h3 style={{ margin: "0 0 8px", fontSize: 16, color: "#fff" }}>{activePreset.name}</h3>
            )}
            <div style={{ fontSize: 12, opacity: 0.76, lineHeight: 1.6 }}>
              {!physicsReady ? "Initializing Rapier..." : "Simulation running."}
              <br />
              {!inputsEnabled
                ? "Runtime inputs are disabled. The machine should stay idle unless physics moves it."
                : !activePreset
                  ? "Q / E spin hinges and motors. Space fires thrusters."
                  : "Preset auto-input is active."}
            </div>
            <button
              onClick={() => setInputsEnabled((value) => !value)}
              style={{
                ...secondaryButtonStyle,
                width: "100%",
                marginTop: 12,
                background: inputsEnabled ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.14)",
                borderColor: inputsEnabled ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.22)",
                color: inputsEnabled ? "#bbf7d0" : "#fecaca",
              }}
            >
              {inputsEnabled ? "Disable Runtime Inputs" : "Enable Runtime Inputs"}
            </button>
            {!firstPerson && controlMap && (
              <>
                <button
                  onClick={() => setShowControls((value) => !value)}
                  style={{ ...secondaryButtonStyle, width: "100%", marginTop: 12 }}
                >
                  {showControls ? "Hide Controls" : "Show Controls"}
                </button>
                {showControls && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
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
            <button
              onClick={() => setShowJson((value) => !value)}
              style={{ ...smallActionButton(true), width: "100%", marginTop: 12 }}
            >
              {showJson ? "Hide JSON" : "Show JSON"}
            </button>
            <button
              onClick={() => setFirstPerson((value) => !value)}
              style={{ ...secondaryButtonStyle, width: "100%", marginTop: 8 }}
            >
              {firstPerson ? "Exit First Person" : "Enter First Person"}
            </button>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={handleStop} style={{ ...primaryButtonStyle, flex: 1, background: "#dc2626" }}>
                Stop
              </button>
              <button onClick={handleGallery} style={{ ...secondaryButtonStyle, flex: 1 }}>
                Gallery
              </button>
            </div>
          </div>
        )}
      </div>

      {mode === "build" && !jsonPanelVisible && (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            zIndex: 10,
            width: 340,
            color: "#eef2ff",
            background: "rgba(8, 12, 20, 0.9)",
            borderRadius: 16,
            backdropFilter: "blur(16px)",
            border: "1px solid rgba(244, 114, 182, 0.14)",
            boxShadow: "0 18px 48px rgba(0,0,0,0.28)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, opacity: 0.58 }}>
              Inspector
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginTop: 4 }}>
              {selectedDefinition?.name ?? "Nothing selected"}
            </div>
            <div style={{ fontSize: 12, opacity: 0.62, marginTop: 2 }}>
              {selectedNode ? `${selectedNode.id} · ${selectedNode.typeId}` : "Select a block to edit it directly."}
            </div>
          </div>

          {selectedNode && inspectorDraft ? (
            <div style={{ padding: 16 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button
                  onClick={() => setTransformSpace("local")}
                  style={{
                    ...chipButtonStyle,
                    flex: 1,
                    background: transformSpace === "local" ? "rgba(14, 165, 233, 0.22)" : "rgba(255,255,255,0.06)",
                  }}
                >
                  Local
                </button>
                <button
                  onClick={() => setTransformSpace("world")}
                  style={{
                    ...chipButtonStyle,
                    flex: 1,
                    background: transformSpace === "world" ? "rgba(14, 165, 233, 0.22)" : "rgba(255,255,255,0.06)",
                  }}
                >
                  World
                </button>
              </div>

              <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.56, marginBottom: 6 }}>Position</div>
              <TransformFieldRow
                values={[inspectorDraft.px, inspectorDraft.py, inspectorDraft.pz]}
                onChange={(next) =>
                  setInspectorDraft((draft) =>
                    draft ? { ...draft, px: next[0], py: next[1], pz: next[2] } : draft,
                  )
                }
              />

              <div style={{ display: "flex", gap: 6, marginTop: 8, marginBottom: 12 }}>
                <button onClick={() => nudgeSelected("position", "x", -0.1)} style={smallActionButton(true)}>
                  -X
                </button>
                <button onClick={() => nudgeSelected("position", "x", 0.1)} style={smallActionButton(true)}>
                  +X
                </button>
                <button onClick={() => nudgeSelected("position", "y", 0.1)} style={smallActionButton(true)}>
                  +Y
                </button>
                <button onClick={() => nudgeSelected("position", "z", 0.1)} style={smallActionButton(true)}>
                  +Z
                </button>
              </div>

              <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.56, marginBottom: 6 }}>Rotation</div>
              <TransformFieldRow
                values={[inspectorDraft.rx, inspectorDraft.ry, inspectorDraft.rz]}
                onChange={(next) =>
                  setInspectorDraft((draft) =>
                    draft ? { ...draft, rx: next[0], ry: next[1], rz: next[2] } : draft,
                  )
                }
                suffix="°"
              />

              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button onClick={() => nudgeSelected("rotation", "x", -5)} style={smallActionButton(true)}>
                  -5° X
                </button>
                <button onClick={() => nudgeSelected("rotation", "y", 5)} style={smallActionButton(true)}>
                  +5° Y
                </button>
                <button onClick={() => nudgeSelected("rotation", "z", 5)} style={smallActionButton(true)}>
                  +5° Z
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
                <button onClick={applyDraftTransform} style={{ ...primaryButtonStyle, width: "100%" }}>
                  Apply
                </button>
                <button
                  onClick={() => selectedNode && setInspectorDraft(transformToDraft(selectedNode.transform))}
                  style={{ ...secondaryButtonStyle, width: "100%" }}
                >
                  Reset
                </button>
              </div>

              {inspectorError && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: "rgba(220,38,38,0.14)",
                    border: "1px solid rgba(248,113,113,0.22)",
                    color: "#fecaca",
                    fontSize: 12,
                  }}
                >
                  {inspectorError}
                </div>
              )}

              <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7, lineHeight: 1.6 }}>
                Anchors: {selectedDefinition?.anchors.length ?? 0}
                <br />
                Connections: {selectedConnections.length}
              </div>

              {selectedNode.id !== "origin" && (
                <button
                  onClick={deleteSelectedBlock}
                  style={{ ...secondaryButtonStyle, width: "100%", marginTop: 14, color: "#fecaca", borderColor: "rgba(248,113,113,0.2)" }}
                >
                  Delete Block
                </button>
              )}
            </div>
          ) : (
            <div style={{ padding: 16, fontSize: 12, lineHeight: 1.7, opacity: 0.76 }}>
              {snapResult ? (
                <>
                  <div style={{ color: "#fff", fontWeight: 700, marginBottom: 6 }}>Snap Preview</div>
                  Target: <strong>{snapResult.target.blockId}</strong>
                  <br />
                  Target anchor: <strong>{snapResult.target.anchor.id}</strong>
                  <br />
                  Source anchor: <strong>{snapResult.sourceAnchor.id}</strong>
                  <br />
                  Angle error: {snapResult.angleErrorDeg.toFixed(1)}°
                  <br />
                  Travel: {snapResult.travelDistance.toFixed(2)}
                </>
              ) : (
                <>
                  Shortcuts:
                  <br />
                  1-4 switch tools
                  <br />
                  [ / ] rotate placement preview
                  <br />
                  Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z redo
                  <br />
                  Delete removes the current selection
                </>
              )}
            </div>
          )}
        </div>
      )}

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
            background: "rgba(4, 8, 16, 0.92)",
            borderRadius: 16,
            backdropFilter: "blur(16px)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Machine Graph JSON</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              {mode === "build"
                ? "Edit the graph and apply it back into the builder."
                : "Edit the graph and restart the current simulation."}
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
              }}
            >
              {jsonError}
            </div>
          )}
          <div style={{ padding: "8px 16px 12px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <button onClick={handleApplyJson} style={{ ...primaryButtonStyle, width: "100%" }}>
              Apply Changes
            </button>
          </div>
        </div>
      )}

      {!jsonPanelVisible && (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: mode === "build" ? 372 : 16,
            zIndex: 10,
            padding: "8px 16px",
            borderRadius: 999,
            background:
              mode === "gallery"
                ? "rgba(255,255,255,0.14)"
                : mode === "build"
                  ? "rgba(14,165,233,0.8)"
                  : "rgba(34,197,94,0.8)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.8,
            backdropFilter: "blur(10px)",
          }}
        >
          {mode === "gallery" ? "GALLERY" : mode === "build" ? "BUILD MODE" : "PLAY MODE"}
        </div>
      )}

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

      <Canvas
        camera={{ position: cameraPos, fov: 50 }}
        shadows
        style={{ background: "linear-gradient(180deg, #152238 0%, #0b1020 100%)" }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[8, 12, 6]} intensity={1.1} castShadow />
        <Environment preset="city" />
        {!(mode === "play" && firstPerson) && <OrbitControls makeDefault enabled={!isTransformDragging} />}

        {(mode === "gallery" || mode === "build") && (
          <Grid
            args={[40, 40]}
            cellSize={1}
            sectionSize={5}
            fadeDistance={40}
            cellColor="#24415c"
            sectionColor="#406080"
            position={[0, -0.5, 0]}
          />
        )}

        {mode === "build" && (
          <>
            <SnapScene
              graph={graph}
              catalog={catalog}
              selectedType={selectedType}
              selectedNodeId={selectedNodeId}
              toolMode={toolMode}
              previewRotationDeg={placementRotationDeg}
              onGraphChange={(nextGraph) => applyBuildGraph(nextGraph)}
              onSelectionChange={setSelectedNodeId}
              onSnapChange={setSnapResult}
            />

            {selectedNode && (toolMode === "move" || toolMode === "rotate") && (
              <>
                <group
                  ref={transformHandleRef}
                  position={[
                    selectedNode.transform.position.x,
                    selectedNode.transform.position.y,
                    selectedNode.transform.position.z,
                  ]}
                  quaternion={[
                    selectedNode.transform.rotation.x,
                    selectedNode.transform.rotation.y,
                    selectedNode.transform.rotation.z,
                    selectedNode.transform.rotation.w,
                  ]}
                >
                  <mesh visible={false}>
                    <boxGeometry args={[0.001, 0.001, 0.001]} />
                    <meshBasicMaterial transparent opacity={0} />
                  </mesh>
                </group>

                <TransformControls
                  key={`${selectedNode.id}:${toolMode}`}
                  object={transformHandleRef}
                  mode={toolMode === "move" ? "translate" : "rotate"}
                  space={transformSpace}
                  onMouseDown={beginTransformDrag}
                  onMouseUp={endTransformDrag}
                  onChange={handleTransformObjectChange}
                  onObjectChange={handleTransformObjectChange}
                />
              </>
            )}
          </>
        )}

        {mode === "play" && playGraph && (
          <PhysicsScene
            graph={playGraph}
            catalog={catalog}
            inputState={effectiveInput}
            controlMap={inputsEnabled ? controlMap ?? undefined : undefined}
            keysDownRef={inputsEnabled ? keysDown : undefined}
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

function TransformFieldRow({
  values,
  onChange,
  suffix,
}: {
  values: [string, string, string];
  onChange: (next: [string, string, string]) => void;
  suffix?: string;
}) {
  const labels = ["X", "Y", "Z"] as const;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
      {labels.map((label, index) => (
        <label key={label} style={{ fontSize: 11, opacity: 0.86 }}>
          <div style={{ marginBottom: 4 }}>{label}</div>
          <div style={{ position: "relative" }}>
            <input
              value={values[index]}
              onChange={(e) => {
                const next = [...values] as [string, string, string];
                next[index] = e.target.value;
                onChange(next);
              }}
              style={transformInputStyle}
            />
            {suffix && (
              <span style={{ position: "absolute", right: 8, top: 9, fontSize: 11, opacity: 0.46 }}>
                {suffix}
              </span>
            )}
          </div>
        </label>
      ))}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.56, letterSpacing: 0.7 }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 18, fontWeight: 700, color: "#fff" }}>{value}</div>
    </div>
  );
}

function transformToDraft(transformValue: Transform): TransformDraft {
  const rotation = quatToEulerDegrees(transformValue.rotation);
  return {
    px: transformValue.position.x.toFixed(2),
    py: transformValue.position.y.toFixed(2),
    pz: transformValue.position.z.toFixed(2),
    rx: rotation.x.toFixed(1),
    ry: rotation.y.toFixed(1),
    rz: rotation.z.toFixed(1),
  };
}

function parseDraftTransform(draft: TransformDraft): { ok: true; transform: Transform } | { ok: false; error: string } {
  const numbers = [draft.px, draft.py, draft.pz, draft.rx, draft.ry, draft.rz].map((value) => Number(value));
  if (numbers.some((value) => Number.isNaN(value) || !Number.isFinite(value))) {
    return { ok: false, error: "Every transform field must be a valid finite number." };
  }
  return {
    ok: true,
    transform: {
      position: vec3(numbers[0]!, numbers[1]!, numbers[2]!),
      rotation: eulerDegreesToQuat({ x: numbers[3]!, y: numbers[4]!, z: numbers[5]! }),
    },
  };
}

function quatToEulerDegrees(rotation: Transform["rotation"]): { x: number; y: number; z: number } {
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    "XYZ",
  );
  return {
    x: radToDeg(euler.x),
    y: radToDeg(euler.y),
    z: radToDeg(euler.z),
  };
}

function eulerDegreesToQuat(rotation: { x: number; y: number; z: number }) {
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(degToRad(rotation.x), degToRad(rotation.y), degToRad(rotation.z), "XYZ"),
  );
  return {
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w,
  };
}

function normalizeAngle(value: number): number {
  let normalized = value % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}

const primaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(14,165,233,0.28)",
  background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)",
  color: "#fff",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 700,
};

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.06)",
  color: "#eef2ff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const chipButtonStyle: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.06)",
  color: "#eef2ff",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 600,
};

const cardButtonStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.05)",
  color: "#eef2ff",
  cursor: "pointer",
  textAlign: "left",
};

const searchInputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "#fff",
  padding: "10px 12px",
  outline: "none",
  fontSize: 13,
};

const transformInputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "#fff",
  padding: "8px 28px 8px 10px",
  outline: "none",
  fontSize: 12,
};

function smallActionButton(enabled: boolean): CSSProperties {
  return {
    ...secondaryButtonStyle,
    padding: "8px 10px",
    fontSize: 12,
    opacity: enabled ? 1 : 0.45,
    cursor: enabled ? "pointer" : "not-allowed",
  };
}
