import { tool } from "ai";
import { z } from "zod";
import { executeUserCode, type SandboxResult } from "./sandbox";
import { buildSnapCtx, type SnapAccessors } from "./snapToolHelpers";

const inputSchema = z.object({
  code: z
    .string()
    .min(1)
    .describe(
      "Async JavaScript snippet to run in the user's browser. The runner exposes a `ctx` object with helpers for reading and mutating the live BlockGraph (see system prompt) and a captured `console`. Use `return ...` to send a value back to yourself.",
    ),
});

export type ExecuteJsInput = z.infer<typeof inputSchema>;

export function createExecuteJsTool(accessors: SnapAccessors) {
  return tool({
    description:
      "Run JavaScript in the user's browser to inspect or edit the live snap-machines BlockGraph. The wrapped function signature is `async (ctx, console) => { ... }`. Use `ctx.*` helpers (listCatalog, listNodes, addBlock, snapBlock, moveBlock, removeBlock, connect, setMode, loadPreset, …) to read state or push edits. Mutations are live in the 3D viewport and go on the editor's undo stack. The result echoes your `return` value, captured console logs, and any thrown error.",
    inputSchema,
    async execute(input): Promise<SandboxResult> {
      const ctx = buildSnapCtx(accessors);
      return executeUserCode({
        code: input.code,
        ctx: ctx as unknown as Record<string, unknown>,
      });
    },
  });
}
