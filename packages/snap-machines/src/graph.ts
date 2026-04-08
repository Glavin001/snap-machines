import { BlockCatalog, structuralPolarityMatch } from "./schema.js";
import { Transform, cloneTransform } from "./math.js";

export interface AnchorRef {
  blockId: string;
  anchorId: string;
}

export interface BlockNode {
  id: string;
  typeId: string;
  transform: Transform;
  metadata?: Record<string, unknown>;
}

export interface BlockConnection {
  id: string;
  a: AnchorRef;
  b: AnchorRef;
  metadata?: Record<string, unknown>;
}

export interface SerializedBlockGraph {
  version: 1;
  nodes: BlockNode[];
  connections: BlockConnection[];
  metadata?: Record<string, unknown>;
}

export interface GraphValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

let globalIdCounter = 0;

export function makeId(prefix: string): string {
  globalIdCounter += 1;
  return `${prefix}:${globalIdCounter.toString(36)}`;
}

function anchorKey(ref: AnchorRef): string {
  return `${ref.blockId}::${ref.anchorId}`;
}

function refsEqual(a: AnchorRef, b: AnchorRef): boolean {
  return a.blockId === b.blockId && a.anchorId === b.anchorId;
}

export class BlockGraph {
  readonly metadata: Record<string, unknown>;
  private readonly nodes = new Map<string, BlockNode>();
  private readonly connections = new Map<string, BlockConnection>();
  private readonly anchorOccupancy = new Map<string, string>();

  constructor(initial?: SerializedBlockGraph) {
    this.metadata = { ...(initial?.metadata ?? {}) };
    if (initial) {
      for (const node of initial.nodes) {
        this.addNode(node);
      }
      for (const connection of initial.connections) {
        this.addConnection(connection);
      }
    }
  }

  static fromJSON(json: SerializedBlockGraph): BlockGraph {
    return new BlockGraph(json);
  }

  toJSON(): SerializedBlockGraph {
    return {
      version: 1,
      nodes: this.listNodes().map((node) => ({ ...node, transform: cloneTransform(node.transform) })),
      connections: this.listConnections().map((connection) => ({ ...connection })),
      metadata: { ...this.metadata },
    };
  }

  clone(): BlockGraph {
    return BlockGraph.fromJSON(this.toJSON());
  }

  addNode(node: Omit<BlockNode, "id"> & { id?: string }): BlockNode {
    const id = node.id ?? makeId("block");
    if (this.nodes.has(id)) {
      throw new Error(`Graph already contains a node with id '${id}'.`);
    }
    const next: BlockNode = {
      id,
      typeId: node.typeId,
      transform: cloneTransform(node.transform),
      metadata: node.metadata ? { ...node.metadata } : undefined,
    };
    this.nodes.set(id, next);
    return next;
  }

  removeNode(nodeId: string): void {
    if (!this.nodes.has(nodeId)) {
      return;
    }
    for (const connection of this.listConnections()) {
      if (connection.a.blockId === nodeId || connection.b.blockId === nodeId) {
        this.removeConnection(connection.id);
      }
    }
    this.nodes.delete(nodeId);
  }

  getNode(nodeId: string): BlockNode | undefined {
    return this.nodes.get(nodeId);
  }

  updateNodeTransform(nodeId: string, transform: Transform): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Unknown node '${nodeId}'.`);
    }
    node.transform = cloneTransform(transform);
  }

  listNodes(): BlockNode[] {
    return [...this.nodes.values()];
  }

  addConnection(connection: Omit<BlockConnection, "id"> & { id?: string }): BlockConnection {
    if (!this.nodes.has(connection.a.blockId) || !this.nodes.has(connection.b.blockId)) {
      throw new Error(`Cannot create a connection with missing graph nodes.`);
    }
    if (refsEqual(connection.a, connection.b)) {
      throw new Error(`A connection cannot link an anchor to itself.`);
    }

    const keyA = anchorKey(connection.a);
    const keyB = anchorKey(connection.b);
    if (this.anchorOccupancy.has(keyA)) {
      throw new Error(`Anchor '${keyA}' is already occupied.`);
    }
    if (this.anchorOccupancy.has(keyB)) {
      throw new Error(`Anchor '${keyB}' is already occupied.`);
    }

    const id = connection.id ?? makeId("conn");
    if (this.connections.has(id)) {
      throw new Error(`Graph already contains a connection with id '${id}'.`);
    }

    const next: BlockConnection = {
      id,
      a: { ...connection.a },
      b: { ...connection.b },
      metadata: connection.metadata ? { ...connection.metadata } : undefined,
    };
    this.connections.set(id, next);
    this.anchorOccupancy.set(keyA, id);
    this.anchorOccupancy.set(keyB, id);
    return next;
  }

  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }
    this.anchorOccupancy.delete(anchorKey(connection.a));
    this.anchorOccupancy.delete(anchorKey(connection.b));
    this.connections.delete(connectionId);
  }

  getConnection(connectionId: string): BlockConnection | undefined {
    return this.connections.get(connectionId);
  }

  listConnections(): BlockConnection[] {
    return [...this.connections.values()];
  }

  getConnectionForAnchor(anchor: AnchorRef): BlockConnection | undefined {
    const connectionId = this.anchorOccupancy.get(anchorKey(anchor));
    return connectionId ? this.connections.get(connectionId) : undefined;
  }

  isAnchorOccupied(anchor: AnchorRef): boolean {
    return this.anchorOccupancy.has(anchorKey(anchor));
  }

  getConnectionsForBlock(blockId: string): BlockConnection[] {
    return this.listConnections().filter((connection) => connection.a.blockId === blockId || connection.b.blockId === blockId);
  }

  validateAgainstCatalog(catalog: BlockCatalog): GraphValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const node of this.listNodes()) {
      if (!catalog.has(node.typeId)) {
        errors.push(`Node '${node.id}' references unknown block type '${node.typeId}'.`);
      }
    }

    for (const connection of this.listConnections()) {
      const nodeA = this.getNode(connection.a.blockId);
      const nodeB = this.getNode(connection.b.blockId);
      if (!nodeA || !nodeB) {
        errors.push(`Connection '${connection.id}' references a missing node.`);
        continue;
      }
      if (!catalog.has(nodeA.typeId) || !catalog.has(nodeB.typeId)) {
        continue;
      }

      const blockA = catalog.get(nodeA.typeId);
      const blockB = catalog.get(nodeB.typeId);
      const anchorA = blockA.anchors.find((anchor) => anchor.id === connection.a.anchorId);
      const anchorB = blockB.anchors.find((anchor) => anchor.id === connection.b.anchorId);
      if (!anchorA) {
        errors.push(`Connection '${connection.id}' references missing anchor '${connection.a.anchorId}' on node '${connection.a.blockId}'.`);
        continue;
      }
      if (!anchorB) {
        errors.push(`Connection '${connection.id}' references missing anchor '${connection.b.anchorId}' on node '${connection.b.blockId}'.`);
        continue;
      }
      if (anchorA.type.toLowerCase() !== anchorB.type.toLowerCase()) {
        errors.push(`Connection '${connection.id}' joins incompatible anchor types '${anchorA.type}' and '${anchorB.type}'.`);
      }
      if (!structuralPolarityMatch(anchorA.polarity, anchorB.polarity)) {
        errors.push(`Connection '${connection.id}' joins incompatible anchor polarities '${anchorA.polarity}' and '${anchorB.polarity}'.`);
      }
      if (nodeA.id === nodeB.id) {
        warnings.push(`Connection '${connection.id}' joins two anchors on the same block '${nodeA.id}'.`);
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
    };
  }
}
