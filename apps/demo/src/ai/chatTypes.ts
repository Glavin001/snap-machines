import type { ModelMessage, ToolContent, ToolResultPart } from "ai";

export type ChatTextPart = { type: "text"; text: string };
export type ChatReasoningPart = { type: "reasoning"; text: string };
export type ChatToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
};
export type ChatToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: unknown;
  isError?: boolean;
};

export type ChatPart =
  | ChatTextPart
  | ChatReasoningPart
  | ChatToolCallPart
  | ChatToolResultPart;

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  parts: ChatPart[];
  createdAt: number;
  hiddenContext?: string;
};

export function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = renderUserContent(msg);
      out.push({ role: "user", content: text });
      continue;
    }
    const assistantContent: Array<
      | { type: "text"; text: string }
      | { type: "reasoning"; text: string }
      | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
    > = [];
    const toolResults: ToolContent = [];

    for (const part of msg.parts) {
      if (part.type === "text" && part.text.length > 0) {
        assistantContent.push({ type: "text", text: part.text });
      } else if (part.type === "reasoning" && part.text.length > 0) {
        assistantContent.push({ type: "reasoning", text: part.text });
      } else if (part.type === "tool-call") {
        assistantContent.push({
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input ?? {},
        });
      } else if (part.type === "tool-result") {
        const resultPart: ToolResultPart = {
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: part.isError
            ? { type: "error-text", value: stringifyForModel(part.output) }
            : ({ type: "json", value: toJsonValue(part.output) } as ToolResultPart["output"]),
        };
        toolResults.push(resultPart);
      }
    }

    if (assistantContent.length > 0) {
      out.push({ role: "assistant", content: assistantContent });
    }
    if (toolResults.length > 0) {
      out.push({ role: "tool", content: toolResults });
    }
  }
  return out;
}

function renderUserContent(msg: ChatMessage): string {
  const visible = msg.parts
    .filter((p): p is ChatTextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
  if (msg.hiddenContext && msg.hiddenContext.length > 0) {
    return `${msg.hiddenContext}\n\n${visible}`;
  }
  return visible;
}

function stringifyForModel(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toJsonValue(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return String(value);
  }
}

export function makeChatId(): string {
  const cryptoRef = typeof crypto !== "undefined" ? crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
