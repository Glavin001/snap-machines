import { useState, useEffect, useCallback, useRef } from "react";
import type { ControlMap, ActuatorEntry } from "@snap-machines/core";

export interface ControlPanelProps {
  controlMap: ControlMap;
  onControlMapChange: (updated: ControlMap) => void;
  /** Ref to the set of currently pressed keys — used for live highlighting */
  keysDownRef?: React.RefObject<Set<string>>;
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

/** Poll keysDown ref at ~20fps for live key highlighting */
function usePressedKeys(keysDownRef?: React.RefObject<Set<string>>): Set<string> {
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const prevRef = useRef("");

  useEffect(() => {
    if (!keysDownRef) return;
    const id = setInterval(() => {
      const current = keysDownRef.current;
      if (!current) return;
      // Cheap equality check: serialized sorted key list
      const serialized = [...current].sort().join(",");
      if (serialized !== prevRef.current) {
        prevRef.current = serialized;
        setPressed(new Set(current));
      }
    }, 50);
    return () => clearInterval(id);
  }, [keysDownRef]);

  return pressed;
}

export function ControlPanel({ controlMap, onControlMapChange, keysDownRef }: ControlPanelProps) {
  // Which entry + slot is listening for a key rebind?
  // null = not listening; { index, slot } = waiting for key press
  const [listening, setListening] = useState<{ index: number; slot: "pos" | "neg" } | null>(null);

  // Live key highlighting
  const pressedKeys = usePressedKeys(keysDownRef);

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
                style={{
                  marginBottom: 6,
                  padding: "6px 8px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {/* Header row: label + type badge */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ fontSize: 12, color: "#ddd", fontWeight: 500 }}>
                    {entry.label}
                  </div>
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

                {/* Key bindings row */}
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {/* Negative key */}
                  {entry.actuatorType !== "trigger" && (
                    <KeyButton
                      label={keyLabel(entry.negativeKey)}
                      listening={listening?.index === index && listening.slot === "neg"}
                      pressed={entry.negativeKey !== "" && pressedKeys.has(entry.negativeKey)}
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
                    pressed={entry.positiveKey !== "" && pressedKeys.has(entry.positiveKey)}
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
