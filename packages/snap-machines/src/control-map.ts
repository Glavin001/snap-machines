/**
 * Machine controls v3.
 *
 * This module keeps the direct per-actuator editor model (`ControlMap`) used by
 * the builder UI, but the serialized schema now stores two reversible schemes:
 * `bindings` and `controller`.
 */
import type { BlockCatalog } from "./schema.js";
import type { BlockGraph } from "./graph.js";
import type { MachinePlan, PlannedJointMotor } from "./compile/plan.js";
import type { RuntimeInputState } from "./adapters/rapier.js";

// ---------------------------------------------------------------------------
// Builder-facing actuator entries
// ---------------------------------------------------------------------------

export type ActuatorType = "velocity" | "position" | "trigger";
export type MachineActuatorTargetKind = "joint" | "behavior";
export type MachineControlScheme = "bindings" | "controller";
export type MachineInputProfileKind = "keyboard" | "gamepad";

export interface ActuatorEntry {
  /** Unique actuator id used by bindings and controller outputs. */
  id: string;
  /** Raw joint / behavior id from the compiled machine plan. */
  targetId: string;
  targetKind: MachineActuatorTargetKind;
  /** Human-readable label: "Motor Wheel (fl-wheel)" */
  label: string;
  /** Source block id in the graph */
  blockId: string;
  /** Block definition name */
  blockName: string;
  actuatorType: ActuatorType;
  /** Unique key in RuntimeInputState, e.g. "ctrl:joint:..." */
  actionName: string;
  /** Physical keyboard code for +1 direction (e.g. "KeyE", "Space") */
  positiveKey: string;
  /** Physical keyboard code for -1 direction (e.g. "KeyQ"). Empty = no negative key (triggers) */
  negativeKey: string;
  enabled: boolean;
  /**
   * velocity: target speed (rad/s or m/s)
   * position: rate of position change (rad/s or m/s)
   * trigger: force multiplier
   */
  scale: number;
  /** Position-mode: accumulated position target (mutated each frame) */
  currentTarget: number;
  /** Position-mode default target restored on reset/disable */
  defaultTarget?: number;
  /** Actual joint position (mutated each frame by the physics scene) */
  actualPosition: number;
  /** Estimated joint velocity (mutated by the app/runtime) */
  actualVelocity?: number;
  /** Last actuator command sent to runtime */
  lastOutput?: number;
  /** Joint limits used to clamp the position accumulator */
  limits?: { min: number; max: number };
  /** Motor defaults copied from the compiled plan for build-time editing/inspection */
  motorMode?: PlannedJointMotor["mode"];
  targetPosition?: number;
  targetVelocity?: number;
  stiffness?: number;
  damping?: number;
  maxForce?: number;
  inputTarget?: PlannedJointMotor["inputTarget"];
  /** Original action name from the block definition */
  originalAction: string;
  /** Original InputBinding.scale (before absorption) */
  originalScale: number;
}

export type ControlMap = ActuatorEntry[];

// ---------------------------------------------------------------------------
// Serialized machine controls v3
// ---------------------------------------------------------------------------

export interface MachineButtonSource {
  device: "keyboard" | "gamepadButton";
  code: string;
  gamepadIndex?: number;
}

export interface MachineAxisSource {
  device: "gamepadAxis";
  axis: number;
  gamepadIndex?: number;
}

export interface MachineButtonPairBinding {
  kind: "buttonPair";
  targetId: string;
  positive: MachineButtonSource;
  negative?: MachineButtonSource;
  scale: number;
  enabled: boolean;
}

export interface MachineAxisBinding {
  kind: "axis";
  targetId: string;
  source: MachineAxisSource;
  scale: number;
  invert?: boolean;
  deadzone?: number;
  enabled: boolean;
}

export type MachineInputBinding = MachineButtonPairBinding | MachineAxisBinding;

export interface MachineInputProfile {
  id: string;
  kind: MachineInputProfileKind;
  bindings: MachineInputBinding[];
}

export interface MachineBindingScheme {
  defaultProfileId: string;
  profiles: MachineInputProfile[];
}

export interface MachineCommandDefinition {
  id: string;
  label: string;
  range: { min: number; max: number };
  defaultValue: number;
}

export interface MachineActuatorRoleAssignment {
  actuatorId: string;
  roles: string[];
}

export interface MachineControllerScript {
  language: "javascript";
  source: string;
}

export interface MachineControllerScheme {
  defaultProfileId: string;
  commands: MachineCommandDefinition[];
  profiles: MachineInputProfile[];
  actuatorRoles: MachineActuatorRoleAssignment[];
  script?: MachineControllerScript;
}

export interface MachineControls {
  activeScheme: MachineControlScheme;
  bindings: MachineBindingScheme;
  controller: MachineControllerScheme;
}

export interface MachineInputSnapshot {
  keysDown?: ReadonlySet<string>;
  gamepads?: readonly (Gamepad | null | undefined)[];
}

export interface MachineControllerActuatorMeta {
  actuatorId: string;
  blockId: string;
  blockName: string;
  label: string;
  actuatorType: ActuatorType;
  roles: string[];
}

export interface MachineControllerStepFrame {
  time: number;
  dt: number;
  commands: Record<string, number>;
  previousCommands: Record<string, number>;
  readback: Record<string, { position: number; velocity: number; lastOutput: number }>;
  actuators: {
    all: MachineControllerActuatorMeta[];
    byId: Record<string, MachineControllerActuatorMeta>;
    byRole: Record<string, MachineControllerActuatorMeta[]>;
  };
}

export interface MachineControllerScriptGlobals {
  commands: Record<string, string>;
  actuators: Record<string, string>;
  config: {
    commands: Record<string, {
      id: string;
      label: string;
      min: number;
      max: number;
      defaultValue: number;
    }>;
    actuators: Record<string, {
      actuatorId: string;
      label: string;
      actuatorType: ActuatorType;
      scale: number;
      defaultTarget: number;
      min: number | null;
      max: number | null;
      roles: string[];
    }>;
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

interface KeyDefaults {
  pos: string;
  neg: string;
  type: ActuatorType;
}

const DEFAULT_KEY_MAP: Record<string, KeyDefaults> = {
  motorSpin: { pos: "KeyE", neg: "KeyQ", type: "velocity" },
  hingeSpin: { pos: "KeyE", neg: "KeyQ", type: "velocity" },
  sliderPos: { pos: "KeyE", neg: "KeyQ", type: "position" },
  armPitch: { pos: "KeyW", neg: "KeyS", type: "position" },
  armYaw: { pos: "KeyD", neg: "KeyA", type: "position" },
  flapDeflect: { pos: "KeyW", neg: "KeyS", type: "position" },
  throttle: { pos: "Space", neg: "", type: "trigger" },
  propellerSpin: { pos: "Space", neg: "", type: "trigger" },
  gripperClose: { pos: "KeyG", neg: "", type: "trigger" },
};

const DEFAULT_FALLBACK: KeyDefaults = { pos: "KeyE", neg: "KeyQ", type: "velocity" };
const DEFAULT_BINDINGS_PROFILE_ID = "keyboard.default";
const DEFAULT_CONTROLLER_PROFILE_ID = "controller.keyboard.default";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface OriginalBinding {
  action: string;
  scale: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sanitizeIdentifier(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized.length > 0 ? sanitized : "value";
}

function uniqueCommandId(base: string, seen: Set<string>): string {
  let next = sanitizeIdentifier(base);
  if (!seen.has(next)) {
    seen.add(next);
    return next;
  }
  let index = 2;
  while (seen.has(`${next}_${index}`)) {
    index += 1;
  }
  const unique = `${next}_${index}`;
  seen.add(unique);
  return unique;
}

export function actuatorIdForTarget(kind: MachineActuatorTargetKind, targetId: string): string {
  return `${kind}:${targetId}`;
}

export function controlTargetForEntry(entry: Pick<ActuatorEntry, "targetKind" | "targetId">) {
  return { kind: entry.targetKind, id: entry.targetId };
}

function defaultKeyboardProfile(controls: MachineControls | null | undefined): MachineInputProfile | null {
  if (!controls) {
    return null;
  }
  const preferred = controls.bindings.profiles.find(
    (profile) => profile.id === controls.bindings.defaultProfileId && profile.kind === "keyboard",
  );
  if (preferred) {
    return preferred;
  }
  return controls.bindings.profiles.find((profile) => profile.kind === "keyboard") ?? null;
}

export function defaultControllerProfile(controls: MachineControls | null | undefined): MachineInputProfile | null {
  if (!controls) {
    return null;
  }
  const preferred = controls.controller.profiles.find(
    (profile) => profile.id === controls.controller.defaultProfileId,
  );
  if (preferred) {
    return preferred;
  }
  return controls.controller.profiles[0] ?? null;
}

function ensureBindingProfile(profile: MachineInputProfile | null | undefined, profileId = DEFAULT_BINDINGS_PROFILE_ID): MachineInputProfile {
  if (profile) {
    return profile;
  }
  return { id: profileId, kind: "keyboard", bindings: [] };
}

function ensureControllerProfile(profile: MachineInputProfile | null | undefined, profileId = DEFAULT_CONTROLLER_PROFILE_ID): MachineInputProfile {
  if (profile) {
    return profile;
  }
  return { id: profileId, kind: "keyboard", bindings: [] };
}

function resolveActuatorType(
  inputTarget: string | undefined,
  originalAction: string,
): ActuatorType {
  if (inputTarget === "position" || inputTarget === "both") {
    return "position";
  }
  if (inputTarget === "velocity") {
    return "velocity";
  }
  return DEFAULT_KEY_MAP[originalAction]?.type ?? "velocity";
}

// ---------------------------------------------------------------------------
// 1. Rewrite plan motor actions to unique per-actuator names
// ---------------------------------------------------------------------------

export function rewritePlanActions(plan: MachinePlan): Map<string, OriginalBinding> {
  const originals = new Map<string, OriginalBinding>();

  for (const joint of plan.joints) {
    if (!joint.motor?.input) continue;
    const binding = joint.motor.input;
    const uniqueAction = `ctrl:joint:${joint.id}`;
    const effectiveScale = (binding.scale ?? 1) * (binding.invert ? -1 : 1);
    originals.set(uniqueAction, { action: binding.action, scale: effectiveScale });
    joint.motor.input = { ...binding, action: uniqueAction, scale: 1, invert: false };
  }

  for (const behavior of plan.behaviors) {
    if (!behavior.input) continue;
    const binding = behavior.input;
    const uniqueAction = `ctrl:behavior:${behavior.id}`;
    const effectiveScale = (binding.scale ?? 1) * (binding.invert ? -1 : 1);
    originals.set(uniqueAction, { action: binding.action, scale: effectiveScale });
    behavior.input = { ...binding, action: uniqueAction, scale: 1, invert: false };
  }

  return originals;
}

// ---------------------------------------------------------------------------
// 2. Generate default ControlMap from the rewritten plan
// ---------------------------------------------------------------------------

export function generateControlMap(
  plan: MachinePlan,
  originals: Map<string, OriginalBinding>,
  catalog: BlockCatalog,
  graph: BlockGraph,
): ControlMap {
  const entries: ActuatorEntry[] = [];

  for (const [actionName, { action: originalAction, scale: originalScale }] of originals) {
    let targetId = "";
    let targetKind: MachineActuatorTargetKind = "joint";
    let blockId = "";
    let actuatorType: ActuatorType = "velocity";
    let limits: { min: number; max: number } | undefined;
    let defaultTarget = 0;
    let motorMode: ActuatorEntry["motorMode"];
    let targetPosition: number | undefined;
    let targetVelocity: number | undefined;
    let stiffness: number | undefined;
    let damping: number | undefined;
    let maxForce: number | undefined;
    let inputTarget: ActuatorEntry["inputTarget"];

    if (actionName.startsWith("ctrl:joint:")) {
      const jointId = actionName.slice("ctrl:joint:".length);
      const joint = plan.joints.find((candidate) => candidate.id === jointId);
      if (joint) {
        targetId = joint.id;
        targetKind = "joint";
        blockId = joint.blockId;
        limits = joint.limits;
        actuatorType = resolveActuatorType(joint.motor?.inputTarget, originalAction);
        defaultTarget = joint.motor?.targetPosition ?? 0;
        motorMode = joint.motor?.mode;
        targetPosition = joint.motor?.targetPosition;
        targetVelocity = joint.motor?.targetVelocity;
        stiffness = joint.motor?.stiffness;
        damping = joint.motor?.damping;
        maxForce = joint.motor?.maxForce;
        inputTarget = joint.motor?.inputTarget;
      }
    } else if (actionName.startsWith("ctrl:behavior:")) {
      const behaviorId = actionName.slice("ctrl:behavior:".length);
      const behavior = plan.behaviors.find((candidate) => candidate.id === behaviorId);
      if (behavior) {
        targetId = behavior.id;
        targetKind = "behavior";
        blockId = behavior.blockId;
        actuatorType = "trigger";
      }
    }

    let blockName = blockId;
    const node = graph.getNode(blockId);
    if (node) {
      try {
        blockName = catalog.get(node.typeId).name;
      } catch {
        blockName = node.typeId;
      }
    }

    const defaults = DEFAULT_KEY_MAP[originalAction] ?? DEFAULT_FALLBACK;
    entries.push({
      id: actuatorIdForTarget(targetKind, targetId),
      targetId,
      targetKind,
      label: `${blockName} (${blockId})`,
      blockId,
      blockName,
      actuatorType,
      actionName,
      positiveKey: defaults.pos,
      negativeKey: defaults.neg,
      enabled: true,
      scale: originalScale,
      currentTarget: actuatorType === "position" ? defaultTarget : 0,
      defaultTarget,
      actualPosition: 0,
      actualVelocity: 0,
      lastOutput: 0,
      limits,
      motorMode,
      targetPosition,
      targetVelocity,
      stiffness,
      damping,
      maxForce,
      inputTarget,
      originalAction,
      originalScale,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// 3. Bindings scheme helpers
// ---------------------------------------------------------------------------

export function createMachineBindingsFromControlMap(
  controlMap: ControlMap,
  options: { profileId?: string } = {},
): MachineBindingScheme {
  const profileId = options.profileId ?? DEFAULT_BINDINGS_PROFILE_ID;
  return {
    defaultProfileId: profileId,
    profiles: [{
      id: profileId,
      kind: "keyboard",
      bindings: controlMap.map((entry) => ({
        kind: "buttonPair",
        targetId: entry.id,
        positive: { device: "keyboard", code: entry.positiveKey },
        negative: entry.negativeKey ? { device: "keyboard", code: entry.negativeKey } : undefined,
        enabled: entry.enabled,
        scale: entry.scale,
      })),
    }],
  };
}

export function applyMachineBindings(
  controlMap: ControlMap,
  bindings: MachineBindingScheme | null | undefined,
): ControlMap {
  if (!bindings) {
    return controlMap;
  }
  const profile = ensureBindingProfile(
    bindings.profiles.find((candidate) => candidate.id === bindings.defaultProfileId) ?? bindings.profiles[0],
  );
  const byTargetId = new Map<string, MachineInputBinding>();
  for (const binding of profile.bindings) {
    byTargetId.set(binding.targetId, binding);
  }

  return controlMap.map((entry) => {
    const binding = byTargetId.get(entry.id);
    if (!binding) {
      return entry;
    }
    if (binding.kind === "buttonPair") {
      return {
        ...entry,
        positiveKey: binding.positive.code,
        negativeKey: binding.negative?.code ?? "",
        enabled: binding.enabled,
        scale: binding.scale,
      };
    }
    return {
      ...entry,
      enabled: binding.enabled,
      scale: (binding.invert ? -1 : 1) * binding.scale,
    };
  });
}

// Backwards-compatible helper name retained for the app/tests.
export const createMachineDirectControlsFromControlMap = createMachineBindingsFromControlMap;
export const applyMachineControls = (
  controlMap: ControlMap,
  controls: MachineControls | null | undefined,
) => applyMachineBindings(controlMap, controls?.bindings);

// ---------------------------------------------------------------------------
// 4. Controller scheme helpers
// ---------------------------------------------------------------------------

export function createEmptyMachineControllerScheme(): MachineControllerScheme {
  return {
    defaultProfileId: DEFAULT_CONTROLLER_PROFILE_ID,
    commands: [],
    profiles: [{
      id: DEFAULT_CONTROLLER_PROFILE_ID,
      kind: "keyboard",
      bindings: [],
    }],
    actuatorRoles: [],
  };
}

export function defaultRolesForEntry(entry: Pick<ActuatorEntry, "id" | "blockId" | "originalAction">): string[] {
  return [
    sanitizeIdentifier(entry.id),
    sanitizeIdentifier(entry.blockId),
    sanitizeIdentifier(entry.originalAction),
  ].filter((value, index, array) => array.indexOf(value) === index);
}

export function createMachineControllerSeedFromControlMap(
  controlMap: ControlMap,
  options: { profileId?: string } = {},
): MachineControllerScheme {
  const profileId = options.profileId ?? DEFAULT_CONTROLLER_PROFILE_ID;
  const seen = new Set<string>();
  const commandIds = new Map<string, string>();

  const commands = controlMap.map((entry) => {
    const commandId = uniqueCommandId(
      `${sanitizeIdentifier(entry.blockId)}_${sanitizeIdentifier(entry.originalAction)}`,
      seen,
    );
    commandIds.set(entry.id, commandId);
    return {
      id: commandId,
      label: entry.label,
      range: entry.actuatorType === "trigger" ? { min: 0, max: 1 } : { min: -1, max: 1 },
      defaultValue: 0,
    };
  });

  const bindings: MachineInputBinding[] = controlMap.map((entry) => ({
    kind: "buttonPair",
    targetId: commandIds.get(entry.id)!,
    positive: { device: "keyboard", code: entry.positiveKey },
    negative: entry.negativeKey ? { device: "keyboard", code: entry.negativeKey } : undefined,
    enabled: entry.enabled,
    scale: 1,
  }));

  const actuatorRoles = controlMap.map((entry) => ({
    actuatorId: entry.id,
    roles: defaultRolesForEntry(entry),
  }));

  return {
    defaultProfileId: profileId,
    commands,
    profiles: [{
      id: profileId,
      kind: "keyboard",
      bindings,
    }],
    actuatorRoles,
    script: {
      language: "javascript",
      source: generateStarterControllerSource(controlMap, commandIds),
    },
  };
}

export function buildControllerScriptGlobals(
  controlMap: ControlMap,
  controller: MachineControllerScheme,
): MachineControllerScriptGlobals {
  const commandConfig = Object.fromEntries(
    controller.commands.map((command) => [command.id, {
      id: command.id,
      label: command.label,
      min: command.range.min,
      max: command.range.max,
      defaultValue: command.defaultValue,
    }]),
  );

  const roleMap = new Map(controller.actuatorRoles.map((assignment) => [assignment.actuatorId, assignment.roles] as const));
  const seenActuatorAliases = new Set<string>();
  const actuators = Object.fromEntries(controlMap.map((entry) => {
    const alias = uniqueCommandId(sanitizeIdentifier(entry.id), seenActuatorAliases);
    return [alias, entry.id];
  }));

  const actuatorConfig = Object.fromEntries(
    Object.entries(actuators).map(([alias, actuatorId]) => {
      const entry = controlMap.find((candidate) => candidate.id === actuatorId)!;
      return [alias, {
        actuatorId,
        label: entry.label,
        actuatorType: entry.actuatorType,
        scale: Math.abs(entry.scale) || 1,
        defaultTarget: entry.defaultTarget ?? 0,
        min: entry.limits?.min ?? null,
        max: entry.limits?.max ?? null,
        roles: roleMap.get(entry.id) ?? defaultRolesForEntry(entry),
      }];
    }),
  );

  return {
    commands: Object.fromEntries(controller.commands.map((command) => [command.id, command.id])),
    actuators,
    config: {
      commands: commandConfig,
      actuators: actuatorConfig,
    },
  };
}

function generateStarterControllerSource(
  controlMap: ControlMap,
  commandIds: Map<string, string>,
): string {
  const globals = buildControllerScriptGlobals(controlMap, {
    defaultProfileId: DEFAULT_CONTROLLER_PROFILE_ID,
    commands: controlMap.map((entry) => ({
      id: commandIds.get(entry.id)!,
      label: entry.label,
      range: entry.actuatorType === "trigger" ? { min: 0, max: 1 } : { min: -1, max: 1 },
      defaultValue: 0,
    })),
    profiles: [],
    actuatorRoles: controlMap.map((entry) => ({
      actuatorId: entry.id,
      roles: defaultRolesForEntry(entry),
    })),
  });
  const outputBlocks = Object.entries(globals.actuators)
    .map(([actuatorAlias, actuatorId]) => {
      const commandId = commandIds.get(actuatorId)!;
      return `  {
    const actuator = config.actuators.${actuatorAlias};
    const command = ctx.commands.${commandId} ?? 0;
    if (actuator.actuatorType === "position") {
      const previousTarget = Number.isFinite(nextState.positionTargets[actuator.actuatorId])
        ? nextState.positionTargets[actuator.actuatorId]
        : actuator.defaultTarget;
      let target = previousTarget + command * actuator.scale * ctx.dt;
      if (actuator.min !== null && actuator.max !== null) {
        target = clamp(target, actuator.min, actuator.max);
      }
      nextState.positionTargets[actuator.actuatorId] = target;
      outputs[actuators.${actuatorAlias}] = target;
    } else {
      outputs[actuators.${actuatorAlias}] = command * actuator.scale;
    }
  }`;
    })
    .join("\n\n");
  return `const { clamp } = helpers;

function init() {
  const positionTargets = {};
  for (const actuator of Object.values(config.actuators)) {
    if (actuator.actuatorType === "position") {
      positionTargets[actuator.actuatorId] = actuator.defaultTarget ?? 0;
    }
  }
  return { positionTargets };
}

function step(ctx, state) {
  const nextState = {
    positionTargets: { ...(state?.positionTargets ?? {}) },
  };
  const outputs = {};
${outputBlocks}

  return { state: nextState, outputs };
}
`;
}

export function createMachineControlsFromControlMap(
  controlMap: ControlMap,
  options: { activeScheme?: MachineControlScheme } = {},
): MachineControls {
  return {
    activeScheme: options.activeScheme ?? "bindings",
    bindings: createMachineBindingsFromControlMap(controlMap),
    controller: createEmptyMachineControllerScheme(),
  };
}

export function generateMachineControls(
  plan: MachinePlan,
  catalog: BlockCatalog,
  graph: BlockGraph,
  options: { activeScheme?: MachineControlScheme } = {},
): MachineControls {
  const interactivePlan = JSON.parse(JSON.stringify(plan)) as MachinePlan;
  const originals = rewritePlanActions(interactivePlan);
  const controlMap = generateControlMap(interactivePlan, originals, catalog, graph);
  return createMachineControlsFromControlMap(controlMap, options);
}

export function synchronizeMachineControls(
  controlMap: ControlMap,
  controls: MachineControls | null | undefined,
): MachineControls {
  const base = controls ?? createMachineControlsFromControlMap(controlMap);
  const validActuators = new Set(controlMap.map((entry) => entry.id));

  const syncedBindings: MachineBindingScheme = {
    defaultProfileId: base.bindings.defaultProfileId || DEFAULT_BINDINGS_PROFILE_ID,
    profiles: (base.bindings.profiles.length > 0 ? base.bindings.profiles : [ensureBindingProfile(null)]).map((profile) => ({
      ...profile,
      bindings: profile.bindings.filter((binding) => validActuators.has(binding.targetId)),
    })),
  };

  const roleMap = new Map(base.controller.actuatorRoles.map((assignment) => [assignment.actuatorId, assignment] as const));
  const actuatorRoles = controlMap.map((entry) => roleMap.get(entry.id) ?? {
    actuatorId: entry.id,
    roles: defaultRolesForEntry(entry),
  });

  return {
    activeScheme: base.activeScheme,
    bindings: syncedBindings,
    controller: {
      ...base.controller,
      defaultProfileId: base.controller.defaultProfileId || DEFAULT_CONTROLLER_PROFILE_ID,
      profiles: base.controller.profiles.length > 0
        ? base.controller.profiles
        : [ensureControllerProfile(null)],
      actuatorRoles,
    },
  };
}

export function ensureControllerSchemeFromBindings(
  controlMap: ControlMap,
  controls: MachineControls,
): MachineControls {
  const hasControllerContent =
    controls.controller.commands.length > 0 ||
    controls.controller.profiles.some((profile) => profile.bindings.length > 0) ||
    (controls.controller.script?.source?.trim().length ?? 0) > 0;

  if (hasControllerContent) {
    return synchronizeMachineControls(controlMap, controls);
  }

  return {
    ...controls,
    controller: createMachineControllerSeedFromControlMap(controlMap),
  };
}

export function buildControllerActuatorMeta(
  controlMap: ControlMap,
  controller: MachineControllerScheme,
): MachineControllerActuatorMeta[] {
  const roleMap = new Map(controller.actuatorRoles.map((assignment) => [assignment.actuatorId, assignment.roles] as const));
  return controlMap.map((entry) => ({
    actuatorId: entry.id,
    blockId: entry.blockId,
    blockName: entry.blockName,
    label: entry.label,
    actuatorType: entry.actuatorType,
    roles: roleMap.get(entry.id) ?? defaultRolesForEntry(entry),
  }));
}

export function buildControllerActuatorIndex(
  controlMap: ControlMap,
  controller: MachineControllerScheme,
): MachineControllerStepFrame["actuators"] {
  const all = buildControllerActuatorMeta(controlMap, controller);
  const byId = Object.fromEntries(all.map((entry) => [entry.actuatorId, entry]));
  const byRole: Record<string, MachineControllerActuatorMeta[]> = {};
  for (const entry of all) {
    for (const role of entry.roles) {
      (byRole[role] ??= []).push(entry);
    }
  }
  return { all, byId, byRole };
}

// ---------------------------------------------------------------------------
// 5. Device input normalization
// ---------------------------------------------------------------------------

function readButtonSource(source: MachineButtonSource, snapshot: MachineInputSnapshot): number {
  switch (source.device) {
    case "keyboard":
      return snapshot.keysDown?.has(source.code) ? 1 : 0;
    case "gamepadButton": {
      const gamepad = snapshot.gamepads?.[source.gamepadIndex ?? 0];
      if (!gamepad) return 0;
      const buttonIndex = Number(source.code);
      const button = gamepad.buttons?.[buttonIndex];
      return typeof button?.value === "number" ? button.value : button?.pressed ? 1 : 0;
    }
    default:
      return 0;
  }
}

function readAxisSource(source: MachineAxisSource, snapshot: MachineInputSnapshot): number {
  const gamepad = snapshot.gamepads?.[source.gamepadIndex ?? 0];
  if (!gamepad) return 0;
  return gamepad.axes?.[source.axis] ?? 0;
}

export function sampleInputProfile(
  profile: MachineInputProfile | null | undefined,
  snapshot: MachineInputSnapshot,
): Record<string, number> {
  if (!profile) {
    return {};
  }
  const result: Record<string, number> = {};

  for (const binding of profile.bindings) {
    if (!binding.enabled) continue;
    if (binding.kind === "buttonPair") {
      const positive = readButtonSource(binding.positive, snapshot);
      const negative = binding.negative ? readButtonSource(binding.negative, snapshot) : 0;
      result[binding.targetId] = (positive - negative) * binding.scale;
      continue;
    }

    let value = readAxisSource(binding.source, snapshot) * binding.scale;
    if (binding.invert) {
      value *= -1;
    }
    if (binding.deadzone !== undefined && Math.abs(value) < binding.deadzone) {
      value = 0;
    }
    result[binding.targetId] = value;
  }

  return result;
}

export function readControllerCommands(
  controls: MachineControls | null | undefined,
  snapshot: MachineInputSnapshot,
): Record<string, number> {
  if (!controls) {
    return {};
  }
  const profile = defaultControllerProfile(controls);
  const sampled = sampleInputProfile(profile, snapshot);
  const commands: Record<string, number> = {};
  for (const command of controls.controller.commands) {
    commands[command.id] = clamp(sampled[command.id] ?? command.defaultValue, command.range.min, command.range.max);
  }
  return commands;
}

// ---------------------------------------------------------------------------
// 6. Runtime actuator values and input state
// ---------------------------------------------------------------------------

export function buildRuntimeInputFromActuatorValues(
  controlMap: ControlMap,
  values: Record<string, number>,
): RuntimeInputState {
  const input: RuntimeInputState = {};
  for (const entry of controlMap) {
    const value = values[entry.id] ?? 0;
    entry.lastOutput = value;
    input[entry.actionName] = value;

    if (entry.actuatorType === "position") {
      const posError = value - entry.actualPosition;
      const KV = 3.0;
      const MAX_VEL = 5.0;
      input[`${entry.actionName}:vff`] = clamp(KV * posError, -MAX_VEL, MAX_VEL);
    }
  }
  return input;
}

export function updateControlMapFromBindingValues(
  controlMap: ControlMap,
  values: Record<string, number>,
  dt: number,
): Record<string, number> {
  const outputs: Record<string, number> = {};

  for (const entry of controlMap) {
    if (!entry.enabled) {
      if (entry.actuatorType === "position") {
        entry.currentTarget = entry.defaultTarget ?? 0;
        outputs[entry.id] = entry.currentTarget;
      } else {
        outputs[entry.id] = 0;
      }
      continue;
    }

    const value = values[entry.id] ?? 0;
    switch (entry.actuatorType) {
      case "velocity":
      case "trigger":
        outputs[entry.id] = value;
        break;
      case "position":
        entry.currentTarget += value * dt;
        if (entry.limits) {
          entry.currentTarget = clamp(entry.currentTarget, entry.limits.min, entry.limits.max);
        }
        outputs[entry.id] = entry.currentTarget;
        break;
    }
  }

  return outputs;
}

export function buildDirectRuntimeInput(
  controlMap: ControlMap,
  controls: MachineControls | null | undefined,
  snapshot: MachineInputSnapshot,
  dt: number,
): RuntimeInputState {
  const profile = defaultKeyboardProfile(controls) ?? defaultControllerProfile(controls);
  const bindingValues = sampleInputProfile(profile, snapshot);
  const actuatorValues = updateControlMapFromBindingValues(controlMap, bindingValues, dt);
  return buildRuntimeInputFromActuatorValues(controlMap, actuatorValues);
}

/**
 * Legacy convenience wrapper for the existing keyboard-based play mode.
 */
export function updateControlMapInput(
  controlMap: ControlMap,
  keysDown: Set<string>,
  dt: number,
): RuntimeInputState {
  const bindingValues: Record<string, number> = {};
  for (const entry of controlMap) {
    const positive = entry.positiveKey !== "" && keysDown.has(entry.positiveKey) ? 1 : 0;
    const negative = entry.negativeKey !== "" && keysDown.has(entry.negativeKey) ? 1 : 0;
    bindingValues[entry.id] = (positive - negative) * entry.scale;
  }
  const actuatorValues = updateControlMapFromBindingValues(controlMap, bindingValues, dt);
  return buildRuntimeInputFromActuatorValues(controlMap, actuatorValues);
}

export function resetControlMapState(controlMap: ControlMap): void {
  for (const entry of controlMap) {
    entry.currentTarget = entry.defaultTarget ?? 0;
    entry.actualPosition = 0;
    entry.actualVelocity = 0;
    entry.lastOutput = 0;
  }
}

export function buildControllerReadback(controlMap: ControlMap) {
  return Object.fromEntries(
    controlMap.map((entry) => [
      entry.id,
      {
        position: entry.actualPosition,
        velocity: entry.actualVelocity ?? 0,
        lastOutput: entry.lastOutput ?? 0,
      },
    ]),
  );
}

// ---------------------------------------------------------------------------
// 7. Labels
// ---------------------------------------------------------------------------

export function keyboardCodeLabel(code: string): string {
  if (code === "") {
    return "--";
  }
  if (code === "Space") {
    return "Space";
  }
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }

  const aliases: Record<string, string> = {
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Minus: "-",
    Equal: "=",
    Backquote: "`",
  };

  return aliases[code] ?? code;
}
