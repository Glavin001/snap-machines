import {
  BlockCatalog,
  BlockGraph,
  QUAT_IDENTITY,
  VEC3_Y,
  cloneQuat,
  cloneVec3,
  findBestSnap,
  quatFromAxisAngle,
  type AnchorRef,
  type BlockConnection,
  type BlockNode,
  type NormalizedAnchorDefinition,
  type NormalizedBlockDefinition,
  type Quat,
  type SerializedBlockGraph,
  type SnapResult,
  type Transform,
  type Vec3,
} from "@snap-machines/core";

export type SnapMode = "gallery" | "build" | "play";

export type GraphUpdater = (current: BlockGraph) => BlockGraph;

export type CommitOptions = {
  isAiEdit?: boolean;
  selectionIds?: string[] | null;
};

export type SnapAccessors = {
  getGraph(): BlockGraph;
  getCatalog(): BlockCatalog;
  getMode(): SnapMode;
  getSelectedNodeIds(): string[];
  listPresets(): Array<{ name: string; description: string }>;
  commitEdit(updater: GraphUpdater, options?: CommitOptions): boolean;
  setSelection(ids: string[]): void;
  setMode(mode: SnapMode): void;
  loadPreset(name: string): boolean;
  clearGraph(): void;
};

type AnchorSummary = {
  id: string;
  type: string;
  polarity: NormalizedAnchorDefinition["polarity"];
  position: Vec3;
  normal: Vec3;
};

type BlockSummary = {
  id: string;
  name: string;
  category: string | undefined;
  mass: number | undefined;
  anchors: AnchorSummary[];
  hasJoint: boolean;
  behaviors: string[];
};

type EditResult = { changed: boolean; id?: string; reason?: string };

export type SnapCtx = {
  // ---- READ ----
  getMode(): SnapMode;
  getGraph(): SerializedBlockGraph;
  getSelection(): string[];
  listNodes(): BlockNode[];
  getNode(id: string): BlockNode | null;
  listConnections(): BlockConnection[];
  getConnectionsForBlock(blockId: string): BlockConnection[];
  listCatalog(): BlockSummary[];
  getBlockDefinition(typeId: string): NormalizedBlockDefinition | null;
  listPresets(): Array<{ name: string; description: string }>;

  // ---- WRITE ----
  addBlock(spec: {
    typeId: string;
    position: Vec3 | [number, number, number];
    rotation?: Quat | [number, number, number, number];
  }): EditResult;
  snapBlock(spec: {
    typeId: string;
    targetBlockId: string;
    hitPoint?: Vec3 | [number, number, number];
    hitNormal?: Vec3 | [number, number, number];
  }): EditResult;
  moveBlock(
    id: string,
    patch: {
      position?: Vec3 | [number, number, number];
      rotation?: Quat | [number, number, number, number];
    },
  ): EditResult;
  removeBlock(id: string): EditResult;
  connect(spec: { a: AnchorRef; b: AnchorRef }): EditResult;
  disconnect(connectionId: string): EditResult;
  setSelection(ids: string[]): EditResult;
  setMode(mode: SnapMode): EditResult;
  loadPreset(name: string): EditResult;
  clearGraph(): EditResult;

  // ---- MATH ----
  quaternionFromYaw(yawRad: number): Quat;
  identityQuaternion(): Quat;
};

/**
 * Build the per-invocation `ctx` object exposed to the AI's sandboxed code.
 * Accessors are bound once; every read pulls live state from the host via
 * `accessors.getGraph()`, so sequential helper calls inside one tool invocation
 * observe each other's mutations.
 */
export function buildSnapCtx(accessors: SnapAccessors): SnapCtx {
  const aiEdit = (updater: GraphUpdater, selectionIds?: string[] | null): boolean =>
    accessors.commitEdit(updater, { isAiEdit: true, selectionIds: selectionIds ?? undefined });

  function nodeById(graph: BlockGraph, id: string): BlockNode | null {
    return graph.getNode(id) ?? null;
  }

  function toVec3(value: Vec3 | [number, number, number] | undefined): Vec3 | null {
    if (!value) return null;
    if (Array.isArray(value)) {
      if (value.length !== 3 || value.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
        return null;
      }
      return { x: value[0]!, y: value[1]!, z: value[2]! };
    }
    if (typeof value === "object"
      && typeof value.x === "number"
      && typeof value.y === "number"
      && typeof value.z === "number"
      && Number.isFinite(value.x)
      && Number.isFinite(value.y)
      && Number.isFinite(value.z)) {
      return { x: value.x, y: value.y, z: value.z };
    }
    return null;
  }

  function toQuat(value: Quat | [number, number, number, number] | undefined): Quat | null {
    if (value === undefined) return null;
    if (Array.isArray(value)) {
      if (value.length !== 4 || value.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
        return null;
      }
      return { x: value[0]!, y: value[1]!, z: value[2]!, w: value[3]! };
    }
    if (typeof value === "object"
      && typeof value.x === "number"
      && typeof value.y === "number"
      && typeof value.z === "number"
      && typeof value.w === "number"
      && Number.isFinite(value.x)
      && Number.isFinite(value.y)
      && Number.isFinite(value.z)
      && Number.isFinite(value.w)) {
      return { x: value.x, y: value.y, z: value.z, w: value.w };
    }
    return null;
  }

  function summarizeBlock(def: NormalizedBlockDefinition): BlockSummary {
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      mass: def.mass,
      anchors: def.anchors.map((a) => ({
        id: a.id,
        type: a.type,
        polarity: a.polarity,
        position: cloneVec3(a.position),
        normal: cloneVec3(a.normal),
      })),
      hasJoint: Boolean(def.joint),
      behaviors: def.behaviors.map((b) => b.kind),
    };
  }

  return {
    getMode() {
      return accessors.getMode();
    },
    getGraph() {
      return accessors.getGraph().toJSON();
    },
    getSelection() {
      return [...accessors.getSelectedNodeIds()];
    },
    listNodes() {
      return accessors.getGraph().listNodes().map((n) => ({
        ...n,
        transform: { position: cloneVec3(n.transform.position), rotation: cloneQuat(n.transform.rotation) },
      }));
    },
    getNode(id) {
      const node = nodeById(accessors.getGraph(), id);
      if (!node) return null;
      return {
        ...node,
        transform: { position: cloneVec3(node.transform.position), rotation: cloneQuat(node.transform.rotation) },
      };
    },
    listConnections() {
      return accessors.getGraph().listConnections().map((c) => ({ ...c, a: { ...c.a }, b: { ...c.b } }));
    },
    getConnectionsForBlock(blockId) {
      return accessors.getGraph().getConnectionsForBlock(blockId).map((c) => ({ ...c, a: { ...c.a }, b: { ...c.b } }));
    },
    listCatalog() {
      return accessors.getCatalog().list().map(summarizeBlock);
    },
    getBlockDefinition(typeId) {
      const catalog = accessors.getCatalog();
      if (!catalog.has(typeId)) return null;
      return catalog.get(typeId);
    },
    listPresets() {
      return accessors.listPresets();
    },

    addBlock(spec) {
      if (typeof spec?.typeId !== "string") {
        return { changed: false, reason: "typeId must be a string" };
      }
      const catalog = accessors.getCatalog();
      if (!catalog.has(spec.typeId)) {
        return { changed: false, reason: `unknown typeId '${spec.typeId}'` };
      }
      const position = toVec3(spec.position);
      if (!position) return { changed: false, reason: "position must be {x,y,z} or [x,y,z] of finite numbers" };
      const rotation = spec.rotation === undefined ? cloneQuat(QUAT_IDENTITY) : toQuat(spec.rotation);
      if (!rotation) return { changed: false, reason: "rotation must be {x,y,z,w} or [x,y,z,w] quaternion" };
      let assignedId = "";
      const changed = aiEdit((graph) => {
        const node = graph.addNode({
          typeId: spec.typeId,
          transform: { position, rotation },
        });
        assignedId = node.id;
        return graph;
      });
      return changed ? { changed, id: assignedId } : { changed };
    },

    snapBlock(spec) {
      if (typeof spec?.typeId !== "string") {
        return { changed: false, reason: "typeId must be a string" };
      }
      if (typeof spec?.targetBlockId !== "string") {
        return { changed: false, reason: "targetBlockId must be a string" };
      }
      const catalog = accessors.getCatalog();
      if (!catalog.has(spec.typeId)) {
        return { changed: false, reason: `unknown typeId '${spec.typeId}'` };
      }
      const graph = accessors.getGraph();
      const targetNode = graph.getNode(spec.targetBlockId);
      if (!targetNode) return { changed: false, reason: `no block with id '${spec.targetBlockId}'` };
      const hitPoint = toVec3(spec.hitPoint) ?? cloneVec3(targetNode.transform.position);
      const hitNormal = toVec3(spec.hitNormal) ?? undefined;
      let result: SnapResult | null;
      try {
        result = findBestSnap({
          graph,
          catalog,
          candidateTypeId: spec.typeId,
          hit: { blockId: spec.targetBlockId, point: hitPoint, normal: hitNormal },
        });
      } catch (err) {
        return { changed: false, reason: (err as Error).message };
      }
      if (!result) return { changed: false, reason: "no compatible anchor pair found near that point" };

      let assignedId = "";
      const changed = aiEdit((nextGraph) => {
        const node = nextGraph.addNode({
          typeId: spec.typeId,
          transform: result!.placement,
        });
        nextGraph.addConnection({
          a: { blockId: result!.target.blockId, anchorId: result!.target.anchor.id },
          b: { blockId: node.id, anchorId: result!.sourceAnchor.id },
        });
        assignedId = node.id;
        return nextGraph;
      });
      return changed ? { changed, id: assignedId } : { changed };
    },

    moveBlock(id, patch) {
      if (typeof id !== "string") return { changed: false, reason: "id must be a string" };
      if (!patch || typeof patch !== "object") return { changed: false, reason: "patch must be an object" };
      const position = patch.position === undefined ? undefined : toVec3(patch.position);
      if (patch.position !== undefined && !position) {
        return { changed: false, reason: "position must be {x,y,z} or [x,y,z] of finite numbers" };
      }
      const rotation = patch.rotation === undefined ? undefined : toQuat(patch.rotation);
      if (patch.rotation !== undefined && !rotation) {
        return { changed: false, reason: "rotation must be {x,y,z,w} or [x,y,z,w] quaternion" };
      }
      const current = accessors.getGraph().getNode(id);
      if (!current) return { changed: false, reason: `no block with id '${id}'` };
      const next: Transform = {
        position: position ?? cloneVec3(current.transform.position),
        rotation: rotation ?? cloneQuat(current.transform.rotation),
      };
      const changed = aiEdit((graph) => {
        graph.updateNodeTransform(id, next);
        return graph;
      });
      return { changed };
    },

    removeBlock(id) {
      if (typeof id !== "string") return { changed: false, reason: "id must be a string" };
      const node = accessors.getGraph().getNode(id);
      if (!node) return { changed: false, reason: `no block with id '${id}'` };
      const changed = aiEdit((graph) => {
        graph.removeNode(id);
        return graph;
      });
      return { changed };
    },

    connect(spec) {
      if (!spec?.a || !spec?.b) return { changed: false, reason: "both a and b anchor refs are required" };
      const graph = accessors.getGraph();
      if (!graph.getNode(spec.a.blockId)) {
        return { changed: false, reason: `no block with id '${spec.a.blockId}'` };
      }
      if (!graph.getNode(spec.b.blockId)) {
        return { changed: false, reason: `no block with id '${spec.b.blockId}'` };
      }
      let assignedId = "";
      try {
        const changed = aiEdit((g) => {
          const c = g.addConnection({ a: { ...spec.a }, b: { ...spec.b } });
          assignedId = c.id;
          return g;
        });
        return changed ? { changed, id: assignedId } : { changed };
      } catch (err) {
        return { changed: false, reason: (err as Error).message };
      }
    },

    disconnect(connectionId) {
      if (typeof connectionId !== "string") return { changed: false, reason: "connectionId must be a string" };
      const c = accessors.getGraph().getConnection(connectionId);
      if (!c) return { changed: false, reason: `no connection with id '${connectionId}'` };
      const changed = aiEdit((graph) => {
        graph.removeConnection(connectionId);
        return graph;
      });
      return { changed };
    },

    setSelection(ids) {
      if (!Array.isArray(ids) || ids.some((v) => typeof v !== "string")) {
        return { changed: false, reason: "ids must be an array of strings" };
      }
      accessors.setSelection(ids);
      return { changed: true };
    },

    setMode(mode) {
      if (mode !== "gallery" && mode !== "build" && mode !== "play") {
        return { changed: false, reason: `unknown mode '${String(mode)}'` };
      }
      accessors.setMode(mode);
      return { changed: true };
    },

    loadPreset(name) {
      if (typeof name !== "string") return { changed: false, reason: "name must be a string" };
      const ok = accessors.loadPreset(name);
      return ok ? { changed: true } : { changed: false, reason: `no preset named '${name}'` };
    },

    clearGraph() {
      accessors.clearGraph();
      return { changed: true };
    },

    quaternionFromYaw(yawRad) {
      if (typeof yawRad !== "number" || !Number.isFinite(yawRad)) {
        return cloneQuat(QUAT_IDENTITY);
      }
      return quatFromAxisAngle(VEC3_Y, yawRad);
    },

    identityQuaternion() {
      return cloneQuat(QUAT_IDENTITY);
    },
  };
}
