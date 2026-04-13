import { BlockGraph } from "./graph.js";
import { compileMachinePlan } from "./compile/plan.js";
import type { CompileMachineOptions, MachinePlan } from "./compile/plan.js";
import { MachineControls, generateMachineControls } from "./control-map.js";
import { BlockCatalog, BlockDefinition, JsonObject, JsonValue, NormalizedBlockDefinition } from "./schema.js";

export const SERIALIZED_MACHINE_SCHEMA_VERSION = 3 as const;
export const SERIALIZED_CATALOG_SCHEMA_VERSION = 1 as const;

export interface SerializedMachineEnvelope {
  schemaVersion: typeof SERIALIZED_MACHINE_SCHEMA_VERSION;
  catalogVersion: string;
  plan: MachinePlan;
  controls?: MachineControls;
  metadata?: JsonObject;
}

export interface SerializedBlockCatalog {
  schemaVersion: typeof SERIALIZED_CATALOG_SCHEMA_VERSION;
  catalogVersion: string;
  blocks: NormalizedBlockDefinition[];
  metadata?: JsonObject;
}

export interface SerializeCatalogOptions {
  metadata?: JsonObject;
}

export interface SerializeMachineOptions extends CompileMachineOptions {
  catalogVersion?: string;
  controls?: MachineControls;
  metadata?: JsonObject;
}

export function serializeBlockCatalog(
  source: BlockCatalog | readonly BlockDefinition[],
  options: SerializeCatalogOptions = {},
): SerializedBlockCatalog {
  const catalog = source instanceof BlockCatalog ? source : new BlockCatalog().registerMany(source);
  const blocks = [...catalog.list()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((block) => canonicalizeDocument(block));
  const metadata = options.metadata ? canonicalizeDocument(options.metadata) : undefined;
  const catalogVersion = computeCatalogVersion(blocks);

  return {
    schemaVersion: SERIALIZED_CATALOG_SCHEMA_VERSION,
    catalogVersion,
    blocks,
    metadata,
  };
}

export function serializeMachineEnvelope(
  plan: MachinePlan,
  source: BlockCatalog | readonly BlockDefinition[],
  options: SerializeMachineOptions = {},
): SerializedMachineEnvelope {
  const { catalogVersion, controls, metadata } = options;

  return {
    schemaVersion: SERIALIZED_MACHINE_SCHEMA_VERSION,
    catalogVersion: catalogVersion ?? serializeBlockCatalog(source).catalogVersion,
    plan: canonicalizeDocument(plan),
    controls: controls ? canonicalizeDocument(controls) : undefined,
    metadata: metadata ? canonicalizeDocument(metadata) : undefined,
  };
}

export function compileMachineEnvelope(
  graph: BlockGraph,
  catalog: BlockCatalog,
  options: SerializeMachineOptions = {},
): SerializedMachineEnvelope {
  const { catalogVersion, controls, metadata, ...compileOptions } = options;
  const plan = compileMachinePlan(graph, catalog, compileOptions);
  return serializeMachineEnvelope(plan, catalog, {
    catalogVersion,
    controls: controls ?? generateMachineControls(plan, catalog, graph),
    metadata,
  });
}

export function canonicalJsonStringify(value: JsonValue | Record<string, unknown> | unknown[]): string {
  return JSON.stringify(canonicalizeJsonValue(value));
}

export function computeCatalogVersion(blocks: readonly NormalizedBlockDefinition[]): string {
  const payload = {
    schemaVersion: SERIALIZED_CATALOG_SCHEMA_VERSION,
    blocks,
  };
  return `smcat1-${stableHashText(canonicalJsonStringify(payload))}`;
}

export function canonicalizeJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot serialize non-finite number '${value}'.`);
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, entry]) => [key, canonicalizeJsonValue(entry)] as const);
    return Object.fromEntries(entries);
  }

  throw new Error(`Cannot serialize value of type '${typeof value}'.`);
}

function canonicalizeDocument<T>(value: T): T {
  return canonicalizeJsonValue(value) as unknown as T;
}

function stableHashText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let hash = 0xcbf29ce484222325n;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }

  return hash.toString(16).padStart(16, "0");
}
