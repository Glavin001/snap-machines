import { useState, useEffect, useCallback, useRef } from "react";
import type { ControlMap, ActuatorEntry } from "@snap-machines/core";

export interface ControlPanelProps {
  controlMap: ControlMap;
  onControlMapChange: (updated: ControlMap) => void;
  /** Ref to the set of currently pressed keys — used for live highlighting */
  keysDownRef?: React.RefObject<Set<string>>;
  /** Called when hovering/unhovering an entry row — for 3D part highlighting */
  onHoverEntry?: (entry: { blockId: string; id: string } | null) => void;
}

/** Display name for a key (e.g. " " → "Space") */
function keyLabel(key: string): string {
  if (key === " ") return "Space";
  if (key === "") return "--";
  return key.toUpperCase();
}

const TYPE_LABELS: Record<ActuatorEntry["actuatorType"], string> = {
  velocity: "vel",
  position: "pos",
  trigger: "trig",
};

const TYPE_COLORS: Record<ActuatorEntry["actuatorType"], string> = {
  velocity: "#4fc3f7",
  position: "#aed581",
  trigger: "#ffb74d",
};

/**
 * Poll keysDown ref + position data at ~20fps for live UI updates.
 * Returns pressed keys and a tick counter that increments to trigger re-renders
 * when mutable ControlMap fields (actualPosition, currentTarget) change.
 */
function useLivePolling(
  keysDownRef?: React.RefObject<Set<string>>,
  controlMap?: ControlMap,
): { pressed: Set<string>; tick: number } {
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);
  const prevKeysRef = useRef("");

  useEffect(() => {
    const id = setInterval(() => {
      // Update pressed keys
      if (keysDownRef) {
        const current = keysDownRef.current;
        if (current) {
          const serialized = [...current].sort().join(",");
          if (serialized !== prevKeysRef.current) {
            prevKeysRef.current = serialized;
            setPressed(new Set(current));
          }
        }
      }
      // Tick to pick up mutated actualPosition/currentTarget on position entries
      if (controlMap?.some((e) => e.actuatorType === "position")) {
        setTick((t) => t + 1);
      }
    }, 50);
    return () => clearInterval(id);
  }, [keysDownRef, controlMap]);

  return { pressed, tick };
}

export function ControlPanel({ controlMap, onControlMapChange, keysDownRef, onHoverEntry }: ControlPanelProps) {
  // Which entry + slot is listening for a key rebind?
  // null = not listening; { index, slot } = waiting for key press
  const [listening, setListening] = useState<{ index: number; slot: "pos" | "neg" } | null>(null);

  // Live key highlighting + position data polling
  const { pressed: pressedKeys } = useLivePolling(keysDownRef, controlMap);

  // Capture keypress when in listening mode
  useEffect(() => {
    if (!listening) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const key = e.key === "Escape" ? "" : e.key.toLowerCase();
      const updated = [...controlMap];
      const entry = { ...updated[listening.index] };
      if (listening.slot === "pos") {
        entry.positiveKey = key;
      } else {
        entry.negativeKey = key;
      }
      updated[listening.index] = entry;
      onControlMapChange(updated);
      setListening(null);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [listening, controlMap, onControlMapChange]);

  const handleFlip = useCallback(
    (index: number) => {
      const updated = [...controlMap];
      updated[index] = { ...updated[index], scale: -updated[index].scale };
      onControlMapChange(updated);
    },
    [controlMap, onControlMapChange],
  );

  const handleToggleEnabled = useCallback(
    (index: number) => {
      const updated = [...controlMap];
      const entry = updated[index]!;
      updated[index] = {
        ...entry,
        enabled: !entry.enabled,
        currentTarget: entry.enabled ? 0 : entry.currentTarget,
      };
      onControlMapChange(updated);
    },
    [controlMap, onControlMapChange],
  );

  if (controlMap.length === 0) {
    return (
      <div style={{ padding: "8px 0", fontSize: 12, opacity: 0.5 }}>
        No controllable actuators.
      </div>
    );
  }

  // Group entries by actuatorType
  const groups: { type: ActuatorEntry["actuatorType"]; label: string; entries: { entry: ActuatorEntry; index: number }[] }[] = [
    { type: "velocity", label: "LOCOMOTION", entries: [] },
    { type: "position", label: "POSITION", entries: [] },
    { type: "trigger", label: "TRIGGERS", entries: [] },
  ];
  controlMap.forEach((entry, index) => {
    const group = groups.find((g) => g.type === entry.actuatorType);
    if (group) group.entries.push({ entry, index });
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {groups
        .filter((g) => g.entries.length > 0)
        .map((group) => (
          <div key={group.type}>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: 1,
                opacity: 0.5,
                marginBottom: 4,
              }}
            >
              {group.label}
            </div>
            {group.entries.map(({ entry, index }) => (
              <div
                key={entry.id}
                onMouseEnter={() => onHoverEntry?.({ blockId: entry.blockId, id: entry.id })}
                onMouseLeave={() => onHoverEntry?.(null)}
                style={{
                  marginBottom: 6,
                  padding: "6px 8px",
                  borderRadius: 6,
                  background: entry.enabled ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.025)",
                  border: entry.enabled ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.05)",
                  cursor: "default",
                  opacity: entry.enabled ? 1 : 0.58,
                }}
              >
                {/* Header row: label + type badge */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ fontSize: 12, color: "#ddd", fontWeight: 500 }}>
                    {entry.label}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      onClick={() => handleToggleEnabled(index)}
                      title={entry.enabled ? "Disable this actuator" : "Enable this actuator"}
                      style={{
                        padding: "2px 6px",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 999,
                        background: entry.enabled ? "rgba(76,175,80,0.2)" : "rgba(255,255,255,0.06)",
                        color: entry.enabled ? "#a5d6a7" : "#bbb",
                        cursor: "pointer",
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      {entry.enabled ? "On" : "Off"}
                    </button>
                    <span
                      style={{
                        fontSize: 9,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: `${TYPE_COLORS[entry.actuatorType]}22`,
                        color: TYPE_COLORS[entry.actuatorType],
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      {TYPE_LABELS[entry.actuatorType]}
                    </span>
                  </div>
                </div>

                {/* Key bindings row */}
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {/* Negative key */}
                  {entry.actuatorType !== "trigger" && (
                    <KeyButton
                      label={keyLabel(entry.negativeKey)}
                      listening={listening?.index === index && listening.slot === "neg"}
                      pressed={entry.enabled && entry.negativeKey !== "" && pressedKeys.has(entry.negativeKey)}
                      onClick={() => setListening({ index, slot: "neg" })}
                    />
                  )}

                  {entry.actuatorType !== "trigger" && (
                    <span style={{ fontSize: 10, opacity: 0.3, margin: "0 2px" }}>
                      ---
                    </span>
                  )}

                  {/* Positive key */}
                  <KeyButton
                    label={keyLabel(entry.positiveKey)}
                    listening={listening?.index === index && listening.slot === "pos"}
                    pressed={entry.enabled && entry.positiveKey !== "" && pressedKeys.has(entry.positiveKey)}
                    onClick={() => setListening({ index, slot: "pos" })}
                  />

                  <div style={{ flex: 1 }} />

                  {/* Scale display */}
                  <span style={{ fontSize: 10, opacity: 0.5, fontFamily: "monospace" }}>
                    {entry.scale < 0 ? "-" : "+"}{Math.abs(entry.scale).toFixed(1)}
                  </span>

                  {/* Flip button */}
                  <button
                    onClick={() => handleFlip(index)}
                    title="Flip direction"
                    style={{
                      padding: "2px 6px",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: 4,
                      background: "transparent",
                      color: "#aaa",
                      cursor: "pointer",
                      fontSize: 10,
                    }}
                  >
                    Flip
                  </button>
                </div>

                {/* Position bar: target vs actual */}
                {entry.actuatorType === "position" && (
                  <PositionBar entry={entry} />
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

function KeyButton({ label, listening, pressed, onClick }: {
  label: string;
  listening: boolean;
  pressed: boolean;
  onClick: () => void;
}) {
  // Priority: listening > pressed > default
  const isListening = listening;
  const isPressed = !listening && pressed;

  return (
    <button
      onClick={onClick}
      style={{
        minWidth: 32,
        padding: "3px 8px",
        border: isListening
          ? "1px solid #6c63ff"
          : isPressed
            ? "1px solid #4caf50"
            : "1px solid rgba(255,255,255,0.2)",
        borderRadius: 4,
        background: isListening
          ? "rgba(108,99,255,0.3)"
          : isPressed
            ? "rgba(76,175,80,0.35)"
            : "rgba(255,255,255,0.08)",
        color: isListening
          ? "#c0b8ff"
          : isPressed
            ? "#a5d6a7"
            : "#ccc",
        cursor: "pointer",
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "monospace",
        textAlign: "center",
        transition: "all 0.1s",
      }}
    >
      {isListening ? "..." : label}
    </button>
  );
}

/** Radians → degrees, rounded */
function toDeg(rad: number): string {
  return (rad * 180 / Math.PI).toFixed(1);
}

/**
 * Visual bar showing target vs actual position for position-mode actuators.
 * Renders a bar with the joint range, a target marker, and an actual marker.
 */
function PositionBar({ entry }: { entry: ActuatorEntry }) {
  const min = entry.limits?.min ?? -Math.PI;
  const max = entry.limits?.max ?? Math.PI;
  const range = max - min;
  if (range <= 0) return null;

  const targetPct = ((entry.currentTarget - min) / range) * 100;
  const actualPct = ((entry.actualPosition - min) / range) * 100;
  const clampPct = (v: number) => Math.max(0, Math.min(100, v));

  const error = entry.currentTarget - entry.actualPosition;

  return (
    <div style={{ marginTop: 4 }}>
      {/* Bar track */}
      <div
        style={{
          position: "relative",
          height: 8,
          borderRadius: 4,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
        }}
      >
        {/* Zero mark (center of range) */}
        <div
          style={{
            position: "absolute",
            left: `${clampPct(((0 - min) / range) * 100)}%`,
            top: 0,
            bottom: 0,
            width: 1,
            background: "rgba(255,255,255,0.15)",
          }}
        />
        {/* Actual position (green bar from zero) */}
        {(() => {
          const zeroPct = clampPct(((0 - min) / range) * 100);
          const actPct = clampPct(actualPct);
          const left = Math.min(zeroPct, actPct);
          const width = Math.abs(actPct - zeroPct);
          return (
            <div
              style={{
                position: "absolute",
                left: `${left}%`,
                top: 1,
                bottom: 1,
                width: `${width}%`,
                borderRadius: 2,
                background: "rgba(76,175,80,0.5)",
              }}
            />
          );
        })()}
        {/* Target marker (yellow line) */}
        <div
          style={{
            position: "absolute",
            left: `${clampPct(targetPct)}%`,
            top: 0,
            bottom: 0,
            width: 2,
            marginLeft: -1,
            background: "#ffcc00",
            borderRadius: 1,
          }}
        />
      </div>
      {/* Readout: target / actual / error */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, fontSize: 9, fontFamily: "monospace", opacity: 0.6 }}>
        <span style={{ color: "#ffcc00" }}>T:{toDeg(entry.currentTarget)}°</span>
        <span style={{ color: "#a5d6a7" }}>A:{toDeg(entry.actualPosition)}°</span>
        <span style={{ color: Math.abs(error) > 0.05 ? "#ef9a9a" : "inherit" }}>
          Δ:{toDeg(error)}°
        </span>
      </div>
    </div>
  );
}
