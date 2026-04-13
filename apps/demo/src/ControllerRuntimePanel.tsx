import { useMemo, type CSSProperties } from "react";
import {
  keyboardCodeLabel,
  type ControlMap,
  type MachineControllerScheme,
  type MachineInputBinding,
  type MachineInputProfile,
} from "@snap-machines/core";

export interface ControllerRuntimePanelProps {
  controlMap: ControlMap;
  controller: MachineControllerScheme;
  commands: Record<string, number>;
  outputs: Record<string, number>;
  onControllerChange: (next: MachineControllerScheme) => void;
  controllerError?: string | null;
}

function cloneProfile(profile: MachineInputProfile): MachineInputProfile {
  return {
    ...profile,
    bindings: profile.bindings.map((binding) => ({ ...binding })),
  };
}

function ensureDefaultProfile(controller: MachineControllerScheme): MachineInputProfile {
  const current = controller.profiles.find((profile) => profile.id === controller.defaultProfileId)
    ?? controller.profiles[0];
  return current ? cloneProfile(current) : { id: controller.defaultProfileId, kind: "keyboard", bindings: [] };
}

function cloneControllerProfile(profile: MachineInputProfile): MachineInputProfile {
  return {
    ...profile,
    bindings: profile.bindings.map((binding) => ({ ...binding })),
  };
}

function updateCommandBindingEnabled(
  controller: MachineControllerScheme,
  profile: MachineInputProfile,
  commandId: string,
  enabled: boolean,
): MachineControllerScheme {
  const nextProfile = cloneControllerProfile(profile);
  const index = nextProfile.bindings.findIndex((binding) => binding.targetId === commandId && binding.kind === "buttonPair");
  if (index >= 0) {
    const current = nextProfile.bindings[index];
    if (current?.kind === "buttonPair") {
      nextProfile.bindings[index] = {
        ...current,
        enabled,
      };
    }
  } else {
    nextProfile.bindings.push({
      kind: "buttonPair",
      targetId: commandId,
      positive: { device: "keyboard", code: "" },
      negative: undefined,
      scale: 1,
      enabled,
    });
  }

  return {
    ...controller,
    profiles: controller.profiles.some((candidate) => candidate.id === profile.id)
      ? controller.profiles.map((candidate) => candidate.id === profile.id ? nextProfile : candidate)
      : [...controller.profiles, nextProfile],
  };
}

function renderBinding(binding: MachineInputBinding | undefined, value: number) {
  if (!binding) {
    return <span style={{ fontSize: 11, opacity: 0.46 }}>Unbound</span>;
  }
  if (binding.enabled === false) {
    return <span style={{ fontSize: 11, opacity: 0.46, color: "#fca5a5" }}>Disabled</span>;
  }
  if (binding.kind === "axis") {
    return (
      <span style={{ fontSize: 11, opacity: 0.68 }}>
        Gamepad axis {binding.source.axis}
      </span>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {binding.negative && (
        <span style={liveKeyStyle(value < -0.001)}>
          {keyboardCodeLabel(binding.negative.code)}
        </span>
      )}
      {binding.negative && <span style={{ fontSize: 10, opacity: 0.32 }}>---</span>}
      <span style={liveKeyStyle(value > 0.001)}>
        {keyboardCodeLabel(binding.positive.code)}
      </span>
    </div>
  );
}

function valuePercent(value: number, min: number, max: number) {
  if (max <= min) return 0;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

export function ControllerRuntimePanel({
  controlMap,
  controller,
  commands,
  outputs,
  onControllerChange,
  controllerError,
}: ControllerRuntimePanelProps) {
  const profile = useMemo(() => ensureDefaultProfile(controller), [controller]);
  const bindingsByTargetId = useMemo(
    () => new Map(profile.bindings.map((binding) => [binding.targetId, binding] as const)),
    [profile],
  );
  const rolesByActuatorId = useMemo(
    () => new Map(controller.actuatorRoles.map((assignment) => [assignment.actuatorId, assignment.roles] as const)),
    [controller.actuatorRoles],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={sectionLabelStyle}>Commands</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {controller.commands.length === 0 && (
            <div style={{ fontSize: 12, opacity: 0.58 }}>
              No semantic commands are defined for this controller.
            </div>
          )}
          {controller.commands.map((command) => {
            const value = commands[command.id] ?? command.defaultValue ?? 0;
            return (
              <div key={command.id} style={cardStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, color: "#f8fbff" }}>{command.label}</div>
                    <div style={{ marginTop: 2, fontSize: 10, opacity: 0.5, fontFamily: "SFMono-Regular, Menlo, Consolas, monospace" }}>
                      {command.id}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontFamily: "SFMono-Regular, Menlo, Consolas, monospace", color: "#bfdbfe" }}>
                    {value.toFixed(2)}
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 8,
                    height: 6,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.08)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${valuePercent(value, command.range.min, command.range.max)}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, rgba(56,189,248,0.72), rgba(14,165,233,0.92))",
                    }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <button
                      onClick={() => onControllerChange(updateCommandBindingEnabled(controller, profile, command.id, !(bindingsByTargetId.get(command.id)?.enabled ?? true)))}
                      style={{
                        ...toggleButtonStyle,
                        color: bindingsByTargetId.get(command.id)?.enabled === false ? "#fca5a5" : "#bbf7d0",
                        borderColor: bindingsByTargetId.get(command.id)?.enabled === false ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.22)",
                        background: bindingsByTargetId.get(command.id)?.enabled === false ? "rgba(127,29,29,0.24)" : "rgba(20,83,45,0.22)",
                      }}
                    >
                      {bindingsByTargetId.get(command.id)?.enabled === false ? "Disabled" : "Enabled"}
                    </button>
                    {renderBinding(bindingsByTargetId.get(command.id), value)}
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.5 }}>
                    {command.range.min} to {command.range.max}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div style={sectionLabelStyle}>Script</div>
        {controllerError && (
          <div
            style={{
              marginBottom: 8,
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(127, 29, 29, 0.32)",
              border: "1px solid rgba(248,113,113,0.25)",
              color: "#fecaca",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            Runtime error: {controllerError}
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
          rows={14}
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
            boxSizing: "border-box",
          }}
        />
      </div>

      <div>
        <div style={sectionLabelStyle}>Actuator Outputs</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {controlMap.map((entry) => {
            const output = outputs[entry.id] ?? 0;
            const roles = rolesByActuatorId.get(entry.id) ?? [];
            return (
              <div key={entry.id} style={cardStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, color: "#f8fbff" }}>{entry.label}</div>
                    <div style={{ marginTop: 2, fontSize: 10, opacity: 0.5, fontFamily: "SFMono-Regular, Menlo, Consolas, monospace" }}>
                      {entry.id}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontFamily: "SFMono-Regular, Menlo, Consolas, monospace", color: Math.abs(output) > 0.001 ? "#86efac" : "#94a3b8" }}>
                    {output.toFixed(2)}
                  </div>
                </div>
                {roles.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 10, opacity: 0.56 }}>
                    Roles: {roles.join(", ")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const sectionLabelStyle = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.8,
  opacity: 0.56,
  marginBottom: 6,
} satisfies CSSProperties;

const cardStyle = {
  padding: "8px 10px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
} satisfies CSSProperties;

function liveKeyStyle(active: boolean): CSSProperties {
  return {
    minWidth: 38,
    padding: "4px 8px",
    borderRadius: 6,
    border: active ? "1px solid rgba(56,189,248,0.55)" : "1px solid rgba(255,255,255,0.16)",
    background: active ? "rgba(14,165,233,0.18)" : "rgba(255,255,255,0.04)",
    color: active ? "#e0f7ff" : "#eef2ff",
    fontSize: 11,
  };
}

const toggleButtonStyle = {
  minWidth: 64,
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.04)",
  fontSize: 11,
  cursor: "pointer",
} satisfies CSSProperties;
