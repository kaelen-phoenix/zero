import { query, type Options, type SDKRateLimitInfo, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Access, Engine, EngineRequest, QuotaReport, QuotaWindow } from "./types.js";

/**
 * Tools per access level. Anything not listed is denied (`dontAsk`), so a run
 * never blocks waiting for a human.
 */
const READ_TOOLS = ["Read", "Glob", "Grep", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(ls:*)"];
const TOOLS: Record<Access, string[]> = {
  read: READ_TOOLS,
  // WebSearch runs on the provider's side; WebFetch stays off so nothing leaves this machine unrecorded.
  web: [...READ_TOOLS, "WebSearch"],
  write: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
};

/**
 * The Agent SDK options for one run. Only the assigned skills are enabled
 * (none when there are none), loaded from zero's staged copy; skills never
 * change the tools of the access level.
 */
export function claudeOptions(req: EngineRequest, abort: AbortController): Options {
  return {
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
    skills: req.skills?.skills.map((s) => s.id) ?? [],
    ...(req.skills?.skills.length && { plugins: [{ type: "local" as const, path: req.skills.dir }] }),
    ...(req.schema && { outputFormat: { type: "json_schema", schema: req.schema } }),
  };
}

const WINDOW_LABELS: Record<string, string> = {
  five_hour: "5 horas",
  seven_day: "semana",
  seven_day_opus: "semana (Opus)",
  seven_day_sonnet: "semana (Sonnet)",
};

/** Auth sources that are a claude.ai subscription login rather than a pay-per-use key. */
const SUBSCRIPTION_SOURCES = new Set(["none", "oauth"]);

type RawWindow = { utilization?: number | null; resetsAt?: number; status?: SDKRateLimitInfo["status"] };

const windowStatus = (status: SDKRateLimitInfo["status"] | undefined, utilization: number | undefined): QuotaWindow["status"] =>
  status === "rejected" || (utilization ?? 0) >= 1 ? "exhausted" : status === "allowed_warning" ? "warning" : "ok";

/**
 * What a run tells about the plan. The SDK reports plan limits only for
 * claude.ai subscriptions; its `unifiedWindows` (not in the typings yet) holds
 * every window with the used fraction, otherwise only the binding window is known.
 */
export function claudeQuota(apiKeySource: string | undefined, info: SDKRateLimitInfo | undefined): QuotaReport | undefined {
  if (!info && apiKeySource === undefined) return undefined;
  const billing = info || SUBSCRIPTION_SOURCES.has(apiKeySource ?? "") ? "subscription" : "api";
  if (!info) return { billing, windows: [] };
  const unified = (info as { unifiedWindows?: Record<string, RawWindow> }).unifiedWindows;
  const raw: Record<string, RawWindow> = unified ?? (info.rateLimitType ? { [info.rateLimitType]: { utilization: info.utilization, resetsAt: info.resetsAt, status: info.status } } : {});
  const windows = Object.entries(raw).map(([name, w]): QuotaWindow => {
    // `unifiedWindows` reports fractions; other plan endpoints report percentages.
    const utilization = typeof w.utilization === "number" ? (w.utilization > 1 ? w.utilization / 100 : w.utilization) : undefined;
    return {
      name,
      label: WINDOW_LABELS[name] ?? name,
      utilization,
      status: windowStatus(w.status, utilization),
      ...(w.resetsAt && { resetsAt: new Date(w.resetsAt * 1000).toISOString() }),
    };
  });
  return { billing, windows, ...(info.status === "rejected" && { limited: true }) };
}

/** Claude Code through the Agent SDK (bundles its own runtime): a claude.ai login or ANTHROPIC_API_KEY. */
export const claudeEngine: Engine = {
  name: "claude",
  nativeSchema: true,
  nativeSkills: true,
  hosts: ["api.anthropic.com"],
  async run(req) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), req.timeoutMs);
    const cancel = () => abort.abort();
    req.signal?.addEventListener("abort", cancel, { once: true });
    const options = claudeOptions(req, abort);

    let result: SDKResultMessage | undefined;
    let apiKeySource: string | undefined;
    let rateLimit: SDKRateLimitInfo | undefined;
    try {
      for await (const message of query({ prompt: req.prompt, options })) {
        if (message.type === "result") result = message;
        else if (message.type === "system" && message.subtype === "init") apiKeySource = message.apiKeySource;
        else if (message.type === "rate_limit_event") rateLimit = message.rate_limit_info;
      }
    } catch (err) {
      if (req.signal?.aborted) return { ok: false, text: "cancelled" };
      if (abort.signal.aborted) return { ok: false, text: `timed out after ${req.timeoutMs / 60_000} min` };
      return { ok: false, text: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", cancel);
    }

    const quota = claudeQuota(apiKeySource, rateLimit);
    if (!result) return { ok: false, text: "ended without a result message", ...(quota && { quota }) };
    const sessionId = result.session_id;
    if (result.subtype !== "success") return { ok: false, text: result.subtype, costUsd: result.total_cost_usd, sessionId, ...(quota && { quota }) };
    return { ok: !result.is_error, text: result.result, output: result.structured_output, costUsd: result.total_cost_usd, sessionId, ...(quota && { quota }) };
  },
};
