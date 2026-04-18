import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type ForwardedRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { ChatMessage, ChatPart } from "./ai/chatTypes";
import {
  MODELS,
  PROVIDER_LABELS,
  defaultModelFor,
  isProviderId,
  type ProviderId,
} from "./ai/providers";
import {
  clearStoredApiKeys,
  loadSettings,
  saveSettings,
  type AiChatSettings,
} from "./ai/settingsStore";
import { useSnapChat } from "./ai/useSnapChat";
import type { SnapAccessors } from "./ai/snapToolHelpers";

export type AiChatPanelHandle = {
  pushHumanEdit: (summary: string) => void;
};

type AiChatPanelProps = {
  accessors: SnapAccessors;
  onClose?: () => void;
};

export const AiChatPanel = forwardRef(function AiChatPanel(
  { accessors, onClose }: AiChatPanelProps,
  ref: ForwardedRef<AiChatPanelHandle>,
) {
  const [settings, setSettings] = useState<AiChatSettings>(() => loadSettings());
  const apiKey = settings.apiKeys[settings.provider];

  const chat = useSnapChat({
    accessors,
    provider: settings.provider,
    model: settings.model,
    apiKey,
  });

  useImperativeHandle(
    ref,
    () => ({
      pushHumanEdit: (summary: string) => chat.pushHumanEdit(summary),
    }),
    [chat],
  );

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const onProviderChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    if (!isProviderId(next)) return;
    setSettings((current) => ({
      ...current,
      provider: next,
      model: defaultModelFor(next),
    }));
  }, []);

  const onModelChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    setSettings((current) => ({ ...current, model: next }));
  }, []);

  const onApiKeyChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setSettings((current) => ({
      ...current,
      apiKeys: { ...current.apiKeys, [current.provider]: next },
    }));
  }, []);

  const onClearKeys = useCallback(() => {
    clearStoredApiKeys();
    setSettings((current) => ({ ...current, apiKeys: {} }));
  }, []);

  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(!apiKey);

  const messageListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = messageListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!chat.canSend) return;
      const text = draft;
      setDraft("");
      void chat.sendMessage(text);
    },
    [chat, draft],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (!chat.canSend) return;
        const text = draft;
        setDraft("");
        void chat.sendMessage(text);
      }
    },
    [chat, draft],
  );

  const modelOptions = useMemo(() => MODELS[settings.provider], [settings.provider]);
  const placeholderHint = apiKey
    ? `Ask ${PROVIDER_LABELS[settings.provider]} (${settings.model}) to edit the machine…`
    : `Add an ${PROVIDER_LABELS[settings.provider]} API key to start chatting`;

  return (
    <aside style={panelStyle}>
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={eyebrowStyle}>AI Co-Builder</div>
            <h2 style={titleStyle}>Chat</h2>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} style={closeButtonStyle} aria-label="Close chat">
              ×
            </button>
          )}
        </div>
        <p style={mutedStyle}>
          Bring-your-own-key. Calls go straight to the provider from your browser — no proxy.
        </p>
      </div>

      <div style={sectionStyle}>
        <div style={settingsHeaderStyle}>
          <button type="button" onClick={() => setSettingsOpen((v) => !v)} style={ghostButtonStyle}>
            {settingsOpen ? "▾ Settings" : "▸ Settings"}
          </button>
          <span style={mutedStyle}>
            {PROVIDER_LABELS[settings.provider]} · {settings.model}
            {apiKey ? " · key set" : " · no key"}
          </span>
        </div>
        {settingsOpen && (
          <div style={settingsBodyStyle}>
            <label style={fieldLabelStyle}>
              Provider
              <select value={settings.provider} onChange={onProviderChange} style={selectStyle}>
                {(Object.keys(MODELS) as ProviderId[]).map((id) => (
                  <option key={id} value={id}>
                    {PROVIDER_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldLabelStyle}>
              Model
              <select value={settings.model} onChange={onModelChange} style={selectStyle}>
                {modelOptions.includes(settings.model) ? null : (
                  <option value={settings.model}>{settings.model} (custom)</option>
                )}
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldLabelStyle}>
              {PROVIDER_LABELS[settings.provider]} API key
              <input
                type="password"
                value={apiKey ?? ""}
                onChange={onApiKeyChange}
                placeholder="sk-…"
                style={inputStyle}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <div style={buttonRowStyle}>
              <button type="button" onClick={onClearKeys} style={dangerButtonStyle}>
                Clear all keys
              </button>
              <button type="button" onClick={chat.clear} style={secondaryButtonStyle}>
                Clear chat
              </button>
            </div>
            <p style={mutedStyle}>
              Keys live in <code>localStorage</code> on this device only. They&apos;re sent
              directly to the provider with each request.
            </p>
          </div>
        )}
      </div>

      <div style={messageListStyle} ref={messageListRef}>
        {chat.messages.length === 0 && (
          <div style={emptyStateStyle}>
            <p style={{ margin: "0 0 6px" }}>
              Try: <em>&ldquo;List every block type in the catalog by category.&rdquo;</em>
            </p>
            <p style={{ margin: "0 0 6px" }}>
              Or: <em>&ldquo;Load the 4-Wheel Car preset and switch to play mode.&rdquo;</em>
            </p>
            <p style={{ margin: 0 }}>
              Or: <em>&ldquo;Add a cube at the origin, then snap a motor wheel onto its right face.&rdquo;</em>
            </p>
          </div>
        )}
        {chat.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {chat.status === "streaming" && <div style={streamingIndicatorStyle}>…thinking</div>}
      </div>

      {chat.error && (
        <div style={errorBannerStyle}>
          <strong>Error:</strong> {chat.error.message}
        </div>
      )}

      {chat.pendingHumanEdits > 0 && (
        <div style={pendingBannerStyle}>
          {chat.pendingHumanEdits} human edit{chat.pendingHumanEdits === 1 ? "" : "s"} pending — will be shared with the AI on your next message.
        </div>
      )}

      <form onSubmit={onSubmit} style={composerStyle}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholderHint}
          rows={3}
          style={textareaStyle}
          disabled={chat.status === "streaming"}
        />
        <div style={composerActionsStyle}>
          {chat.status === "streaming" ? (
            <button type="button" onClick={chat.stop} style={dangerButtonStyle}>
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!chat.canSend || draft.trim().length === 0}
              style={chat.canSend && draft.trim().length > 0 ? primaryButtonStyle : disabledButtonStyle}
            >
              Send
            </button>
          )}
        </div>
      </form>
    </aside>
  );
});

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div style={isUser ? userBubbleStyle : assistantBubbleStyle}>
      <div style={roleLabelStyle}>{isUser ? "You" : "Assistant"}</div>
      {message.parts.map((part, idx) => (
        <PartView key={idx} part={part} />
      ))}
    </div>
  );
}

function PartView({ part }: { part: ChatPart }) {
  if (part.type === "text") {
    return <div style={textPartStyle}>{part.text}</div>;
  }
  if (part.type === "reasoning") {
    return <div style={reasoningPartStyle}>{part.text}</div>;
  }
  if (part.type === "tool-call") {
    const code = extractCode(part.input);
    return (
      <details style={toolCallStyle}>
        <summary style={toolSummaryStyle}>
          <span style={toolBadgeStyle}>tool</span> {part.toolName}
        </summary>
        <pre style={codeBlockStyle}>{code ?? jsonStringify(part.input)}</pre>
      </details>
    );
  }
  if (part.type === "tool-result") {
    const isError = Boolean(part.isError);
    return (
      <details
        open={isError}
        style={{ ...toolResultStyle, borderColor: isError ? "rgba(255, 110, 110, 0.45)" : toolResultStyle.borderColor }}
      >
        <summary style={toolSummaryStyle}>
          <span style={isError ? toolErrorBadgeStyle : toolResultBadgeStyle}>
            {isError ? "error" : "result"}
          </span>{" "}
          {part.toolName}
        </summary>
        <pre style={codeBlockStyle}>{jsonStringify(part.output)}</pre>
      </details>
    );
  }
  return null;
}

function extractCode(input: unknown): string | null {
  if (input && typeof input === "object" && "code" in (input as Record<string, unknown>)) {
    const code = (input as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function jsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ---------- styles (match App.tsx's floating-panel palette) ----------

const panelStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  minHeight: 0,
  color: "#e0e0e0",
  boxSizing: "border-box",
};

const headerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  paddingBottom: 8,
};

const eyebrowStyle: CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.24em",
  textTransform: "uppercase",
  color: "#7fb8d6",
};

const titleStyle: CSSProperties = {
  margin: "2px 0 0",
  fontSize: 16,
  lineHeight: 1.2,
  fontWeight: 700,
  color: "#fff",
};

const mutedStyle: CSSProperties = {
  fontSize: 11,
  color: "rgba(224, 224, 224, 0.55)",
  margin: 0,
};

const closeButtonStyle: CSSProperties = {
  background: "transparent",
  color: "rgba(224,224,224,0.7)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  width: 28,
  height: 28,
  fontSize: 16,
  cursor: "pointer",
  lineHeight: 1,
  padding: 0,
};

const sectionStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 10,
  background: "rgba(14, 26, 38, 0.6)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const settingsHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const settingsBodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const fieldLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11,
  color: "rgba(224,224,224,0.8)",
};

const selectStyle: CSSProperties = {
  background: "rgba(10, 18, 28, 0.96)",
  color: "#e0e0e0",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  padding: "6px 8px",
  fontSize: 12,
};

const inputStyle: CSSProperties = {
  background: "rgba(10, 18, 28, 0.96)",
  color: "#e0e0e0",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
  fontFamily: "inherit",
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const baseButtonStyle: CSSProperties = {
  borderRadius: 8,
  padding: "6px 12px",
  border: "1px solid rgba(255,255,255,0.1)",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 12,
};

const primaryButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)",
  color: "#fff",
  border: "1px solid rgba(14,165,233,0.28)",
};

const secondaryButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  background: "rgba(10, 18, 28, 0.96)",
  color: "#e0e0e0",
};

const dangerButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  background: "rgba(239, 68, 68, 0.18)",
  color: "#fecaca",
  border: "1px solid rgba(239,68,68,0.38)",
};

const ghostButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  background: "transparent",
  border: "1px solid transparent",
  padding: "4px 6px",
  color: "#7fb8d6",
};

const disabledButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  background: "rgba(20, 34, 48, 0.96)",
  color: "rgba(224, 224, 224, 0.4)",
  cursor: "not-allowed",
};

const messageListStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  paddingRight: 4,
};

const emptyStateStyle: CSSProperties = {
  color: "rgba(224,224,224,0.55)",
  fontSize: 12,
  lineHeight: 1.5,
  border: "1px dashed rgba(255,255,255,0.1)",
  borderRadius: 12,
  padding: 12,
};

const userBubbleStyle: CSSProperties = {
  alignSelf: "flex-end",
  maxWidth: "92%",
  background: "rgba(14, 165, 233, 0.16)",
  border: "1px solid rgba(14, 165, 233, 0.32)",
  borderRadius: 12,
  padding: "8px 12px",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const assistantBubbleStyle: CSSProperties = {
  alignSelf: "flex-start",
  maxWidth: "96%",
  background: "rgba(14, 26, 38, 0.6)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: "8px 12px",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const roleLabelStyle: CSSProperties = {
  fontSize: 9,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "#7fb8d6",
};

const textPartStyle: CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 13,
  lineHeight: 1.5,
};

const reasoningPartStyle: CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 12,
  lineHeight: 1.5,
  color: "rgba(224,224,224,0.55)",
  fontStyle: "italic",
};

const toolCallStyle: CSSProperties = {
  border: "1px solid rgba(14, 165, 233, 0.28)",
  borderRadius: 10,
  padding: "6px 8px",
  background: "rgba(8, 18, 28, 0.72)",
};

const toolResultStyle: CSSProperties = {
  border: "1px solid rgba(34, 197, 94, 0.28)",
  borderRadius: 10,
  padding: "6px 8px",
  background: "rgba(8, 18, 28, 0.72)",
};

const toolSummaryStyle: CSSProperties = {
  cursor: "pointer",
  fontSize: 11,
  letterSpacing: "0.04em",
  color: "rgba(224,224,224,0.75)",
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const toolBadgeStyle: CSSProperties = {
  background: "rgba(14, 165, 233, 0.2)",
  color: "#bae8ff",
  padding: "1px 6px",
  borderRadius: 6,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
};

const toolResultBadgeStyle: CSSProperties = {
  ...toolBadgeStyle,
  background: "rgba(34, 197, 94, 0.22)",
  color: "#bbf7d0",
};

const toolErrorBadgeStyle: CSSProperties = {
  ...toolBadgeStyle,
  background: "rgba(239, 68, 68, 0.24)",
  color: "#fecaca",
};

const codeBlockStyle: CSSProperties = {
  margin: "8px 0 2px",
  padding: 8,
  background: "rgba(0, 0, 0, 0.36)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  fontSize: 11,
  lineHeight: 1.45,
  overflowX: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  color: "rgba(224,224,224,0.86)",
  maxHeight: 240,
};

const streamingIndicatorStyle: CSSProperties = {
  alignSelf: "flex-start",
  fontSize: 12,
  color: "rgba(14, 165, 233, 0.8)",
  fontStyle: "italic",
};

const errorBannerStyle: CSSProperties = {
  border: "1px solid rgba(239, 68, 68, 0.38)",
  background: "rgba(239, 68, 68, 0.14)",
  color: "#fecaca",
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 12,
};

const pendingBannerStyle: CSSProperties = {
  border: "1px solid rgba(14, 165, 233, 0.32)",
  background: "rgba(14, 165, 233, 0.12)",
  color: "#bae8ff",
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 12,
};

const composerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const composerActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

const textareaStyle: CSSProperties = {
  width: "100%",
  resize: "vertical",
  background: "rgba(10, 18, 28, 0.96)",
  color: "#e0e0e0",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
  fontFamily: "inherit",
  lineHeight: 1.4,
  boxSizing: "border-box",
};
