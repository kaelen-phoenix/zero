import { esc } from "./html.js";

/** The monitor's charts: inline SVG drawn on the server, coloured by the panel's CSS variables, no outside code. */

const R = 40;
const CIRCLE = 2 * Math.PI * R;

/** A round gauge for a percentage (0 to 100), or "sin dato" when there is none. */
export function gauge(percent: number | undefined, label: string): string {
  const p = percent === undefined ? 0 : Math.min(100, Math.max(0, percent));
  const tone = percent === undefined ? "var(--line)" : p >= 90 ? "var(--bad)" : p >= 70 ? "var(--warn)" : "var(--accent)";
  const shown = percent === undefined ? "sin dato" : `${Math.round(p)} %`;
  return `<figure class="gauge"><svg viewBox="0 0 100 100" role="img" aria-label="${esc(label)}: ${esc(shown)}">
<circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--line)" stroke-width="10"/>
<circle cx="50" cy="50" r="${R}" fill="none" stroke="${tone}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${((p / 100) * CIRCLE).toFixed(1)} ${CIRCLE.toFixed(1)}" transform="rotate(-90 50 50)"/>
<text x="50" y="55" text-anchor="middle" font-size="${percent === undefined ? 12 : 18}" font-weight="700" fill="currentColor">${esc(shown)}</text>
</svg><figcaption>${esc(label)}</figcaption></figure>`;
}

/** Horizontal bars, one per item, scaled to the largest value; `text` is what each bar says (the value by default). */
export function bars(items: { label: string; value: number; text?: string }[]): string {
  if (!items.length) return `<p class="muted">sin dato</p>`;
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  const row = 22;
  const rows = items
    .map((item, n) => {
      const y = n * row;
      const width = Math.max(0, (item.value / max) * 150);
      return `<text x="0" y="${y + 15}" font-size="12" fill="currentColor">${esc(item.label)}</text>
<rect x="100" y="${y + 4}" width="${width.toFixed(1)}" height="14" rx="3" fill="var(--accent)"/>
<text x="${(104 + width).toFixed(1)}" y="${y + 15}" font-size="12" fill="currentColor">${esc(item.text ?? String(item.value))}</text>`;
    })
    .join("\n");
  return `<svg class="bars" viewBox="0 0 320 ${items.length * row}" role="img" aria-label="barras">${rows}</svg>`;
}

/** A line chart of a daily series, with dots and the first and last labels. */
export function lineChart(points: { label: string; value: number }[]): string {
  if (!points.length) return `<p class="muted">sin dato</p>`;
  const w = 300;
  const h = 100;
  const top = Math.max(...points.map((p) => p.value), 0);
  const max = top || 1;
  const x = (n: number) => (points.length === 1 ? w / 2 : 10 + (n * (w - 20)) / (points.length - 1));
  const y = (v: number) => h - 15 - (v / max) * (h - 30);
  const coords = points.map((p, n) => `${x(n).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const dots = points.map((p, n) => `<circle cx="${x(n).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="2.5" fill="var(--accent)"><title>${esc(p.label)}: ${p.value}</title></circle>`).join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="serie diaria">
<line x1="10" y1="${h - 15}" x2="${w - 10}" y2="${h - 15}" stroke="var(--line)"/>
<polyline points="${coords}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>${dots}
<text x="10" y="${h - 2}" font-size="10" fill="currentColor">${esc(points[0]!.label)}</text>
<text x="${w - 10}" y="${h - 2}" font-size="10" text-anchor="end" fill="currentColor">${esc(points.at(-1)!.label)}</text>
<text x="10" y="10" font-size="10" fill="currentColor">máx ${top}</text>
</svg>`;
}
