import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  buildControllerScriptGlobals,
  keyboardCodeLabel,
  type ControlMap,
  type MachineActuatorRoleAssignment,
  type MachineCommandDefinition,
  type MachineControllerScheme,
  type MachineInputBinding,
  type MachineInputProfile,
} from "@snap-machines/core";

export interface ControllerPanelProps {
  controlMap: ControlMap;
  controller: MachineControllerScheme;
  onControllerChange: (next: MachineControllerScheme) => void;
  onRegenerateFromBindings: () => void;
}

function cloneProfile(profile: MachineInputProfile): MachineInputProfile {
  return {
    ...profile,
    bindings: profile.bindings.map((binding) => ({ ...binding })),
  };
}

function ensureKeyboardProfile(controller: MachineControllerScheme): MachineInputProfile {
  const current = controller.profiles.find((profile) => profile.id === controller.defaultProfileId)
    ?? controller.profiles.find((profile) => profile.kind === "keyboard");
  return current ? cloneProfile(current) : { id: controller.defaultProfileId, kind: "keyboard", bindings: [] };
}

function sanitizeCommandId(value: string): string {
  const trimmed = value.trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!trimmed) {
    return "command";
  }
  return /^[0-9]/.test(trimmed) ? `_${trimmed}` : trimmed;
}

function uniqueCommandId(base: string, commands: MachineCommandDefinition[], currentId?: string): string {
  const normalized = sanitizeCommandId(base);
  const taken = new Set(commands.filter((command) => command.id !== currentId).map((command) => command.id));
  if (!taken.has(normalized)) {
    return normalized;
  }
  let index = 2;
  while (taken.has(`${normalized}_${index}`)) {
    index += 1;
  }
  return `${normalized}_${index}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceScriptCommandId(source: string, currentId: string, nextId: string): string {
  if (!source || currentId === nextId) {
    return source;
  }
  const pattern = new RegExp(`\\b${escapeRegExp(currentId)}\\b`, "g");
  return source.replace(pattern, nextId);
}

function updateCommandId(
  controller: MachineControllerScheme,
  currentId: string,
  nextId: string,
): MachineControllerScheme {
  if (currentId === nextId) {
    return controller;
  }
  return {
    ...controller,
    commands: controller.commands.map((command) => command.id === currentId ? { ...command, id: nextId } : command),
    profiles: controller.profiles.map((profile) => ({
      ...profile,
      bindings: profile.bindings.map((binding) => binding.targetId === currentId ? { ...binding, targetId: nextId } : binding),
    })),
    script: controller.script
      ? {
          ...controller.script,
          source: replaceScriptCommandId(controller.script.source, currentId, nextId),
        }
      : undefined,
  };
}

function removeCommand(controller: MachineControllerScheme, commandId: string): MachineControllerScheme {
  return {
    ...controller,
    commands: controller.commands.filter((command) => command.id !== commandId),
    profiles: controller.profiles.map((profile) => ({
      ...profile,
      bindings: profile.bindings.filter((binding) => binding.targetId !== commandId),
    })),
  };
}

function buildContextPreview(controlMap: ControlMap, controller: MachineControllerScheme): string {
  const globals = buildControllerScriptGlobals(controlMap, controller);
  const commandLines = controller.commands.length > 0
    ? controller.commands.map((command) => (
      `    /** ${command.label}: ${describeCommandRange(command.range.min, command.range.max)}. Default ${command.defaultValue}. */\n    ${command.id}: number;`
    )).join("\n")
    : "    // no commands yet";
  const commandGlobalLines = Object.keys(globals.commands).length > 0
    ? Object.entries(globals.commands).map(([alias, id]) => {
      const meta = globals.config.commands[alias];
      return `  /** ${meta.label}. ${describeCommandRange(meta.min, meta.max)}. */\n  ${alias}: "${id}";`;
    }).join("\n")
    : "  // no command aliases yet";
  const actuatorGlobalLines = Object.keys(globals.actuators).length > 0
    ? Object.entries(globals.actuators).map(([alias, actuatorId]) => {
      const meta = globals.config.actuators[alias];
      return `  /** ${meta.label} (${meta.actuatorType}), scale ${meta.scale}. */\n  ${alias}: "${actuatorId}";`;
    }).join("\n")
    : "  // no actuator aliases yet";
  const configCommandLines = Object.keys(globals.config.commands).length > 0
    ? Object.entries(globals.config.commands).map(([alias, meta]) => (
      `    ${alias}: { id: "${meta.id}"; label: "${meta.label}"; min: ${meta.min}; max: ${meta.max}; defaultValue: ${meta.defaultValue}; };`
    )).join("\n")
    : "    // no command config yet";
  const configActuatorLines = Object.keys(globals.config.actuators).length > 0
    ? Object.entries(globals.config.actuators).map(([alias, meta]) => (
      `    ${alias}: { actuatorId: "${meta.actuatorId}"; actuatorType: "${meta.actuatorType}"; scale: ${meta.scale}; defaultTarget: ${meta.defaultTarget}; min: ${meta.min}; max: ${meta.max}; roles: string[]; };`
    )).join("\n")
    : "    // no actuator config yet";
  const actuatorIndexLines = controlMap.length > 0
    ? controlMap.map((entry) => `    "${entry.id}"?: number;`).join("\n")
    : "    // no actuator outputs yet";
  const readbackLines = controlMap.length > 0
    ? controlMap.map((entry) => `    "${entry.id}": { position: number; velocity: number; lastOutput: number; };`).join("\n")
    : "    // no actuator readback yet";
  const roleAssignments = new Map<string, string[]>(
    controller.actuatorRoles.map((assignment: MachineActuatorRoleAssignment) => [assignment.actuatorId, assignment.roles] as const),
  );
  const roleUnion = Array.from(
    new Set(controlMap.flatMap((entry) => roleAssignments.get(entry.id) ?? [])),
  );

  return `declare const helpers: {
  clamp(value: number, min: number, max: number): number;
  deadzone(value: number, threshold?: number): number;
  lerp(a: number, b: number, t: number): number;
  rateLimit(current: number, target: number, maxDelta: number): number;
  pd(error: number, velocity: number, kp: number, kd: number): number;
  pid(
    error: number,
    state: { integral?: number; previousError?: number } | undefined,
    dt: number,
    kp: number,
    ki: number,
    kd: number,
  ): {
    output: number;
    state: { integral: number; previousError: number };
  };
};

declare const commands: {
${commandGlobalLines}
};

declare const actuators: {
${actuatorGlobalLines}
};

declare const config: {
  commands: {
${configCommandLines}
  };
  actuators: {
${configActuatorLines}
  };
};

type ControllerContext = {
  time: number;
  dt: number;
  commands: {
${commandLines}
  };
  previousCommands: {
${commandLines}
  };
  readback: {
${readbackLines}
  };
  actuators: {
    all: Array<{
      actuatorId: string;
      blockId: string;
      blockName: string;
      label: string;
      actuatorType: "velocity" | "position" | "trigger";
      roles: string[];
    }>;
    byId: Record<string, {
      actuatorId: string;
      blockId: string;
      blockName: string;
      label: string;
      actuatorType: "velocity" | "position" | "trigger";
      roles: string[];
    }>;
    byRole: Record<${roleUnion.length > 0 ? roleUnion.map((role) => `"${role}"`).join(" | ") : "string"}, Array<{
      actuatorId: string;
      blockId: string;
      blockName: string;
      label: string;
      actuatorType: "velocity" | "position" | "trigger";
      roles: string[];
    }>>;
  };
};

type ControllerStepResult = {
  state?: unknown;
  outputs: {
${actuatorIndexLines}
  };
};

declare function init(ctx: ControllerContext): unknown | undefined;
declare function step(ctx: ControllerContext, state: unknown): ControllerStepResult;`;
}

function describeCommandRange(min: number, max: number): string {
  if (min === 0 && max === 1) {
    return "normalized scalar in the range 0..1";
  }
  if (min === -1 && max === 1) {
    return "signed scalar in the range -1..1";
  }
  if (Number.isInteger(min) && Number.isInteger(max) && max - min > 0 && max - min <= 8) {
    return `numeric value in the range ${min}..${max} (can be treated like a small enum if you map discrete states yourself)`;
  }
  return `numeric value in the range ${min}..${max}`;
}

function upsertBinding(
  profile: MachineInputProfile,
  commandId: string,
  updater: (binding: Extract<MachineInputBinding, { kind: "buttonPair" }> | undefined) => Extract<MachineInputBinding, { kind: "buttonPair" }>,
): MachineInputProfile {
  const next = cloneProfile(profile);
  const index = next.bindings.findIndex((binding) => binding.targetId === commandId && binding.kind === "buttonPair");
  const current = index >= 0 ? next.bindings[index] as Extract<MachineInputBinding, { kind: "buttonPair" }> : undefined;
  const updated = updater(current);
  if (index >= 0) {
    next.bindings[index] = updated;
  } else {
    next.bindings.push(updated);
  }
  return next;
}

export function ControllerPanel({
  controlMap,
  controller,
  onControllerChange,
  onRegenerateFromBindings,
}: ControllerPanelProps) {
  const [listening, setListening] = useState<{ commandId: string; slot: "pos" | "neg" } | null>(null);
  const [commandIdDrafts, setCommandIdDrafts] = useState<Record<string, string>>({});
  const [showContextHelp, setShowContextHelp] = useState(false);
  const keyboardProfile = useMemo(() => ensureKeyboardProfile(controller), [controller]);
  const bindingByCommandId = useMemo(() => {
    const entries = keyboardProfile.bindings
      .filter((binding): binding is Extract<MachineInputBinding, { kind: "buttonPair" }> => binding.kind === "buttonPair")
      .map((binding) => [binding.targetId, binding] as const);
    return new Map(entries);
  }, [keyboardProfile]);
  const roleByActuatorId = useMemo(
    () => new Map(controller.actuatorRoles.map((assignment) => [assignment.actuatorId, assignment.roles] as const)),
    [controller.actuatorRoles],
  );
  const contextPreview = useMemo(
    () => buildContextPreview(controlMap, controller),
    [controlMap, controller],
  );

  const commitCommandIdDraft = (commandId: string) => {
    const draft = commandIdDrafts[commandId];
    if (draft == null) return;
    const normalized = uniqueCommandId(draft, controller.commands, commandId);
    if (normalized !== commandId) {
      onControllerChange(updateCommandId(controller, commandId, normalized));
    }
    setCommandIdDrafts((previous) => {
      const next = { ...previous };
      delete next[commandId];
      return next;
    });
  };

  useEffect(() => {
    if (!listening) return;
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const nextProfile = upsertBinding(keyboardProfile, listening.commandId, (binding) => ({
        kind: "buttonPair",
        targetId: listening.commandId,
        positive: listening.slot === "pos"
          ? { device: "keyboard", code: event.code === "Escape" ? "" : event.code }
          : binding?.positive ?? { device: "keyboard", code: "" },
        negative: listening.slot === "neg"
          ? (event.code === "Escape" ? undefined : { device: "keyboard", code: event.code })
          : binding?.negative,
        enabled: binding?.enabled ?? true,
        scale: binding?.scale ?? 1,
      }));
      onControllerChange({
        ...controller,
        profiles: controller.profiles.some((profile) => profile.id === keyboardProfile.id)
          ? controller.profiles.map((profile) => profile.id === keyboardProfile.id ? nextProfile : profile)
          : [...controller.profiles, nextProfile],
      });
      setListening(null);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [controller, keyboardProfile, listening, onControllerChange]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, opacity: 0.56 }}>
            Commands
          </div>
          <button
            onClick={() => {
              const nextId = uniqueCommandId("command", controller.commands);
              onControllerChange({
                ...controller,
                commands: [...controller.commands, {
                  id: nextId,
                  label: "New Command",
                  range: { min: -1, max: 1 },
                  defaultValue: 0,
                }],
              });
            }}
            style={secondaryInlineButtonStyle}
          >
            Add Command
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {controller.commands.length === 0 && (
            <div style={{ fontSize: 12, opacity: 0.6 }}>Switch into controller mode to generate starter commands from the current bindings.</div>
          )}
          {controller.commands.map((command) => {
            const binding = bindingByCommandId.get(command.id);
            const commandIdDraft = commandIdDrafts[command.id] ?? command.id;
            return (
              <div
                key={command.id}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.7, opacity: 0.52 }}>
                    Semantic Command
                  </div>
                  <button
                    onClick={() => onControllerChange(removeCommand(controller, command.id))}
                    style={{
                      ...secondaryInlineButtonStyle,
                      padding: "6px 8px",
                      fontSize: 11,
                      color: "#fecaca",
                      borderColor: "rgba(248,113,113,0.22)",
                    }}
                  >
                    Remove
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.25fr)", gap: 8 }}>
                  <label style={fieldLabelStyle}>
                    <span>ID</span>
                    <input
                      value={commandIdDraft}
                      onChange={(event) => setCommandIdDrafts((previous) => ({
                        ...previous,
                        [command.id]: event.target.value,
                      }))}
                      onBlur={() => commitCommandIdDraft(command.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          commitCommandIdDraft(command.id);
                          event.currentTarget.blur();
                        }
                        if (event.key === "Escape") {
                          setCommandIdDrafts((previous) => {
                            const next = { ...previous };
                            delete next[command.id];
                            return next;
                          });
                          event.currentTarget.blur();
                        }
                      }}
                      style={textInputStyle}
                    />
                  </label>
                  <label style={fieldLabelStyle}>
                    <span>Name</span>
                    <input
                      value={command.label}
                      onChange={(event) => onControllerChange({
                        ...controller,
                        commands: controller.commands.map((candidate) => candidate.id === command.id
                          ? { ...candidate, label: event.target.value }
                          : candidate),
                      })}
                      style={textInputStyle}
                    />
                  </label>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                  <label style={fieldLabelStyle}>
                    <span>Min</span>
                    <input
                      value={String(command.range.min)}
                      onChange={(event) => {
                        const nextMin = Number(event.target.value);
                        if (!Number.isFinite(nextMin)) return;
                        onControllerChange({
                          ...controller,
                          commands: controller.commands.map((candidate) => candidate.id === command.id
                            ? { ...candidate, range: { ...candidate.range, min: nextMin } }
                            : candidate),
                        });
                      }}
                      style={textInputStyle}
                    />
                  </label>
                  <label style={fieldLabelStyle}>
                    <span>Max</span>
                    <input
                      value={String(command.range.max)}
                      onChange={(event) => {
                        const nextMax = Number(event.target.value);
                        if (!Number.isFinite(nextMax)) return;
                        onControllerChange({
                          ...controller,
                          commands: controller.commands.map((candidate) => candidate.id === command.id
                            ? { ...candidate, range: { ...candidate.range, max: nextMax } }
                            : candidate),
                        });
                      }}
                      style={textInputStyle}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                  <button
                    onClick={() => {
                      const nextProfile = upsertBinding(keyboardProfile, command.id, (current) => ({
                        kind: "buttonPair",
                        targetId: command.id,
                        positive: current?.positive ?? { device: "keyboard", code: "" },
                        negative: current?.negative,
                        enabled: !(current?.enabled ?? true),
                        scale: current?.scale ?? 1,
                      }));
                      onControllerChange({
                        ...controller,
                        profiles: controller.profiles.some((profile) => profile.id === keyboardProfile.id)
                          ? controller.profiles.map((profile) => profile.id === keyboardProfile.id ? nextProfile : profile)
                          : [...controller.profiles, nextProfile],
                      });
                    }}
                    style={{
                      ...keyButtonStyle(false),
                      minWidth: 64,
                      color: binding?.enabled === false ? "#fca5a5" : "#bbf7d0",
                      borderColor: binding?.enabled === false ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.22)",
                      background: binding?.enabled === false ? "rgba(127,29,29,0.24)" : "rgba(20,83,45,0.22)",
                    }}
                  >
                    {binding?.enabled === false ? "Disabled" : "Enabled"}
                  </button>
                  <button onClick={() => setListening({ commandId: command.id, slot: "neg" })} style={keyButtonStyle(listening?.commandId === command.id && listening.slot === "neg")}>
                    {keyboardCodeLabel(binding?.negative?.code ?? "")}
                  </button>
                  <span style={{ fontSize: 10, opacity: 0.35 }}>---</span>
                  <button onClick={() => setListening({ commandId: command.id, slot: "pos" })} style={keyButtonStyle(listening?.commandId === command.id && listening.slot === "pos")}>
                    {keyboardCodeLabel(binding?.positive.code ?? "")}
                  </button>
                  <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.55, fontFamily: "monospace" }}>{command.id}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, opacity: 0.56, marginBottom: 6 }}>
          Actuator Roles
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {controlMap.map((entry) => (
            <div
              key={entry.id}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ fontSize: 12, marginBottom: 6 }}>{entry.label}</div>
              <input
                value={(roleByActuatorId.get(entry.id) ?? []).join(", ")}
                onChange={(event) => {
                  const roles = event.target.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean);
                  const nextAssignments = controlMap.map((candidate) => ({
                    actuatorId: candidate.id,
                    roles: candidate.id === entry.id
                      ? roles
                      : (roleByActuatorId.get(candidate.id) ?? []),
                  }));
                  onControllerChange({
                    ...controller,
                    actuatorRoles: nextAssignments,
                  });
                }}
                style={textInputStyle}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={{ marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, opacity: 0.56, display: "flex", alignItems: "center", gap: 8 }}>
            <span>Script</span>
            <button
              type="button"
              aria-label="Show controller context type"
              onClick={() => setShowContextHelp((value) => !value)}
              style={{
                ...helpButtonStyle,
                background: showContextHelp ? "rgba(14,165,233,0.18)" : helpButtonStyle.background,
                border: showContextHelp ? "1px solid rgba(56,189,248,0.45)" : helpButtonStyle.border,
              }}
            >
              ?
            </button>
          </div>
          <button
            onClick={onRegenerateFromBindings}
            style={{
              ...secondaryInlineButtonStyle,
              padding: "6px 8px",
              fontSize: 11,
            }}
          >
            Regenerate From Bindings
          </button>
        </div>
        {showContextHelp && (
          <div
            style={{
              marginBottom: 8,
              padding: 10,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(7, 12, 18, 0.96)",
              maxHeight: 280,
              overflow: "auto",
            }}
          >
            <pre
              style={{
                margin: 0,
                fontSize: 11,
                lineHeight: 1.5,
                color: "#dbeafe",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontFamily: "SFMono-Regular, Menlo, Consolas, monospace",
              }}
            >
              {contextPreview}
            </pre>
          </div>
        )}
        <textarea
          value={controller.script?.source ?? ""}
          onChange={(event) => onControllerChange({
            ...controller,
            script: {
              language: "javascript",
              source: event.target.value,
            },
          })}
          spellCheck={false}
          rows={18}
          style={{
            width: "100%",
            resize: "vertical",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(7, 12, 18, 0.92)",
            color: "#dbeafe",
            padding: 10,
            fontSize: 12,
            lineHeight: 1.6,
            fontFamily: "SFMono-Regular, Menlo, Consolas, monospace",
          }}
        />
      </div>
    </div>
  );
}

const textInputStyle = {
  width: "100%",
  padding: "7px 8px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  color: "#eef2ff",
  fontSize: 12,
} satisfies CSSProperties;

const fieldLabelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 10,
  opacity: 0.72,
} satisfies CSSProperties;

const secondaryInlineButtonStyle = {
  padding: "7px 8px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  color: "#dbeafe",
  cursor: "pointer",
  fontSize: 12,
  whiteSpace: "nowrap",
} satisfies CSSProperties;

const helpButtonStyle = {
  width: 18,
  height: 18,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.06)",
  color: "#dbeafe",
  cursor: "help",
  fontSize: 11,
  lineHeight: "16px",
  padding: 0,
} satisfies CSSProperties;

function keyButtonStyle(listening: boolean): CSSProperties {
  return {
    minWidth: 38,
    padding: "4px 8px",
    borderRadius: 6,
    border: listening ? "1px solid rgba(56,189,248,0.55)" : "1px solid rgba(255,255,255,0.16)",
    background: listening ? "rgba(14,165,233,0.18)" : "rgba(255,255,255,0.04)",
    color: "#eef2ff",
    cursor: "pointer",
    fontSize: 11,
  };
}
