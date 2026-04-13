import { Canvas } from "@react-three/fiber";
import { Environment, Grid, OrbitControls, TransformControls } from "@react-three/drei";
import { useState, useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import * as THREE from "three";
import {
  ActuatorEntry,
  applyMachineControls,
  BlockCatalog,
  BlockGraph,
  BuilderJointMotorOverrides,
  compileMachineEnvelope,
  compileMachinePlan,
  ControlMap,
  createMachineControlsFromControlMap,
  degToRad,
  generateControlMap,
  makeId,
  MachinePlan,
  MachineControls,
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
type BuildSidebarTab = "placement" | "controls" | "parts";
type TransformSpace = "local" | "world";
type PlacementMode = "manual" | "auto_orient";
type MirrorPlaneAxis = "x" | "y" | "z";

interface TransformDraft {
  px: string;
  py: string;
  pz: string;
  rx: string;
  ry: string;
  rz: string;
}

interface PlacementRotation {
  x: number;
  y: number;
  z: number;
}

interface MotorDraft {
  targetPositionDeg: string;
  targetVelocityDeg: string;
  stiffness: string;
  damping: string;
  maxForce: string;
}

interface DragSelectionSnapshot {
  pivot: THREE.Vector3;
  handlePosition: THREE.Vector3;
  handleQuaternion: THREE.Quaternion;
  nodes: Array<{
    id: string;
    position: THREE.Vector3;
    rotation: THREE.Quaternion;
  }>;
}

interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PersistedBuilderDraft {
  version: 1;
  graph: SerializedBlockGraph;
  controls?: MachineControls;
  activePresetName: string | null;
  selectedType: string;
  toolMode: BuilderTool;
  transformSpace: TransformSpace;
  placementRotation: PlacementRotation;
  placementStepDeg: number;
  placementMode: PlacementMode;
  activeSourceAnchorId: string | null;
  activeSnapCandidateIndex: number;
  translationSnap: number;
  rotationSnapDeg: number;
  mirrorPlaneAxis: MirrorPlaneAxis;
  mirrorPlaneOffset: number;
  selectedNodeIds: string[];
}

const BUILDER_DRAFT_STORAGE_KEY = "snap-machines-demo:builder-draft";
const BUILDER_DRAFT_VERSION = 1 as const;

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
    const shouldResetTarget = entry.actuatorType === "position" && previous.defaultTarget !== entry.defaultTarget;
    return {
      ...entry,
      positiveKey: previous.positiveKey,
      negativeKey: previous.negativeKey,
      enabled: previous.enabled,
      scale: previous.scale,
      currentTarget: entry.actuatorType === "position" && !shouldResetTarget
        ? previous.currentTarget
        : entry.currentTarget,
    };
  });
}

function createFreshGraph(): BlockGraph {
  const g = new BlockGraph();
  g.addNode({ id: "origin", typeId: "frame.cube.1", transform: TRANSFORM_IDENTITY });
  return g;
}

function clearPersistedBuilderDraft() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(BUILDER_DRAFT_STORAGE_KEY);
}

function getPresetByName(name: string | null): MachinePreset | null {
  if (!name) return null;
  return MACHINE_PRESETS.find((preset) => preset.name === name) ?? null;
}

export function App() {
  const [selectedType, setSelectedType] = useState("frame.cube.1");
  const [mode, setMode] = useState<Mode>("gallery");
  const [toolMode, setToolMode] = useState<BuilderTool>("place");
  const [buildSidebarTab, setBuildSidebarTab] = useState<BuildSidebarTab>("parts");
  const [transformSpace, setTransformSpace] = useState<TransformSpace>("local");
  const [placementRotation, setPlacementRotation] = useState<PlacementRotation>({ x: 0, y: 0, z: 0 });
  const [placementStepDeg, setPlacementStepDeg] = useState<number>(15);
  const [placementMode, setPlacementMode] = useState<PlacementMode>("manual");
  const [activeSourceAnchorId, setActiveSourceAnchorId] = useState<string | null>(null);
  const [activeSnapCandidateIndex, setActiveSnapCandidateIndex] = useState(0);
  const [snapCandidateCount, setSnapCandidateCount] = useState(0);
  const [translationSnap, setTranslationSnap] = useState<number>(0.25);
  const [rotationSnapDeg, setRotationSnapDeg] = useState<number>(15);
  const [mirrorPlaneAxis, setMirrorPlaneAxis] = useState<MirrorPlaneAxis>("x");
  const [mirrorPlaneOffset, setMirrorPlaneOffset] = useState(0);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const [partQuery, setPartQuery] = useState("");
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [snapResult, setSnapResult] = useState<SnapResult | null>(null);
  const [physicsReady, setPhysicsReady] = useState(false);
  const [firstPerson, setFirstPerson] = useState(false);
  const [inputsEnabled, setInputsEnabled] = useState(true);
  const [activePreset, setActivePreset] = useState<MachinePreset | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [controlMap, setControlMap] = useState<ControlMap | null>(null);
  const [savedControls, setSavedControls] = useState<MachineControls | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [hoveredEntry, setHoveredEntry] = useState<{ blockId: string; id: string } | null>(null);
  const [undoStack, setUndoStack] = useState<SerializedBlockGraph[]>([]);
  const [redoStack, setRedoStack] = useState<SerializedBlockGraph[]>([]);
  const [inspectorDraft, setInspectorDraft] = useState<TransformDraft | null>(null);
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [motorDraft, setMotorDraft] = useState<MotorDraft | null>(null);
  const [motorDraftError, setMotorDraftError] = useState<string | null>(null);
  const [isTransformDragging, setIsTransformDragging] = useState(false);
  const [isMarqueeGestureActive, setIsMarqueeGestureActive] = useState(false);
  const [hasPersistedDraft, setHasPersistedDraft] = useState(false);

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
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const suppressSceneSelectionUntilRef = useRef(0);
  const marqueeRaycasterRef = useRef(new THREE.Raycaster());
  const marqueePointerRef = useRef(new THREE.Vector2());
  const builderDraftHydratedRef = useRef(false);

  const selectedNodeId = selectedNodeIds[0] ?? null;
  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const selectedNodeIdsRef = useRef<string[]>(selectedNodeIds);
  selectedNodeIdsRef.current = selectedNodeIds;

  const [playGraph, setPlayGraph] = useState<BlockGraph | null>(null);
  const transformHandleRef = useRef<THREE.Group>(null);
  const dragStartSnapshotRef = useRef<SerializedBlockGraph | null>(null);
  const dragSelectionSnapshotRef = useRef<DragSelectionSnapshot | null>(null);
  const dragHandleTransformRef = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>(null);

  const selectedNode = useMemo(
    () => (selectedNodeId ? graph.getNode(selectedNodeId) ?? null : null),
    [graph, selectedNodeId],
  );
  const selectedNodes = useMemo(
    () =>
      selectedNodeIds
        .map((id) => graph.getNode(id))
        .filter((node): node is NonNullable<typeof node> => node != null),
    [graph, selectedNodeIds],
  );
  const isMultiSelection = selectedNodes.length > 1;
  const selectedDefinition = useMemo(
    () => (selectedNode ? catalog.get(selectedNode.typeId) : null),
    [catalog, selectedNode],
  );
  const selectedActuatorEntries = useMemo(
    () => (
      selectedNode && controlMap
        ? controlMap.filter((entry) => entry.blockId === selectedNode.id)
        : []
    ),
    [controlMap, selectedNode],
  );
  const selectedJointActuator = useMemo(
    () => selectedActuatorEntries.find((entry) => entry.id.startsWith("joint:")) ?? null,
    [selectedActuatorEntries],
  );
  const buildPreviewJointAngles = useMemo(() => {
    if (mode !== "build" || toolMode === "place" || !controlMap) {
      return {};
    }

    const previewAngles: Record<string, number> = {};
    for (const entry of controlMap) {
      if (!entry.id.startsWith("joint:")) continue;
      if (entry.actuatorType !== "position") continue;
      previewAngles[entry.blockId] = entry.defaultTarget ?? entry.targetPosition ?? 0;
    }

    if (selectedJointActuator && motorDraft) {
      const parsed = parseMotorDraft(motorDraft);
      if (parsed.ok && selectedNode) {
        previewAngles[selectedNode.id] = parsed.overrides.targetPosition ?? previewAngles[selectedNode.id] ?? 0;
      }
    }

    return previewAngles;
  }, [controlMap, mode, motorDraft, selectedJointActuator, selectedNode, toolMode]);
  const placementDefinition = useMemo(
    () => catalog.get(selectedType),
    [catalog, selectedType],
  );
  const placementAnchors = placementDefinition.anchors;
  const selectedConnections = useMemo(
    () => selectedNodes.flatMap((node) => graph.getConnectionsForBlock(node.id)),
    [graph, selectedNodes],
  );
  const selectionCentroid = useMemo(() => {
    if (selectedNodes.length === 0) return null;
    const total = selectedNodes.reduce(
      (acc, node) => {
        acc.x += node.transform.position.x;
        acc.y += node.transform.position.y;
        acc.z += node.transform.position.z;
        return acc;
      },
      { x: 0, y: 0, z: 0 },
    );
    const scale = 1 / selectedNodes.length;
    return vec3(total.x * scale, total.y * scale, total.z * scale);
  }, [selectedNodes]);
  const effectiveTransformSpace: TransformSpace = isMultiSelection ? "world" : transformSpace;
  const selectionHandleTransform = useMemo(() => {
    if (selectedNodes.length === 0) return null;
    if (isTransformDragging && dragHandleTransformRef.current) {
      const dragHandle = dragHandleTransformRef.current;
      return {
        position: vec3(dragHandle.position.x, dragHandle.position.y, dragHandle.position.z),
        rotation: {
          x: dragHandle.quaternion.x,
          y: dragHandle.quaternion.y,
          z: dragHandle.quaternion.z,
          w: dragHandle.quaternion.w,
        },
      };
    }
    if (selectedNodes.length === 1) {
      return selectedNodes[0]!.transform;
    }
    if (!selectionCentroid) return null;
    return {
      position: selectionCentroid,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    };
  }, [isTransformDragging, selectedNodes, selectionCentroid]);

  const blockCount = graph.listNodes().length;
  const connectionCount = graph.listConnections().length;

  const graphToJsonText = useCallback((g: BlockGraph) => JSON.stringify(g.toJSON(), null, 2), []);

  const restoreBuildState = useCallback(
    (nextGraph: BlockGraph, preset: MachinePreset | null, draft: PersistedBuilderDraft) => {
      const nextSelectedNodeIds = draft.selectedNodeIds.filter((id) => nextGraph.getNode(id));
      setGraph(nextGraph);
      setActivePreset(preset);
      setSelectedType(demoCatalog.some((definition) => definition.id === draft.selectedType) ? draft.selectedType : "frame.cube.1");
      setToolMode(draft.toolMode);
      setTransformSpace(draft.transformSpace);
      setPlacementRotation(draft.placementRotation);
      setPlacementStepDeg(draft.placementStepDeg);
      setPlacementMode(draft.placementMode);
      setActiveSourceAnchorId(draft.activeSourceAnchorId);
      setActiveSnapCandidateIndex(draft.activeSnapCandidateIndex);
      setTranslationSnap(draft.translationSnap);
      setRotationSnapDeg(draft.rotationSnapDeg);
      setMirrorPlaneAxis(draft.mirrorPlaneAxis);
      setMirrorPlaneOffset(draft.mirrorPlaneOffset);
      setSelectedNodeIds(nextSelectedNodeIds);
      setSnapResult(null);
      setUndoStack([]);
      setRedoStack([]);
      setPlayGraph(null);
      setPhysicsReady(false);
      setFirstPerson(false);
      setInputsEnabled(true);
      setControlMap(null);
      setSavedControls(normalizePersistedMachineControls(draft.controls) ?? null);
      setShowControls(true);
      setHoveredEntry(null);
      setJsonError(null);
      setShowJson(false);
      setMode("build");
    },
    [],
  );

  useEffect(() => {
    if (builderDraftHydratedRef.current) return;

    try {
      const raw = window.localStorage.getItem(BUILDER_DRAFT_STORAGE_KEY);
      if (!raw) {
        setHasPersistedDraft(false);
        return;
      }

      const parsed = JSON.parse(raw) as PersistedBuilderDraft;
      if (!isRecord(parsed) || parsed.version !== BUILDER_DRAFT_VERSION || !("graph" in parsed)) {
        clearPersistedBuilderDraft();
        setHasPersistedDraft(false);
        return;
      }

      const nextGraph = BlockGraph.fromJSON(parsed.graph);
      const validation = nextGraph.validateAgainstCatalog(catalog);
      if (!validation.ok) {
        clearPersistedBuilderDraft();
        setHasPersistedDraft(false);
        return;
      }

      restoreBuildState(nextGraph, getPresetByName(typeof parsed.activePresetName === "string" ? parsed.activePresetName : null), {
        version: BUILDER_DRAFT_VERSION,
        graph: parsed.graph,
        controls: normalizePersistedMachineControls(parsed.controls),
        activePresetName: typeof parsed.activePresetName === "string" ? parsed.activePresetName : null,
        selectedType: typeof parsed.selectedType === "string" ? parsed.selectedType : "frame.cube.1",
        toolMode: parsed.toolMode === "select" || parsed.toolMode === "move" || parsed.toolMode === "rotate" ? parsed.toolMode : "place",
        transformSpace: parsed.transformSpace === "world" ? "world" : "local",
        placementRotation: isRecord(parsed.placementRotation)
          ? {
              x: typeof parsed.placementRotation.x === "number" ? parsed.placementRotation.x : 0,
              y: typeof parsed.placementRotation.y === "number" ? parsed.placementRotation.y : 0,
              z: typeof parsed.placementRotation.z === "number" ? parsed.placementRotation.z : 0,
            }
          : { x: 0, y: 0, z: 0 },
        placementStepDeg: typeof parsed.placementStepDeg === "number" ? parsed.placementStepDeg : 15,
        placementMode: parsed.placementMode === "auto_orient" ? "auto_orient" : "manual",
        activeSourceAnchorId: typeof parsed.activeSourceAnchorId === "string" ? parsed.activeSourceAnchorId : null,
        activeSnapCandidateIndex: typeof parsed.activeSnapCandidateIndex === "number" ? parsed.activeSnapCandidateIndex : 0,
        translationSnap: typeof parsed.translationSnap === "number" ? parsed.translationSnap : 0.25,
        rotationSnapDeg: typeof parsed.rotationSnapDeg === "number" ? parsed.rotationSnapDeg : 15,
        mirrorPlaneAxis: parsed.mirrorPlaneAxis === "y" || parsed.mirrorPlaneAxis === "z" ? parsed.mirrorPlaneAxis : "x",
        mirrorPlaneOffset: typeof parsed.mirrorPlaneOffset === "number" ? parsed.mirrorPlaneOffset : 0,
        selectedNodeIds: Array.isArray(parsed.selectedNodeIds)
          ? parsed.selectedNodeIds.filter((id): id is string => typeof id === "string")
          : [],
      });
      setHasPersistedDraft(true);
    } catch {
      clearPersistedBuilderDraft();
      setHasPersistedDraft(false);
    } finally {
      builderDraftHydratedRef.current = true;
    }
  }, [catalog, restoreBuildState]);

  useEffect(() => {
    if (!builderDraftHydratedRef.current || mode === "gallery") return;

    const draft: PersistedBuilderDraft = {
      version: BUILDER_DRAFT_VERSION,
      graph: graph.toJSON(),
      controls: controlMap ? createMachineControlsFromControlMap(controlMap) : (savedControls ?? undefined),
      activePresetName: activePreset?.name ?? null,
      selectedType,
      toolMode,
      transformSpace,
      placementRotation,
      placementStepDeg,
      placementMode,
      activeSourceAnchorId,
      activeSnapCandidateIndex,
      translationSnap,
      rotationSnapDeg,
      mirrorPlaneAxis,
      mirrorPlaneOffset,
      selectedNodeIds,
    };

    const saveHandle = window.setTimeout(() => {
      window.localStorage.setItem(BUILDER_DRAFT_STORAGE_KEY, JSON.stringify(draft));
      setHasPersistedDraft(true);
    }, 150);

    return () => window.clearTimeout(saveHandle);
  }, [
    activePreset?.name,
    activeSnapCandidateIndex,
    activeSourceAnchorId,
    controlMap,
    graph,
    mirrorPlaneAxis,
    mirrorPlaneOffset,
    mode,
    placementMode,
    placementRotation,
    placementStepDeg,
    rotationSnapDeg,
    savedControls,
    selectedNodeIds,
    selectedType,
    toolMode,
    transformSpace,
    translationSnap,
  ]);

  useEffect(() => {
    if (!controlMap) return;
    setSavedControls(createMachineControlsFromControlMap(controlMap));
  }, [controlMap]);

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
    const withSavedControls = savedControls ? applyMachineControls(nextMap, savedControls) : nextMap;
    setControlMap((previous) => mergeControlMapSettings(withSavedControls, previous));
  }, [catalog, graph, mode, savedControls]);

  useEffect(() => {
    if (!selectedNode) {
      setInspectorDraft(null);
      setInspectorError(null);
      return;
    }
    setInspectorDraft(transformToDraft(selectedNode.transform));
    setInspectorError(null);
  }, [selectedNode]);

  useEffect(() => {
    if (!selectedJointActuator) {
      setMotorDraft(null);
      setMotorDraftError(null);
      return;
    }
    setMotorDraft(actuatorToMotorDraft(selectedJointActuator));
    setMotorDraftError(null);
  }, [selectedJointActuator]);

  useEffect(() => {
    setActiveSourceAnchorId(null);
    setActiveSnapCandidateIndex(0);
    setPlacementRotation({ x: 0, y: 0, z: 0 });
  }, [selectedType]);

  useEffect(() => {
    if (!selectionCentroid) return;
    const nextOffset = mirrorPlaneAxis === "x"
      ? selectionCentroid.x
      : mirrorPlaneAxis === "y"
        ? selectionCentroid.y
        : selectionCentroid.z;
    setMirrorPlaneOffset(nextOffset);
  }, [mirrorPlaneAxis, selectionCentroid]);

  useEffect(() => {
    setActiveSnapCandidateIndex(0);
  }, [activeSourceAnchorId, placementMode]);

  useEffect(() => {
    if (snapCandidateCount === 0) {
      setActiveSnapCandidateIndex(0);
      return;
    }
    setActiveSnapCandidateIndex((current) => Math.min(current, snapCandidateCount - 1));
  }, [snapCandidateCount]);

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
        selectionIds?: string[] | null;
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

      if (options && "selectionIds" in options) {
        setSelectedNodeIds(options.selectionIds ?? []);
        return;
      }

      const currentSelection = selectedNodeIdsRef.current.filter((id) => nextGraph.getNode(id));
      setSelectedNodeIds(currentSelection);
    },
    [],
  );

  const resetBuildState = useCallback(
    (nextGraph: BlockGraph, preset: MachinePreset | null) => {
      setGraph(nextGraph);
      setActivePreset(preset);
      setSelectedNodeIds([]);
      setSnapResult(null);
      setUndoStack([]);
      setRedoStack([]);
      setPlacementRotation({ x: 0, y: 0, z: 0 });
      setPlacementStepDeg(15);
      setPlacementMode("manual");
      setActiveSourceAnchorId(null);
      setActiveSnapCandidateIndex(0);
      setSnapCandidateCount(0);
      setToolMode("place");
      setBuildSidebarTab("parts");
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

  const startPlaySession = useCallback(() => {
    setPlayGraph(graph.clone());
    setPhysicsReady(false);
    setFirstPerson(false);
    setInputsEnabled(true);
    setControlMap(null);
    setShowControls(true);
    setMode("play");
  }, [graph]);

  const handlePlay = useCallback(() => {
    startPlaySession();
  }, [startPlaySession]);

  const handleResetPlay = useCallback(() => {
    startPlaySession();
  }, [startPlaySession]);

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
    setSelectedNodeIds([]);
    setSnapResult(null);
    setControlMap(null);
    setShowControls(true);
    setHoveredEntry(null);
    setShowJson(false);
  }, []);

  const handleClearPersistedDraft = useCallback(() => {
    const confirmed = window.confirm("Clear the locally saved draft and discard the current build session?");
    if (!confirmed) return;
    clearPersistedBuilderDraft();
    setHasPersistedDraft(false);
    setShowJson(false);
    handleGallery();
  }, [handleGallery]);

  const cycleActiveSourceAnchor = useCallback(() => {
    if (placementAnchors.length === 0) return;
    setPlacementMode("manual");
    setActiveSnapCandidateIndex(0);
    setActiveSourceAnchorId((previous) => {
      if (!previous) return placementAnchors[0]!.id;
      const currentIndex = placementAnchors.findIndex((anchor) => anchor.id === previous);
      if (currentIndex === -1) return placementAnchors[0]!.id;
      return placementAnchors[(currentIndex + 1) % placementAnchors.length]!.id;
    });
  }, [placementAnchors]);

  const cycleSnapCandidate = useCallback((direction: 1 | -1) => {
    if (snapCandidateCount <= 1) return;
    setActiveSnapCandidateIndex((current) => {
      const next = current + direction;
      return ((next % snapCandidateCount) + snapCandidateCount) % snapCandidateCount;
    });
  }, [snapCandidateCount]);

  const centerMirrorPlaneToSelection = useCallback(() => {
    if (!selectionCentroid) return;
    setMirrorPlaneOffset(
      mirrorPlaneAxis === "x"
        ? selectionCentroid.x
        : mirrorPlaneAxis === "y"
          ? selectionCentroid.y
          : selectionCentroid.z,
    );
  }, [mirrorPlaneAxis, selectionCentroid]);

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1]!;
      setRedoStack((redoPrev) => [...redoPrev, graphRef.current.toJSON()]);
      const nextGraph = BlockGraph.fromJSON(snapshot);
      setGraph(nextGraph);
      setSelectedNodeIds(selectedNodeIdsRef.current.filter((id) => nextGraph.getNode(id)));
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
      setSelectedNodeIds(selectedNodeIdsRef.current.filter((id) => nextGraph.getNode(id)));
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
        selectionIds: [nodeId],
      });
    },
    [applyBuildGraph],
  );

  const updateSelectedNodeMetadata = useCallback(
    (
      updater: (current: Record<string, unknown> | undefined) => Record<string, unknown> | undefined,
      options?: { recordHistory?: boolean; clearRedo?: boolean },
    ) => {
      const nodeId = selectedNodeIdRef.current;
      if (!nodeId) return;

      const nextGraph = graphRef.current.clone();
      const node = nextGraph.getNode(nodeId);
      if (!node) return;
      node.metadata = updater(isRecord(node.metadata) ? { ...node.metadata } : undefined);
      applyBuildGraph(nextGraph, {
        recordHistory: options?.recordHistory,
        clearRedo: options?.clearRedo,
        selectionIds: [nodeId],
      });
    },
    [applyBuildGraph],
  );

  const deleteSelectedBlock = useCallback(() => {
    const selectedIds = selectedNodeIdsRef.current.filter((id) => id !== "origin");
    if (selectedIds.length === 0) return;
    const nextGraph = graphRef.current.clone();
    for (const nodeId of selectedIds) {
      nextGraph.removeNode(nodeId);
    }
    applyBuildGraph(nextGraph, { selectionIds: [] });
  }, [applyBuildGraph]);

  const duplicateSelectedBlocks = useCallback(() => {
    const selected = selectedNodeIdsRef.current
      .map((id) => graphRef.current.getNode(id))
      .filter((node): node is NonNullable<typeof node> => node != null && node.id !== "origin");
    if (selected.length === 0) return;

    const nextGraph = graphRef.current.clone();
    const oldToNew = new Map<string, string>();
    const offset = new THREE.Vector3(1, 0, 0);

    for (const node of selected) {
      const duplicate = nextGraph.addNode({
        id: makeId("dup"),
        typeId: node.typeId,
        transform: {
          position: vec3(
            node.transform.position.x + offset.x,
            node.transform.position.y + offset.y,
            node.transform.position.z + offset.z,
          ),
          rotation: node.transform.rotation,
        },
        metadata: node.metadata,
      });
      oldToNew.set(node.id, duplicate.id);
    }

    const selectedSet = new Set(selected.map((node) => node.id));
    for (const connection of graphRef.current.listConnections()) {
      if (!selectedSet.has(connection.a.blockId) || !selectedSet.has(connection.b.blockId)) continue;
      nextGraph.addConnection({
        a: { blockId: oldToNew.get(connection.a.blockId)!, anchorId: connection.a.anchorId },
        b: { blockId: oldToNew.get(connection.b.blockId)!, anchorId: connection.b.anchorId },
        metadata: connection.metadata,
      });
    }

    applyBuildGraph(nextGraph, { selectionIds: [...oldToNew.values()] });
  }, [applyBuildGraph]);

  const mirrorSelectedBlocks = useCallback(() => {
    const selected = selectedNodeIdsRef.current
      .map((id) => graphRef.current.getNode(id))
      .filter((node): node is NonNullable<typeof node> => node != null && node.id !== "origin");
    if (selected.length === 0) return;

    const reflection = new THREE.Matrix4().makeScale(
      mirrorPlaneAxis === "x" ? -1 : 1,
      mirrorPlaneAxis === "y" ? -1 : 1,
      mirrorPlaneAxis === "z" ? -1 : 1,
    );
    const nextGraph = graphRef.current.clone();
    const oldToNew = new Map<string, string>();

    for (const node of selected) {
      const position = new THREE.Vector3(node.transform.position.x, node.transform.position.y, node.transform.position.z);
      const mirroredPosition = position.clone();
      if (mirrorPlaneAxis === "x") mirroredPosition.x = 2 * mirrorPlaneOffset - position.x;
      if (mirrorPlaneAxis === "y") mirroredPosition.y = 2 * mirrorPlaneOffset - position.y;
      if (mirrorPlaneAxis === "z") mirroredPosition.z = 2 * mirrorPlaneOffset - position.z;

      const rotation = new THREE.Quaternion(
        node.transform.rotation.x,
        node.transform.rotation.y,
        node.transform.rotation.z,
        node.transform.rotation.w,
      );
      const rotationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(rotation);
      const mirroredRotationMatrix = reflection.clone().multiply(rotationMatrix).multiply(reflection);
      const mirroredRotation = new THREE.Quaternion().setFromRotationMatrix(mirroredRotationMatrix).normalize();

      const duplicate = nextGraph.addNode({
        id: makeId("mirror"),
        typeId: node.typeId,
        transform: {
          position: vec3(mirroredPosition.x, mirroredPosition.y, mirroredPosition.z),
          rotation: {
            x: mirroredRotation.x,
            y: mirroredRotation.y,
            z: mirroredRotation.z,
            w: mirroredRotation.w,
          },
        },
        metadata: node.metadata,
      });
      oldToNew.set(node.id, duplicate.id);
    }

    const selectedSet = new Set(selected.map((node) => node.id));
    for (const connection of graphRef.current.listConnections()) {
      if (!selectedSet.has(connection.a.blockId) || !selectedSet.has(connection.b.blockId)) continue;
      nextGraph.addConnection({
        a: { blockId: oldToNew.get(connection.a.blockId)!, anchorId: connection.a.anchorId },
        b: { blockId: oldToNew.get(connection.b.blockId)!, anchorId: connection.b.anchorId },
        metadata: connection.metadata,
      });
    }

    applyBuildGraph(nextGraph, { selectionIds: [...oldToNew.values()] });
  }, [applyBuildGraph, mirrorPlaneAxis, mirrorPlaneOffset]);

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

  const applyMotorDraft = useCallback(() => {
    if (!selectedJointActuator || !motorDraft) return;

    const parsed = parseMotorDraft(motorDraft);
    if (!parsed.ok) {
      setMotorDraftError(parsed.error);
      return;
    }

    updateSelectedNodeMetadata(
      (current) => withBuilderMotorOverrides(current, parsed.overrides),
    );
    setMotorDraftError(null);
  }, [motorDraft, selectedJointActuator, updateSelectedNodeMetadata]);

  const resetMotorDraft = useCallback(() => {
    if (!selectedJointActuator) return;
    setMotorDraft(actuatorToMotorDraft(selectedJointActuator));
    setMotorDraftError(null);
  }, [selectedJointActuator]);

  const clearMotorOverrides = useCallback(() => {
    if (!selectedJointActuator) return;
    updateSelectedNodeMetadata((current) => withBuilderMotorOverrides(current, null));
    setMotorDraftError(null);
  }, [selectedJointActuator, updateSelectedNodeMetadata]);

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
        applyBuildGraph(nextGraph, { selectionIds: [] });
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

  const handleExportMachine = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText) as SerializedBlockGraph;
      const nextGraph = BlockGraph.fromJSON(parsed);
      const validation = nextGraph.validateAgainstCatalog(catalog);
      if (!validation.ok) {
        setJsonError(validation.errors.join("; "));
        return;
      }

      const envelope = compileMachineEnvelope(nextGraph, catalog, {
        controls: controlMap ? createMachineControlsFromControlMap(controlMap) : undefined,
        metadata: {
          builder: "snap-machines-demo",
          mode,
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
      setJsonError(null);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
    }
  }, [activePreset?.name, catalog, controlMap, jsonText, mode]);

  const handlePlanReady = useCallback(
    (plan: MachinePlan) => {
      const sourceGraph = playGraph ?? graphRef.current;
      const originals = rewritePlanActions(plan);
      const nextMap = generateControlMap(plan, originals, catalog, sourceGraph);
      resetControlMapState(nextMap);
      const withSavedControls = savedControls ? applyMachineControls(nextMap, savedControls) : nextMap;
      setControlMap((previous) => mergeControlMapSettings(withSavedControls, previous));
      setShowControls(true);
    },
    [catalog, playGraph, savedControls],
  );

  const beginTransformDrag = useCallback(() => {
    const handle = transformHandleRef.current;
    const selected = selectedNodeIdsRef.current
      .map((id) => graphRef.current.getNode(id))
      .filter((node): node is NonNullable<typeof node> => node != null);
    if (!handle || selected.length === 0) return;

    const pivot = selected.reduce(
      (acc, node) => acc.add(new THREE.Vector3(node.transform.position.x, node.transform.position.y, node.transform.position.z)),
      new THREE.Vector3(),
    ).multiplyScalar(1 / selected.length);

    dragStartSnapshotRef.current = graphRef.current.toJSON();
    dragHandleTransformRef.current = {
      position: handle.position.clone(),
      quaternion: handle.quaternion.clone(),
    };
    dragSelectionSnapshotRef.current = {
      pivot,
      handlePosition: handle.position.clone(),
      handleQuaternion: handle.quaternion.clone(),
      nodes: selected.map((node) => ({
        id: node.id,
        position: new THREE.Vector3(node.transform.position.x, node.transform.position.y, node.transform.position.z),
        rotation: new THREE.Quaternion(
          node.transform.rotation.x,
          node.transform.rotation.y,
          node.transform.rotation.z,
          node.transform.rotation.w,
        ),
      })),
    };
    setIsTransformDragging(true);
  }, []);

  const handleTransformObjectChange = useCallback(() => {
    const handle = transformHandleRef.current;
    const dragSnapshot = dragSelectionSnapshotRef.current;
    if (!handle || !dragSnapshot) return;

    dragHandleTransformRef.current = {
      position: handle.position.clone(),
      quaternion: handle.quaternion.clone(),
    };

    const nextGraph = graphRef.current.clone();
    if (toolMode === "move") {
      const delta = handle.position.clone().sub(dragSnapshot.handlePosition);
      for (const node of dragSnapshot.nodes) {
        nextGraph.updateNodeTransform(node.id, {
          position: vec3(node.position.x + delta.x, node.position.y + delta.y, node.position.z + delta.z),
          rotation: {
            x: node.rotation.x,
            y: node.rotation.y,
            z: node.rotation.z,
            w: node.rotation.w,
          },
        });
      }
    } else {
      const deltaQuat = handle.quaternion.clone().multiply(dragSnapshot.handleQuaternion.clone().invert()).normalize();
      for (const node of dragSnapshot.nodes) {
        const offset = node.position.clone().sub(dragSnapshot.pivot).applyQuaternion(deltaQuat);
        const nextPosition = dragSnapshot.pivot.clone().add(offset);
        const nextRotation = deltaQuat.clone().multiply(node.rotation).normalize();
        nextGraph.updateNodeTransform(node.id, {
          position: vec3(nextPosition.x, nextPosition.y, nextPosition.z),
          rotation: {
            x: nextRotation.x,
            y: nextRotation.y,
            z: nextRotation.z,
            w: nextRotation.w,
          },
        });
      }
    }

    applyBuildGraph(nextGraph, {
      recordHistory: false,
      selectionIds: dragSnapshot.nodes.map((node) => node.id),
    });
  }, [applyBuildGraph, toolMode]);

  const endTransformDrag = useCallback(() => {
    setIsTransformDragging(false);
    const snapshot = dragStartSnapshotRef.current;
    dragStartSnapshotRef.current = null;
    dragSelectionSnapshotRef.current = null;
    dragHandleTransformRef.current = null;
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
      keysDown.current.add(e.code);
      setInputState({
        hingeSpin: (keysDown.current.has("KeyE") ? 1 : 0) - (keysDown.current.has("KeyQ") ? 1 : 0),
        throttle: keysDown.current.has("Space") ? 1 : 0,
        motorSpin: (keysDown.current.has("KeyE") ? 1 : 0) - (keysDown.current.has("KeyQ") ? 1 : 0),
      });
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysDown.current.delete(e.code);
      setInputState({
        hingeSpin: (keysDown.current.has("KeyE") ? 1 : 0) - (keysDown.current.has("KeyQ") ? 1 : 0),
        throttle: keysDown.current.has("Space") ? 1 : 0,
        motorSpin: (keysDown.current.has("KeyE") ? 1 : 0) - (keysDown.current.has("KeyQ") ? 1 : 0),
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
      if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelectedBlocks();
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
        setPlacementRotation((value) => ({ ...value, z: value.z - step }));
      }
      if (e.key === "]") {
        e.preventDefault();
        const step = placementStepDeg || 5;
        setPlacementRotation((value) => ({ ...value, z: value.z + step }));
      }
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        setPlacementRotation({ x: 0, y: 0, z: 0 });
      }
      if (e.key === "Tab" && toolMode === "place") {
        e.preventDefault();
        cycleActiveSourceAnchor();
      }
      if (toolMode === "place" && e.key === ",") {
        e.preventDefault();
        cycleSnapCandidate(-1);
      }
      if (toolMode === "place" && e.key === ".") {
        e.preventDefault();
        cycleSnapCandidate(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cycleActiveSourceAnchor, cycleSnapCandidate, deleteSelectedBlock, duplicateSelectedBlocks, handleRedo, handleUndo, mode, placementStepDeg, toolMode]);

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

  const handleSceneSelectionChange = useCallback((nodeId: string | null, options?: { toggle?: boolean }) => {
    if (Date.now() < suppressSceneSelectionUntilRef.current) {
      return;
    }
    if (!nodeId) {
      setSelectedNodeIds([]);
      return;
    }

    setSelectedNodeIds((previous) => {
      if (!options?.toggle) {
        return [nodeId];
      }
      if (previous.includes(nodeId)) {
        return previous.filter((id) => id !== nodeId);
      }
      return [...previous, nodeId];
    });
  }, []);

  const pickNodeIdAtClientPoint = useCallback((clientX: number, clientY: number) => {
    const canvasRect = canvasWrapRef.current?.getBoundingClientRect();
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!canvasRect || !camera || !scene) return null;

    const pointer = marqueePointerRef.current;
    pointer.x = ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
    pointer.y = -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1;

    const raycaster = marqueeRaycasterRef.current;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      const nodeId = findSnapBlockId(hit.object);
      if (nodeId) return nodeId;
    }

    return null;
  }, []);

  const handleCanvasPointerDownCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== "build" || toolMode !== "select" || !e.shiftKey || e.button !== 0) return;
    const canvasRect = canvasWrapRef.current?.getBoundingClientRect();
    const camera = cameraRef.current;
    if (!canvasRect || !camera) return;

    e.preventDefault();
    e.stopPropagation();
    setIsMarqueeGestureActive(true);

    const startX = e.clientX - canvasRect.left;
    const startY = e.clientY - canvasRect.top;
    let dragged = false;
    let latestBounds: MarqueeRect = {
      left: startX,
      top: startY,
      width: 0,
      height: 0,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const currentX = moveEvent.clientX - canvasRect.left;
      const currentY = moveEvent.clientY - canvasRect.top;
      const dx = currentX - startX;
      const dy = currentY - startY;
      if (!dragged && Math.hypot(dx, dy) < 6) {
        return;
      }
      dragged = true;
      latestBounds = {
        left: Math.min(startX, currentX),
        top: Math.min(startY, currentY),
        width: Math.abs(dx),
        height: Math.abs(dy),
      };
      setMarqueeRect(latestBounds);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      setIsMarqueeGestureActive(false);

      if (dragged) {
        const rect = canvasWrapRef.current?.getBoundingClientRect();
        const currentCamera = cameraRef.current;
        if (rect && currentCamera) {
          const bounds = latestBounds;
          const nextIds = graphRef.current.listNodes()
            .filter((node) => {
              const projected = new THREE.Vector3(
                node.transform.position.x,
                node.transform.position.y,
                node.transform.position.z,
              ).project(currentCamera);
              if (projected.z < -1 || projected.z > 1) return false;
              const screenX = (projected.x * 0.5 + 0.5) * rect.width;
              const screenY = (-projected.y * 0.5 + 0.5) * rect.height;
              return (
                screenX >= bounds.left &&
                screenX <= bounds.left + bounds.width &&
                screenY >= bounds.top &&
                screenY <= bounds.top + bounds.height
              );
            })
            .map((node) => node.id);

          setSelectedNodeIds((previous) => [...new Set([...previous, ...nextIds])]);
          suppressSceneSelectionUntilRef.current = Date.now() + 150;
        }
      } else {
        const nodeId = pickNodeIdAtClientPoint(upEvent.clientX, upEvent.clientY);
        if (nodeId) {
          suppressSceneSelectionUntilRef.current = Date.now() + 150;
          setSelectedNodeIds((previous) => (
            previous.includes(nodeId)
              ? previous.filter((id) => id !== nodeId)
              : [...previous, nodeId]
          ));
        }
      }
      setMarqueeRect(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [mode, pickNodeIdAtClientPoint, toolMode]);

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

            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <button onClick={handleUndo} disabled={undoStack.length === 0} style={smallActionButton(undoStack.length > 0)}>
                Undo
              </button>
              <button
                onClick={handleClearPersistedDraft}
                disabled={!hasPersistedDraft}
                style={{
                  ...smallActionButton(hasPersistedDraft),
                  background: hasPersistedDraft ? "rgba(248,113,113,0.14)" : "rgba(255,255,255,0.04)",
                  borderColor: hasPersistedDraft ? "rgba(248,113,113,0.28)" : "rgba(255,255,255,0.08)",
                  color: hasPersistedDraft ? "#fecaca" : "#6b7280",
                }}
              >
                Clear
              </button>
              <button onClick={handleRedo} disabled={redoStack.length === 0} style={smallActionButton(redoStack.length > 0)}>
                Redo
              </button>
              <button
                onClick={duplicateSelectedBlocks}
                disabled={selectedNodes.length === 0}
                style={smallActionButton(selectedNodes.length > 0)}
              >
                Duplicate
              </button>
              <button
                onClick={mirrorSelectedBlocks}
                disabled={selectedNodes.length === 0}
                style={smallActionButton(selectedNodes.length > 0)}
              >
                Mirror
              </button>
              <button
                onClick={() => setShowJson((value) => !value)}
                style={smallActionButton(true)}
              >
                {showJson ? "Hide JSON" : "JSON"}
              </button>
            </div>

            {(toolMode === "select" || toolMode === "move" || toolMode === "rotate") && (
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
                  Mirror Plane
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {(["x", "y", "z"] as const).map((axis) => (
                    <button
                      key={`mirror-axis:${axis}`}
                      onClick={() => setMirrorPlaneAxis(axis)}
                      style={{
                        ...chipButtonStyle,
                        flex: 1,
                        background: mirrorPlaneAxis === axis ? "rgba(244,114,182,0.18)" : "rgba(255,255,255,0.06)",
                        borderColor: mirrorPlaneAxis === axis ? "rgba(244,114,182,0.34)" : "rgba(255,255,255,0.08)",
                      }}
                    >
                      {axis.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  Offset: <strong>{mirrorPlaneOffset.toFixed(2)}</strong>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  <button onClick={() => setMirrorPlaneOffset((value) => value - 0.5)} style={smallActionButton(true)}>
                    -0.5
                  </button>
                  <button onClick={() => setMirrorPlaneOffset((value) => value + 0.5)} style={smallActionButton(true)}>
                    +0.5
                  </button>
                  <button onClick={centerMirrorPlaneToSelection} style={smallActionButton(selectedNodes.length > 0)} disabled={selectedNodes.length === 0}>
                    Center To Selection
                  </button>
                </div>
              </div>
            )}

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

            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {([
                { id: "placement", label: "Placement" },
                { id: "controls", label: "Controls" },
                { id: "parts", label: "Parts" },
              ] as const).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setBuildSidebarTab(tab.id)}
                  style={{
                    ...chipButtonStyle,
                    flex: 1,
                    padding: "9px 0",
                    background: buildSidebarTab === tab.id ? "rgba(14,165,233,0.22)" : "rgba(255,255,255,0.05)",
                    borderColor: buildSidebarTab === tab.id ? "rgba(56,189,248,0.34)" : "rgba(255,255,255,0.08)",
                    color: buildSidebarTab === tab.id ? "#e0f7ff" : "#d7def2",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                paddingRight: 4,
              }}
            >
              {buildSidebarTab === "placement" && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    fontSize: 12,
                  }}
                >
                  {toolMode === "place" ? (
                    <>
                      <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.56, letterSpacing: 0.7 }}>
                        Placement
                      </div>
                      <div style={{ marginTop: 4, fontWeight: 700, color: "#fff" }}>
                        {paletteItems.find((item) => item.id === selectedType)?.label ?? selectedType}
                      </div>
                      <div style={{ marginTop: 6, opacity: 0.78, lineHeight: 1.5 }}>
                        Hover to preview anchors. Use <code>[</code> and <code>]</code> to twist around Z, and <code>Tab</code> to cycle the source anchor when placement is locked manually.
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button
                          onClick={() => setPlacementMode("manual")}
                          style={{
                            ...chipButtonStyle,
                            flex: 1,
                            background: placementMode === "manual" ? "rgba(14, 165, 233, 0.22)" : "rgba(255,255,255,0.06)",
                            borderColor: placementMode === "manual" ? "rgba(56,189,248,0.4)" : "rgba(255,255,255,0.08)",
                          }}
                        >
                          Manual Lock
                        </button>
                        <button
                          onClick={() => setPlacementMode("auto_orient")}
                          style={{
                            ...chipButtonStyle,
                            flex: 1,
                            background: placementMode === "auto_orient" ? "rgba(251,191,36,0.18)" : "rgba(255,255,255,0.06)",
                            borderColor: placementMode === "auto_orient" ? "rgba(251,191,36,0.32)" : "rgba(255,255,255,0.08)",
                            color: placementMode === "auto_orient" ? "#fde68a" : "#d7def2",
                          }}
                        >
                          Auto Orient
                        </button>
                      </div>
                      <div
                        style={{
                          marginTop: 10,
                          padding: "8px 10px",
                          borderRadius: 10,
                          background: placementMode === "manual" ? "rgba(56,189,248,0.08)" : "rgba(251,191,36,0.08)",
                          border: placementMode === "manual" ? "1px solid rgba(56,189,248,0.16)" : "1px solid rgba(251,191,36,0.16)",
                          fontSize: 11,
                          lineHeight: 1.55,
                        }}
                      >
                        <div>
                          Source anchor:{" "}
                          <strong>
                            {placementMode === "manual"
                              ? (activeSourceAnchorId ?? snapResult?.sourceAnchor.id ?? "Hover to choose")
                              : (snapResult?.sourceAnchor.id ?? "Auto")}
                          </strong>
                        </div>
                        <div>
                          Target anchor: <strong>{snapResult ? `${snapResult.target.blockId}:${snapResult.target.anchor.id}` : "--"}</strong>
                        </div>
                        <div>
                          Candidate: <strong>{snapCandidateCount > 0 ? `${activeSnapCandidateIndex + 1}/${snapCandidateCount}` : "--"}</strong>
                        </div>
                      </div>
                      {placementMode === "manual" && (
                        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                          <button
                            onClick={cycleActiveSourceAnchor}
                            style={smallActionButton(placementAnchors.length > 0)}
                            disabled={placementAnchors.length === 0}
                          >
                            Next Source Anchor
                          </button>
                          <button
                            onClick={() => setActiveSourceAnchorId(null)}
                            style={smallActionButton(true)}
                          >
                            Reset Source Anchor
                          </button>
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        <button
                          onClick={() => cycleSnapCandidate(-1)}
                          style={smallActionButton(snapCandidateCount > 1)}
                          disabled={snapCandidateCount <= 1}
                        >
                          Prev Target
                        </button>
                        <button
                          onClick={() => cycleSnapCandidate(1)}
                          style={smallActionButton(snapCandidateCount > 1)}
                          disabled={snapCandidateCount <= 1}
                        >
                          Next Target
                        </button>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 12 }}>
                        Rotation:{" "}
                        <strong>
                          X {normalizeAngle(placementRotation.x)}° · Y {normalizeAngle(placementRotation.y)}° · Z {normalizeAngle(placementRotation.z)}°
                        </strong>
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        <button
                          onClick={() => setPlacementRotation((value) => ({ ...value, z: value.z - (placementStepDeg || 5) }))}
                          style={smallActionButton(true)}
                        >
                          Z - Step
                        </button>
                        <button
                          onClick={() => setPlacementRotation((value) => ({ ...value, z: value.z + (placementStepDeg || 5) }))}
                          style={smallActionButton(true)}
                        >
                          Z + Step
                        </button>
                        <button
                          onClick={() => setPlacementRotation({ x: 0, y: 0, z: 0 })}
                          style={smallActionButton(true)}
                        >
                          Reset Rotation
                        </button>
                      </div>
                      <div style={{ marginTop: 10, fontSize: 11, opacity: 0.62 }}>
                        Quick Rotate
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 6 }}>
                        <button onClick={() => setPlacementRotation((value) => ({ ...value, x: value.x - 90 }))} style={smallActionButton(true)}>
                          X -90°
                        </button>
                        <button onClick={() => setPlacementRotation((value) => ({ ...value, y: value.y - 90 }))} style={smallActionButton(true)}>
                          Y -90°
                        </button>
                        <button onClick={() => setPlacementRotation((value) => ({ ...value, z: value.z - 90 }))} style={smallActionButton(true)}>
                          Z -90°
                        </button>
                        <button onClick={() => setPlacementRotation((value) => ({ ...value, x: value.x + 90 }))} style={smallActionButton(true)}>
                          X +90°
                        </button>
                        <button onClick={() => setPlacementRotation((value) => ({ ...value, y: value.y + 90 }))} style={smallActionButton(true)}>
                          Y +90°
                        </button>
                        <button onClick={() => setPlacementRotation((value) => ({ ...value, z: value.z + 90 }))} style={smallActionButton(true)}>
                          Z +90°
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
                    </>
                  ) : (
                    <>
                      <div style={{ lineHeight: 1.6 }}>
                        {toolMode === "select" && "Click a block to inspect it. Shift-click adds or removes blocks from the selection."}
                        {toolMode === "move" && "Click a block, then drag the gizmo to reposition it. Shift-click builds a multi-selection and dragging moves everything together."}
                        {toolMode === "rotate" && "Click a block, then drag the gizmo to rotate it. Multi-selection rotates around the shared centroid so the layout stays intact."}
                      </div>
                      {(toolMode === "select" || toolMode === "move" || toolMode === "rotate") && (
                        <div
                          style={{
                            marginTop: 10,
                            paddingTop: 10,
                            borderTop: "1px solid rgba(255,255,255,0.08)",
                          }}
                        >
                          <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.56, letterSpacing: 0.7 }}>
                            Mirror Plane
                          </div>
                          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                            {(["x", "y", "z"] as const).map((axis) => (
                              <button
                                key={`mirror-axis:${axis}`}
                                onClick={() => setMirrorPlaneAxis(axis)}
                                style={{
                                  ...chipButtonStyle,
                                  flex: 1,
                                  background: mirrorPlaneAxis === axis ? "rgba(244,114,182,0.18)" : "rgba(255,255,255,0.06)",
                                  borderColor: mirrorPlaneAxis === axis ? "rgba(244,114,182,0.34)" : "rgba(255,255,255,0.08)",
                                }}
                              >
                                {axis.toUpperCase()}
                              </button>
                            ))}
                          </div>
                          <div style={{ marginTop: 8, fontSize: 12 }}>
                            Offset: <strong>{mirrorPlaneOffset.toFixed(2)}</strong>
                          </div>
                          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                            <button onClick={() => setMirrorPlaneOffset((value) => value - 0.5)} style={smallActionButton(true)}>
                              -0.5
                            </button>
                            <button onClick={() => setMirrorPlaneOffset((value) => value + 0.5)} style={smallActionButton(true)}>
                              +0.5
                            </button>
                            <button onClick={centerMirrorPlaneToSelection} style={smallActionButton(selectedNodes.length > 0)} disabled={selectedNodes.length === 0}>
                              Center To Selection
                            </button>
                          </div>
                        </div>
                      )}
                      {(toolMode === "move" || toolMode === "rotate") && (
                        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {toolMode === "move"
                            ? [0, 0.25, 0.5, 1].map((step) => (
                                <button
                                  key={`move-snap:${step}`}
                                  onClick={() => setTranslationSnap(step)}
                                  style={{
                                    ...chipButtonStyle,
                                    background: translationSnap === step ? "rgba(56,189,248,0.24)" : "rgba(255,255,255,0.06)",
                                    borderColor: translationSnap === step ? "rgba(56,189,248,0.4)" : "rgba(255,255,255,0.08)",
                                  }}
                                >
                                  {step === 0 ? "Move Free" : `Move ${step}`}
                                </button>
                              ))
                            : [0, 5, 15, 45].map((step) => (
                                <button
                                  key={`rot-snap:${step}`}
                                  onClick={() => setRotationSnapDeg(step)}
                                  style={{
                                    ...chipButtonStyle,
                                    background: rotationSnapDeg === step ? "rgba(56,189,248,0.24)" : "rgba(255,255,255,0.06)",
                                    borderColor: rotationSnapDeg === step ? "rgba(56,189,248,0.4)" : "rgba(255,255,255,0.08)",
                                  }}
                                >
                                  {step === 0 ? "Rotate Free" : `Rotate ${step}°`}
                                </button>
                              ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {buildSidebarTab === "controls" && (
                controlMap ? (
                  <div
                    style={{
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
                ) : (
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      fontSize: 12,
                      lineHeight: 1.6,
                      opacity: 0.78,
                    }}
                  >
                    Controls appear here when the current build includes motors, hinges, or other mapped inputs.
                  </div>
                )
              )}

              {buildSidebarTab === "parts" && (
                <>
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
            </div>

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
              <button onClick={handleResetPlay} style={{ ...secondaryButtonStyle, flex: 1 }}>
                Reset Scene
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
              {isMultiSelection ? `${selectedNodes.length} Blocks Selected` : (selectedDefinition?.name ?? "Nothing selected")}
            </div>
            <div style={{ fontSize: 12, opacity: 0.62, marginTop: 2 }}>
              {isMultiSelection
                ? "Move and rotate the group as a single selection around its centroid."
                : selectedNode
                  ? `${selectedNode.id} · ${selectedNode.typeId}`
                  : "Select a block to edit it directly."}
            </div>
          </div>

          {selectedNode && inspectorDraft && !isMultiSelection ? (
            <div style={{ padding: 16 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button
                  onClick={() => setTransformSpace("local")}
                  style={{
                    ...chipButtonStyle,
                    flex: 1,
                    background: effectiveTransformSpace === "local" ? "rgba(14, 165, 233, 0.22)" : "rgba(255,255,255,0.06)",
                  }}
                >
                  Local
                </button>
                <button
                  onClick={() => setTransformSpace("world")}
                  style={{
                    ...chipButtonStyle,
                    flex: 1,
                    background: effectiveTransformSpace === "world" ? "rgba(14, 165, 233, 0.22)" : "rgba(255,255,255,0.06)",
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

              {selectedJointActuator && motorDraft && (
                <div
                  style={{
                    marginTop: 14,
                    padding: "12px 12px 10px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.56, letterSpacing: 0.7 }}>
                    Joint Motor
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.6, opacity: 0.8 }}>
                    {selectedJointActuator.blockName} defaults persist on the block in build mode and carry into play mode.
                    <br />
                    The pose preview updates live here while you edit the values below.
                    <br />
                    Use max force here for torque. Use the Controls tab to scale command strength.
                  </div>

                  {(selectedJointActuator.inputTarget === "position" || selectedJointActuator.inputTarget === "both" || selectedJointActuator.actuatorType === "position") && (
                    <>
                      <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.56, marginTop: 10, marginBottom: 6 }}>
                        Target Position
                      </div>
                      <LabeledInput
                        label="Degrees"
                        value={motorDraft.targetPositionDeg}
                        suffix="deg"
                        onChange={(value) => setMotorDraft((draft) => (draft ? { ...draft, targetPositionDeg: value } : draft))}
                      />
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        {[-90, 0, 90].map((value) => (
                          <button
                            key={`pose:${value}`}
                            onClick={() =>
                              setMotorDraft((draft) =>
                                draft ? { ...draft, targetPositionDeg: String(value) } : draft,
                              )
                            }
                            style={smallActionButton(true)}
                          >
                            {value > 0 ? `+${value}°` : `${value}°`}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.56, marginTop: 10, marginBottom: 6 }}>
                    Motor Tuning
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <LabeledInput
                      label="Target Velocity"
                      value={motorDraft.targetVelocityDeg}
                      suffix="deg/s"
                      onChange={(value) => setMotorDraft((draft) => (draft ? { ...draft, targetVelocityDeg: value } : draft))}
                    />
                    <LabeledInput
                      label="Stiffness"
                      value={motorDraft.stiffness}
                      onChange={(value) => setMotorDraft((draft) => (draft ? { ...draft, stiffness: value } : draft))}
                    />
                    <LabeledInput
                      label="Damping"
                      value={motorDraft.damping}
                      onChange={(value) => setMotorDraft((draft) => (draft ? { ...draft, damping: value } : draft))}
                    />
                    <LabeledInput
                      label="Max Force"
                      value={motorDraft.maxForce}
                      placeholder="Use catalog default"
                      onChange={(value) => setMotorDraft((draft) => (draft ? { ...draft, maxForce: value } : draft))}
                    />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                    <button onClick={applyMotorDraft} style={{ ...primaryButtonStyle, width: "100%" }}>
                      Apply Motor
                    </button>
                    <button onClick={resetMotorDraft} style={{ ...secondaryButtonStyle, width: "100%" }}>
                      Reset Draft
                    </button>
                  </div>
                  <button
                    onClick={clearMotorOverrides}
                    style={{ ...secondaryButtonStyle, width: "100%", marginTop: 8 }}
                  >
                    Use Catalog Defaults
                  </button>

                  {motorDraftError && (
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
                      {motorDraftError}
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7, lineHeight: 1.6 }}>
                Anchors: {selectedDefinition?.anchors.length ?? 0}
                <br />
                Connections: {selectedConnections.length}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
                <button onClick={duplicateSelectedBlocks} style={{ ...secondaryButtonStyle, width: "100%" }}>
                  Duplicate
                </button>
                <button onClick={mirrorSelectedBlocks} style={{ ...secondaryButtonStyle, width: "100%" }}>
                  Mirror
                </button>
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
          ) : isMultiSelection ? (
            <div style={{ padding: 16, fontSize: 12, lineHeight: 1.7, opacity: 0.82 }}>
              Selected blocks: <strong>{selectedNodes.length}</strong>
              <br />
              Centroid:{" "}
              <strong>
                {selectionCentroid
                  ? `${selectionCentroid.x.toFixed(2)}, ${selectionCentroid.y.toFixed(2)}, ${selectionCentroid.z.toFixed(2)}`
                  : "--"}
              </strong>
              <br />
              Connections touching selection: {selectedConnections.length}
              <br />
              Rotation uses the selection centroid as the pivot, and the gizmo stays in world space for multi-select.
              <br />
              Mirror plane: <strong>{mirrorPlaneAxis.toUpperCase()} = {mirrorPlaneOffset.toFixed(2)}</strong>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
                <button onClick={duplicateSelectedBlocks} style={{ ...secondaryButtonStyle, width: "100%" }}>
                  Duplicate
                </button>
                <button onClick={mirrorSelectedBlocks} style={{ ...secondaryButtonStyle, width: "100%" }}>
                  Mirror
                </button>
              </div>
              <button
                onClick={deleteSelectedBlock}
                style={{ ...secondaryButtonStyle, width: "100%", marginTop: 14, color: "#fecaca", borderColor: "rgba(248,113,113,0.2)" }}
              >
                Delete Selection
              </button>
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
                  Shift-click adds or removes blocks from the current selection
                  <br />
                  X/Y/Z quick rotate buttons change placement orientation
                  <br />
                  [ / ] twist placement around Z, Tab cycles source anchors, , / . cycle targets
                  <br />
                  Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z redo, Cmd/Ctrl+D duplicate
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
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleExportMachine} style={{ ...secondaryButtonStyle, flex: 1 }}>
                Export Machine
              </button>
              <button onClick={handleApplyJson} style={{ ...primaryButtonStyle, flex: 1 }}>
                Apply Changes
              </button>
            </div>
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

      <div
        ref={canvasWrapRef}
        onPointerDownCapture={handleCanvasPointerDownCapture}
        style={{ position: "absolute", inset: 0 }}
      >
      <Canvas
        camera={{ position: cameraPos, fov: 50 }}
        shadows
        onCreated={(state) => {
          cameraRef.current = state.camera;
          sceneRef.current = state.scene;
        }}
        style={{ background: "linear-gradient(180deg, #152238 0%, #0b1020 100%)" }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[8, 12, 6]} intensity={1.1} castShadow />
        <Environment preset="city" />
        {!(mode === "play" && firstPerson) && <OrbitControls makeDefault enabled={!isTransformDragging && !isMarqueeGestureActive} />}

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
          <MirrorPlane axis={mirrorPlaneAxis} offset={mirrorPlaneOffset} />
        )}

        {mode === "build" && (
          <>
            <SnapScene
              graph={graph}
              catalog={catalog}
              selectedType={selectedType}
              selectedNodeId={selectedNodeId}
              selectedNodeIds={selectedNodeIds}
              toolMode={toolMode}
              placementMode={placementMode}
              activeSourceAnchorId={placementMode === "manual" ? activeSourceAnchorId : null}
              activeSnapCandidateIndex={activeSnapCandidateIndex}
              previewRotation={placementRotation}
              previewJointAnglesByNodeId={buildPreviewJointAngles}
              controlMap={controlMap ?? undefined}
              keysDownRef={keysDown}
              highlightBlockId={hoveredEntry?.blockId}
              highlightJointId={hoveredEntry?.id}
              onGraphChange={(nextGraph) => applyBuildGraph(nextGraph)}
              onSelectionChange={handleSceneSelectionChange}
              onSnapChange={setSnapResult}
              onSnapCandidateCountChange={setSnapCandidateCount}
              onActiveSourceAnchorChange={setActiveSourceAnchorId}
            />

            {selectionHandleTransform && (toolMode === "move" || toolMode === "rotate") && (
              <>
                <group
                  ref={transformHandleRef}
                  position={[
                    selectionHandleTransform.position.x,
                    selectionHandleTransform.position.y,
                    selectionHandleTransform.position.z,
                  ]}
                  quaternion={[
                    selectionHandleTransform.rotation.x,
                    selectionHandleTransform.rotation.y,
                    selectionHandleTransform.rotation.z,
                    selectionHandleTransform.rotation.w,
                  ]}
                >
                  <mesh visible={false}>
                    <boxGeometry args={[0.001, 0.001, 0.001]} />
                    <meshBasicMaterial transparent opacity={0} />
                  </mesh>
                </group>

                <TransformControls
                  key={`${selectedNodeIds.join(",")}:${toolMode}:${effectiveTransformSpace}`}
                  object={transformHandleRef.current ?? undefined}
                  mode={toolMode === "move" ? "translate" : "rotate"}
                  space={effectiveTransformSpace}
                  translationSnap={toolMode === "move" && translationSnap > 0 ? translationSnap : undefined}
                  rotationSnap={toolMode === "rotate" && rotationSnapDeg > 0 ? degToRad(rotationSnapDeg) : undefined}
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
      {mode === "build" && toolMode === "select" && marqueeRect && (
        <div
          style={{
            position: "absolute",
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
            border: "1px solid rgba(125,211,252,0.9)",
            background: "rgba(56,189,248,0.14)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
            pointerEvents: "none",
          }}
        />
      )}
      </div>
    </div>
  );
}

function MirrorPlane({ axis, offset }: { axis: MirrorPlaneAxis; offset: number }) {
  const rotation: [number, number, number] =
    axis === "x"
      ? [0, Math.PI / 2, 0]
      : axis === "y"
        ? [-Math.PI / 2, 0, 0]
        : [0, 0, 0];
  const position: [number, number, number] =
    axis === "x"
      ? [offset, 0, 0]
      : axis === "y"
        ? [0, offset, 0]
        : [0, 0, offset];

  return (
    <mesh position={position} rotation={rotation} renderOrder={1}>
      <planeGeometry args={[40, 40]} />
      <meshBasicMaterial
        color="#f472b6"
        transparent
        opacity={0.08}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function findSnapBlockId(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const nodeId = current.userData?.snapBlockId;
    if (typeof nodeId === "string") {
      return nodeId;
    }
    current = current.parent;
  }
  return null;
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

function LabeledInput({
  label,
  value,
  onChange,
  suffix,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <label style={{ fontSize: 11, opacity: 0.86 }}>
      <div style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ position: "relative" }}>
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={transformInputStyle}
        />
        {suffix && (
          <span style={{ position: "absolute", right: 8, top: 9, fontSize: 11, opacity: 0.46 }}>
            {suffix}
          </span>
        )}
      </div>
    </label>
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

function actuatorToMotorDraft(entry: ActuatorEntry): MotorDraft {
  return {
    targetPositionDeg: radToDeg(entry.targetPosition ?? entry.defaultTarget ?? 0).toFixed(1),
    targetVelocityDeg: radToDeg(entry.targetVelocity ?? 0).toFixed(1),
    stiffness: (entry.stiffness ?? 0).toFixed(2),
    damping: (entry.damping ?? 0).toFixed(2),
    maxForce: entry.maxForce == null ? "" : entry.maxForce.toFixed(2),
  };
}

function parseMotorDraft(
  draft: MotorDraft,
): { ok: true; overrides: BuilderJointMotorOverrides } | { ok: false; error: string } {
  const targetPositionDeg = Number(draft.targetPositionDeg);
  const targetVelocityDeg = Number(draft.targetVelocityDeg);
  const stiffness = Number(draft.stiffness);
  const damping = Number(draft.damping);

  if ([targetPositionDeg, targetVelocityDeg, stiffness, damping].some((value) => Number.isNaN(value) || !Number.isFinite(value))) {
    return { ok: false, error: "Motor fields must be valid finite numbers." };
  }

  if (stiffness < 0 || damping < 0) {
    return { ok: false, error: "Stiffness and damping must be non-negative." };
  }

  let maxForce: number | undefined;
  const trimmedForce = draft.maxForce.trim();
  if (trimmedForce !== "") {
    maxForce = Number(trimmedForce);
    if (Number.isNaN(maxForce) || !Number.isFinite(maxForce) || maxForce < 0) {
      return { ok: false, error: "Max force must be blank or a non-negative finite number." };
    }
  }

  return {
    ok: true,
    overrides: {
      targetPosition: degToRad(targetPositionDeg),
      targetVelocity: degToRad(targetVelocityDeg),
      stiffness,
      damping,
      ...(maxForce !== undefined ? { maxForce } : null),
    },
  };
}

function withBuilderMotorOverrides(
  metadata: Record<string, unknown> | undefined,
  overrides: BuilderJointMotorOverrides | null,
): Record<string, unknown> | undefined {
  const nextMetadata = metadata ? { ...metadata } : {};
  const builder = isRecord(nextMetadata.builder) ? { ...nextMetadata.builder } : {};

  if (!overrides) {
    delete builder.motor;
  } else {
    const nextMotor = Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(nextMotor).length > 0) {
      builder.motor = nextMotor;
    } else {
      delete builder.motor;
    }
  }

  if (Object.keys(builder).length > 0) {
    nextMetadata.builder = builder;
  } else {
    delete nextMetadata.builder;
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
}

function normalizePersistedMachineControls(value: unknown): MachineControls | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const defaultProfileId = typeof value.defaultProfileId === "string" ? value.defaultProfileId : null;
  const rawProfiles = Array.isArray(value.profiles) ? value.profiles : null;
  if (!defaultProfileId || !rawProfiles) {
    return undefined;
  }

  const profiles = rawProfiles.flatMap((profile) => {
    if (!isRecord(profile) || profile.kind !== "keyboard" || typeof profile.id !== "string" || !Array.isArray(profile.bindings)) {
      return [];
    }

    const bindings = profile.bindings.flatMap((binding) => {
      if (!isRecord(binding) || !isRecord(binding.target) || !isRecord(binding.positive)) {
        return [];
      }
      if (
        (binding.target.kind !== "joint" && binding.target.kind !== "behavior") ||
        typeof binding.target.id !== "string" ||
        typeof binding.positive.code !== "string" ||
        typeof binding.enabled !== "boolean" ||
        typeof binding.scale !== "number" ||
        !Number.isFinite(binding.scale)
      ) {
        return [];
      }

      const negative = isRecord(binding.negative) && typeof binding.negative.code === "string"
        ? { code: binding.negative.code }
        : undefined;

      return [{
        target: {
          kind: binding.target.kind,
          id: binding.target.id,
        },
        positive: { code: binding.positive.code },
        negative,
        enabled: binding.enabled,
        scale: binding.scale,
      }];
    });

    return [{
      id: profile.id,
      kind: "keyboard" as const,
      bindings,
    }];
  });

  if (profiles.length === 0) {
    return undefined;
  }

  return {
    defaultProfileId,
    profiles,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
