/**
 * Per-motor keyboard binding system.
 *
 * After compilation produces a MachinePlan, this module:
 * 1. Rewrites each motor/behavior input action to a unique per-actuator name
 * 2. Generates a ControlMap with default key bindings
 * 3. Every frame, updates position accumulators and builds RuntimeInputState
 */
import type { BlockCatalog } from "./schema.js";
import type { BlockGraph } from "./graph.js";
import type { MachinePlan, PlannedJointMotor } from "./compile/plan.js";
import type { RuntimeInputState } from "./adapters/rapier.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActuatorEntry {
  /** Unique identifier: joint.id or behavior.id */
  id: string;
  /** Human-readable label: "Motor Wheel (fl-wheel)" */
  label: string;
  /** Source block id in the graph */
  blockId: string;
  /** Block definition name */
  blockName: string;

  /**
   * - velocity: hold key = spin at speed, release = stop (stateless)
   * - position: hold key = target increments, release = hold position (stateful)
   * - trigger: hold key = fire, release = stop (stateless)
   */
  actuatorType: "velocity" | "position" | "trigger";

  /** Unique key in RuntimeInputState, e.g. "ctrl:joint:..." */
  actionName: string;

  /** Key for +1 direction (e.g. "e", " ") */
  positiveKey: string;
  /** Key for -1 direction (e.g. "q"). Empty = no negative key (triggers) */
  negativeKey: string;

  /** Whether this actuator currently participates in runtime input updates */
  enabled: boolean;

  /**
   * velocity: target speed (rad/s or m/s)
   * position: rate of position change (rad/s or m/s)
   * trigger: force multiplier
   * Negative = reversed direction. Absorbs the original InputBinding.scale + invert.
   */
  scale: number;

  /** Position-mode: accumulated position target (mutated each frame) */
  currentTarget: number;
  /** Position-mode default target restored on reset/disable */
  defaultTarget?: number;
  /** Actual joint position (mutated each frame by the physics scene) */
  actualPosition: number;
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
// Default key assignment table
// ---------------------------------------------------------------------------

interface KeyDefaults {
  pos: string;
  neg: string;
  type: ActuatorEntry["actuatorType"];
}

const DEFAULT_KEY_MAP: Record<string, KeyDefaults> = {
  motorSpin: { pos: "e", neg: "q", type: "velocity" },
  hingeSpin: { pos: "e", neg: "q", type: "velocity" },
  sliderPos: { pos: "e", neg: "q", type: "position" },
  armPitch: { pos: "w", neg: "s", type: "position" },
  armYaw: { pos: "d", neg: "a", type: "position" },
  flapDeflect: { pos: "w", neg: "s", type: "position" },
  throttle: { pos: " ", neg: "", type: "trigger" },
  propellerSpin: { pos: " ", neg: "", type: "trigger" },
  gripperClose: { pos: "g", neg: "", type: "trigger" },
};

const DEFAULT_FALLBACK: KeyDefaults = { pos: "e", neg: "q", type: "velocity" };

// ---------------------------------------------------------------------------
// 1. Rewrite plan motor actions to unique per-actuator names
// ---------------------------------------------------------------------------

export interface OriginalBinding {
  action: string;
  scale: number;
}

/**
 * Mutates the plan in-place: replaces each motor/behavior input action with
 * a unique name and sets scale=1, invert=false. Returns a map from the new
 * unique action name to the original {action, scale}.
 */
export function rewritePlanActions(plan: MachinePlan): Map<string, OriginalBinding> {
  const originals = new Map<string, OriginalBinding>();

  for (const joint of plan.joints) {
    if (joint.motor?.input) {
      const binding = joint.motor.input;
      const uniqueAction = `ctrl:joint:${joint.id}`;
      const effectiveScale = (binding.scale ?? 1) * (binding.invert ? -1 : 1);

      originals.set(uniqueAction, {
        action: binding.action,
        scale: effectiveScale,
      });

      // Clone the input to avoid mutating shared references from the catalog
      joint.motor.input = { ...binding, action: uniqueAction, scale: 1, invert: false };
    }
  }

  for (const behavior of plan.behaviors) {
    if (behavior.input) {
      const binding = behavior.input;
      const uniqueAction = `ctrl:behavior:${behavior.id}`;
      const effectiveScale = (binding.scale ?? 1) * (binding.invert ? -1 : 1);

      originals.set(uniqueAction, {
        action: binding.action,
        scale: effectiveScale,
      });

      // Clone the input to avoid mutating shared references from the catalog
      behavior.input = { ...binding, action: uniqueAction, scale: 1, invert: false };
    }
  }

  return originals;
}

// ---------------------------------------------------------------------------
// 2. Generate default ControlMap from the rewritten plan
// ---------------------------------------------------------------------------

/**
 * Determine the actuator type from the motor's inputTarget and the
 * DEFAULT_KEY_MAP. Motor definition takes precedence.
 */
function resolveActuatorType(
  inputTarget: string | undefined,
  originalAction: string,
): ActuatorEntry["actuatorType"] {
  if (inputTarget === "position" || inputTarget === "both") {
    return "position";
  }
  if (inputTarget === "velocity") {
    return "velocity";
  }
  // Fallback: use the DEFAULT_KEY_MAP type if known
  return DEFAULT_KEY_MAP[originalAction]?.type ?? "velocity";
}

export function generateControlMap(
  plan: MachinePlan,
  originals: Map<string, OriginalBinding>,
  catalog: BlockCatalog,
  graph: BlockGraph,
): ControlMap {
  const entries: ActuatorEntry[] = [];

  for (const [actionName, { action: originalAction, scale: originalScale }] of originals) {
    let id = "";
    let blockId = "";
    let actuatorType: ActuatorEntry["actuatorType"] = "velocity";
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
      const joint = plan.joints.find((j) => j.id === jointId);
      if (joint) {
        id = joint.id;
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
      const behavior = plan.behaviors.find((b) => b.id === behaviorId);
      if (behavior) {
        id = behavior.id;
        blockId = behavior.blockId;
        actuatorType = "trigger";
      }
    }

    // Get block name from catalog
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
      id,
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
// 3. Update ControlMap state and build RuntimeInputState (called every frame)
// ---------------------------------------------------------------------------

/**
 * Read keysDown, update position accumulators, and produce the input state.
 * Mutates position-mode entries' `currentTarget`.
 */
export function updateControlMapInput(
  controlMap: ControlMap,
  keysDown: Set<string>,
  dt: number,
): RuntimeInputState {
  const input: RuntimeInputState = {};

  for (const entry of controlMap) {
    if (!entry.enabled) {
      if (entry.actuatorType === "position") {
        entry.currentTarget = entry.defaultTarget ?? 0;
        input[entry.actionName] = entry.currentTarget;
        const posError = entry.currentTarget - entry.actualPosition;
        const KV = 3.0;
        const MAX_VEL = 5.0;
        input[entry.actionName + ":vff"] = Math.max(-MAX_VEL, Math.min(MAX_VEL, KV * posError));
      } else {
        input[entry.actionName] = 0;
      }
      continue;
    }

    const posDown = entry.positiveKey !== "" && keysDown.has(entry.positiveKey);
    const negDown = entry.negativeKey !== "" && keysDown.has(entry.negativeKey);

    switch (entry.actuatorType) {
      case "velocity": {
        const keyValue = (posDown ? 1 : 0) - (negDown ? 1 : 0);
        input[entry.actionName] = keyValue * entry.scale;
        break;
      }
      case "position": {
        const keyValue = (posDown ? 1 : 0) - (negDown ? 1 : 0);
        entry.currentTarget += keyValue * entry.scale * dt;
        // Clamp to joint limits
        if (entry.limits) {
          entry.currentTarget = Math.max(
            entry.limits.min,
            Math.min(entry.limits.max, entry.currentTarget),
          );
        }
        input[entry.actionName] = entry.currentTarget;

        // Velocity feedforward: Kv * positionError, clamped to max speed.
        // This makes the damping term actively drive toward the target
        // instead of only braking, eliminating dead zones and oscillation.
        const posError = entry.currentTarget - entry.actualPosition;
        const KV = 3.0;      // velocity gain: rad/s per radian of error
        const MAX_VEL = 5.0;  // clamp to prevent violent motion
        input[entry.actionName + ":vff"] = Math.max(-MAX_VEL, Math.min(MAX_VEL, KV * posError));
        break;
      }
      case "trigger": {
        input[entry.actionName] = posDown ? entry.scale : 0;
        break;
      }
    }
  }

  return input;
}

/**
 * Reset all position-mode accumulators to zero.
 * Call this when re-entering play mode.
 */
export function resetControlMapState(controlMap: ControlMap): void {
  for (const entry of controlMap) {
    entry.currentTarget = entry.defaultTarget ?? 0;
    entry.actualPosition = 0;
  }
}
