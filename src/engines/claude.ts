import { query, type Options, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Access, Engine } from "./types.js";

/**
 * Tools per access level. Anything not listed is denied (`dontAsk`), so a run
 * never blocks waiting for a human.
 */
const TOOLS: Record<Access, string[]> = {
  read: ["Read", "Glob", "Grep", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(ls:*)"],
  write: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
};

/** Claude Code through the Agent SDK (bundles its own runtime; needs ANTHROPIC_API_KEY). */
export const claudeEngine: Engine = {
  name: "claude",
  nativeSchema: true,
  hosts: ["api.anthropic.com"],
  async run(req) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), req.timeoutMs);
    const cancel = () => abort.abort();
    req.signal?.addEventListener("abort", cancel, { once: true });
    const options: Options = {
      cwd: req.cwd,
      model: req.model,
      maxTurns: req.maxTurns,
      maxBudgetUsd: req.maxBudgetUsd,
      abortController: abort,
      systemPrompt: { type: "preset", preset: "claude_code", append: req.instructions },
      // Load the target repo's CLAUDE.md/AGENTS.md and project settings, never the runner's user settings.
      settingSources: ["project"],
      allowedTools: TOOLS[req.access],
      permissionMode: "dontAsk",
      ...(req.schema && { outputFormat: { type: "json_schema", schema: req.schema } }),
    };

    let result: SDKResultMessage | undefined;
    try {
      for await (const message of query({ prompt: req.prompt, options })) {
        if (message.type === "result") result = message;
      }
    } catch (err) {
      if (req.signal?.aborted) return { ok: false, text: "cancelled" };
      if (abort.signal.aborted) return { ok: false, text: `timed out after ${req.timeoutMs / 60_000} min` };
      return { ok: false, text: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", cancel);
    }

    if (!result) return { ok: false, text: "ended without a result message" };
    const sessionId = result.session_id;
    if (result.subtype !== "success") return { ok: false, text: result.subtype, costUsd: result.total_cost_usd, sessionId };
    return { ok: !result.is_error, text: result.result, output: result.structured_output, costUsd: result.total_cost_usd, sessionId };
  },
};
