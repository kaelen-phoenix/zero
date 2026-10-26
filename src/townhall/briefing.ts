import type { Post, RunData } from "./types.js";

export interface Briefing {
  title: string;
  body: string;
  stats: { runs: number; delivered: number; failed: number; costUsd: number };
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const ref = (p: Post) => (p.task ? ` (#${p.task})` : "");

/**
 * The control-room report: what the line produced, what it cost, what it
 * learned and what needs a human. Deterministic, so it costs nothing to run.
 */
export function renderBriefing(posts: Post[], from: Date, to: Date): Briefing {
  const runs = posts.flatMap((p) => (p.kind === "run" ? [{ ...p.data, task: p.task }] : []));
  const delivered = runs.filter((r) => r.status === "review");
  const costUsd = runs.reduce((s, r) => s + r.costUsd, 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const ofKind = (kind: Post["kind"]) => posts.filter((p) => p.kind === kind);

  const byEngines = new Map<string, RunData[]>();
  for (const r of runs) byEngines.set(r.engines, [...(byEngines.get(r.engines) ?? []), r]);

  const day = (d: Date) => d.toISOString().slice(0, 10);
  const sections: string[] = [
    `Window: ${from.toISOString()} → ${to.toISOString()}`,
    [
      "## Production",
      "| Tasks run | Delivered (PR) | Failed | Success | Avg attempts | Avg duration | Cost | Cost per delivery |",
      "|---|---|---|---|---|---|---|---|",
      `| ${runs.length} | ${delivered.length} | ${runs.length - delivered.length} | ${pct(delivered.length, runs.length)} | ${avg(runs.map((r) => r.attempts)).toFixed(1)} | ${(avg(runs.map((r) => r.durationMs)) / 60_000).toFixed(1)} min | ${usd(costUsd)} | ${delivered.length ? usd(costUsd / delivered.length) : "—"} |`,
    ].join("\n"),
  ];

  if (byEngines.size) {
    sections.push(
      [
        "## By engine",
        "| Engines | Runs | Success | Cost |",
        "|---|---|---|---|",
        ...[...byEngines].map(([engines, rs]) => {
          const ok = rs.filter((r) => r.status === "review").length;
          return `| ${engines} | ${rs.length} | ${pct(ok, rs.length)} | ${usd(rs.reduce((s, r) => s + r.costUsd, 0))} |`;
        }),
      ].join("\n"),
    );
  }

  const decisions = [
    ...ofKind("blocker").map((p) => `- **Blocked**${ref(p)}: ${p.topic}. ${p.body}`),
    ...ofKind("proposal").map((p) => `- **Proposal**${ref(p)}: ${p.topic}. ${p.body}`),
  ];
  sections.push(`## Needs a human\n${decisions.length ? decisions.join("\n") : "Nothing. The line ran on its own."}`);

  const knowledge = [...ofKind("lesson"), ...ofKind("finding")].map((p) => `- [${p.kind}] **${p.topic}**: ${p.body}${ref(p)}`);
  if (knowledge.length) sections.push(`## What the network learned\n${knowledge.join("\n")}`);

  if (delivered.length) {
    sections.push(`## Delivered\n${delivered.map((r) => `- #${r.task}: ${r.pullRequest}`).join("\n")}`);
  }

  return {
    title: `Townhall — ${day(to)}`,
    body: sections.join("\n\n"),
    stats: { runs: runs.length, delivered: delivered.length, failed: runs.length - delivered.length, costUsd },
  };
}
