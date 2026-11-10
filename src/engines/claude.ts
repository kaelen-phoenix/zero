import { query, type Options, type SDKRateLimitInfo, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Access, Engine, EngineRequest, EngineResult, QuotaReport, QuotaWindow } from "./types.js";

/**
 * Tools auto-approved per access level. `allowedTools` only approves: it does
 * not restrict, so a tool left out is not necessarily denied. `dontAsk` keeps a
 * run from blocking waiting for a human; DENIED_TOOLS is what takes tools away.
 */
const READ_TOOLS = ["Read", "Glob", "Grep", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(ls:*)"];
const TOOLS: Record<Access, string[]> = {
  read: READ_TOOLS,
  // WebSearch runs on the provider's side; WebFetch is denied so nothing leaves this machine unrecorded.
  web: [...READ_TOOLS, "WebSearch"],
  write: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
};

/**
 * Tools removed from a read-only session's context (`disallowedTools`): delegated
 * work a subagent could write with and zero's single span would not see, the web
 * fetch, and remote or scheduled work. A deny list and not the closed `tools`
 * option, because without a model we cannot confirm how `tools` would affect
 * `StructuredOutput` and `Skill`, and a mistake there would break every station.
 */
const READ_DENIED = ["Agent", "Workflow", "WebFetch", "RemoteTrigger", "CronCreate", "ScheduleWakeup", "SendMessage", "PushNotification"];
const DENIED_TOOLS: Record<Access, string[] | undefined> = {
  read: READ_DENIED,
  web: READ_DENIED,
  write: undefined,
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
    // Never run hooks (a build may have written them into the repo) nor load the host's memory or claude.ai connectors.
    settings: { disableAllHooks: true, autoMemoryEnabled: false },
    strictMcpConfig: true,
    env: { ...process.env, ...req.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", ENABLE_CLAUDEAI_MCP_SERVERS: "false" },
    allowedTools: TOOLS[req.access],
    ...(DENIED_TOOLS[req.access] && { disallowedTools: DENIED_TOOLS[req.access] }),
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
      return claudeThrown(err);
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", cancel);
    }

    const quota = claudeQuota(apiKeySource, rateLimit);
    if (!result) return { ok: false, text: "ended without a result message", ...(quota && { quota }) };
    return claudeResult(result, quota);
  },
};

const BUDGET_TEXT = "Reached maximum budget";
const CREDIT_TEXT = "Credit balance is too low";
/** An API key out of credit: the engine waits instead of failing the work. */
const NO_CREDIT: QuotaReport = { billing: "api", windows: [], limited: true };

/** What a thrown SDK error (neither cancelled nor timed out) means for zero. */
export function claudeThrown(err: unknown): EngineResult {
  const text = err instanceof Error ? err.message : String(err);
  return { ok: false, text, ...(text.includes(CREDIT_TEXT) && { quota: NO_CREDIT }) };
}

/** The model that cost the most in a result's `modelUsage` (the first one on a tie); undefined when there is none. */
function answeringModel(usage: SDKResultMessage["modelUsage"] | undefined): string | undefined {
  let top: { model: string; cost: number } | undefined;
  for (const [model, { costUSD }] of Object.entries(usage ?? {})) {
    if (!top || costUSD > top.cost) top = { model, cost: costUSD };
  }
  return top?.model;
}

/** What an SDK result message means for zero; a call stopped at `maxBudgetUsd` is marked `budgetLimited`. */
export function claudeResult(result: SDKResultMessage, quota?: QuotaReport): EngineResult {
  const sessionId = result.session_id;
  const model = answeringModel(result.modelUsage);
  if (result.subtype !== "success") {
    const errors = "errors" in result && Array.isArray(result.errors) ? result.errors : [];
    const budgetLimited = result.subtype === "error_max_budget_usd" || errors.some((e) => String(e).includes(BUDGET_TEXT));
    if (errors.some((e) => String(e).includes(CREDIT_TEXT))) quota = NO_CREDIT;
    return { ok: false, text: result.subtype, costUsd: result.total_cost_usd, sessionId, ...(model && { model }), ...(quota && { quota }), ...(budgetLimited && { budgetLimited: true }) };
  }
  const budgetLimited = result.is_error && typeof result.result === "string" && result.result.includes(BUDGET_TEXT);
  if (result.is_error && typeof result.result === "string" && result.result.includes(CREDIT_TEXT)) quota = NO_CREDIT;
  return { ok: !result.is_error, text: result.result, output: result.structured_output, costUsd: result.total_cost_usd, sessionId, ...(model && { model }), ...(quota && { quota }), ...(budgetLimited && { budgetLimited: true }) };
}
