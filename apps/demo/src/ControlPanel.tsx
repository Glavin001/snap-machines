import { useState, useEffect, useCallback } from "react";
import type { ControlMap, ActuatorEntry } from "@snap-machines/core";

export interface ControlPanelProps {
  controlMap: ControlMap;
  onControlMapChange: (updated: ControlMap) => void;
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

export function ControlPanel({ controlMap, onControlMapChange }: ControlPanelProps) {
  // Which entry + slot is listening for a key rebind?
  // null = not listening; { index, slot } = waiting for key press
  const [listening, setListening] = useState<{ index: number; slot: "pos" | "neg" } | null>(null);

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
                      active={listening?.index === index && listening.slot === "neg"}
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
                    active={listening?.index === index && listening.slot === "pos"}
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

function KeyButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        minWidth: 32,
        padding: "3px 8px",
        border: active ? "1px solid #6c63ff" : "1px solid rgba(255,255,255,0.2)",
        borderRadius: 4,
        background: active ? "rgba(108,99,255,0.3)" : "rgba(255,255,255,0.08)",
        color: active ? "#c0b8ff" : "#ccc",
        cursor: "pointer",
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "monospace",
        textAlign: "center",
      }}
    >
      {active ? "..." : label}
    </button>
  );
}
