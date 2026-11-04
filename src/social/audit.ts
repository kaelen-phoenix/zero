/**
 * The checks of a draft before it goes out, from ig-humanizer's audit mode and
 * kept here so that they need no skill at run time. Fixed rules do not really
 * judge tone: they catch the known tells. Each returns its problems, in words
 * that quote nothing of the draft, so they can go to the log.
 */

/** What Instagram takes in a caption. */
export const MAX_TEXT = 2200;
const HOOK_CHARS = 125;
const HASHTAGS = { min: 3, max: 5 };
const MARKERS_PER_PARAGRAPH = 3;
const MIN_DASHES_ALLOWED = 2;

const HASHTAG = /(?<![\p{L}\p{N}_#&/])#[\p{L}\p{N}_]+/gu;
const WEB_URL = /https?:\/\/\S+/gi;

/** Lower case, no accents and straight quotes: what the lists below are written in. */
const normal = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘]/g, "'")
    .toLowerCase();

const SENTENCE_START = "(?:^|[.!?¡¿]\\s*)";

const TELLS: { problem: string; patterns: RegExp[] }[] = [
  {
    problem: "hollow opening",
    patterns: [
      /^(?:en el mundo (?:actual|de hoy|de)\b|en la era (?:digital|de la ia|actual)\b|hoy en dia\b|en los tiempos que corren\b|en un mundo (?:donde|en el que|cada vez)\b|en el vertiginoso\b|en el dinamico\b)/m,
      /^(?:in today's\b|in the digital age\b|in the age of\b|in a world where\b|the world of\b|at the end of the day\b)/m,
    ],
  },
  {
    problem: "reveal bridge",
    patterns: [
      /^(?:hablemos de\b|vamos a hablar de\b|esto es lo que\b|aca va (?:lo|el|la)\b|te cuento un secreto\b|alerta de spoiler\b|spoiler:|deja de [^.,\n]{1,40}[.,] empeza\b)/m,
      /¿(?:el|la|y el|y la) (?:resultado|respuesta|leccion|clave|trampa|verdad|moraleja|conclusion)\?/,
      /^(?:let's talk about\b|here's (?:what|how|why|the thing)\b|plot twist\b|the twist[:?]|spoiler[:?]|stop [^.,\n]{1,40}[.,] start\b)/m,
      /^the (?:result|outcome|answer|lesson|catch|kicker|truth)\?/m,
    ],
  },
  {
    problem: "sincerity announcement",
    patterns: [
      new RegExp(`${SENTENCE_START}(?:seamos (?:honestos|sinceros)|para ser (?:honest|sincer)[oa]|te soy (?:honest|sincer)[oa]|voy a ser (?:honest|sincer)[oa]|no te voy a mentir|la verdad es que|opinion impopular)\\b`, "m"),
      new RegExp(`${SENTENCE_START}(?:real talk|not gonna lie|ngl|to be (?:honest|direct|fair|transparent)|let me be (?:honest|real|direct|clear)|i'll be (?:honest|real|direct)|full transparency|unpopular opinion|storytime)\\b`, "m"),
    ],
  },
  {
    problem: "engagement bait",
    patterns: [
      /\b(?:comenta (?:si\b|abajo\b|"[^"\n]+"|'[^'\n]+')|contanos en (?:los )?comentarios\b|te leo en (?:los )?comentarios\b|deja(?:me|nos)? (?:tu comentario|en los comentarios)|etiqueta a\b|arroba a\b|doble tap\b|dale (?:like|me gusta) si\b|comparti si\b)/,
      /\b(?:comment (?:yes|below)\b|tag (?:\d+|a|your|three|two) (?:\w+ )?friends?\b|double tap\b|like if you\b|share if you\b)/,
    ],
  },
  {
    problem: "dead closing",
    patterns: [
      /¿(?:y )?(?:vos |ustedes |tu )?(?:que|como lo) (?:opinas|opinan|pensas|piensas|piensan|ves|te parece|les parece)\?/,
      /\b(?:what do you think\?|thoughts\?|let that sink in\b)/,
    ],
  },
  {
    problem: "negative parallelism",
    patterns: [
      /\bno (?:es|son|era|fue|se trata de)\b[^.!?\n]{1,60}[,;:.—–-]\s*(?:es|son|era|fue|se trata de|sino)\b/,
      /\bno\b[^.!?\n]{1,60}\bsino\b/,
      /\b(?:it's|it is|this is|that's|that is)(?: not|n't)\b[^.!?\n]{1,60}[,;:.—–-]\s*(?:it's|it is|this is|that's|but)\b/,
      /\b(?:isn't|aren't)\b[^.!?\n]{1,60}[,;:.—–-]\s*(?:it's|it is|this is|they're)\b/,
      /\bnot (?:just |only )?\w[^.!?\n]{0,40},\s*but\b/,
    ],
  },
];

// Ordinary words models overuse: one is language, three in a paragraph is a signature.
const VOCABULARY =
  /\b(?:significativ[oa]s?|crucial(?:es)?|notablemente|particularmente|integral(?:es)?|holistic[oa]s?|robust[oa]s?|aprovechar|potenciar|fomentar|panorama|matizad[oa]s?|multifacetic[oa]s?|agilizar|optimizar|elevar|empoderar|utilizar|facilitar|desbloquear|navegar|sumergir(?:se|nos|te)|sin fisuras|ecosistema|transformador(?:a|es)?|revolucionari[oa]s?|esencialmente|fundamentalmente|en definitiva|sin duda|significant|crucial|notably|particularly|comprehensive|holistic|insights?|robust|leverage|foster|landscape|nuanced|multifaceted|streamline|elevate|empower|utilize|harness|facilitate|unlock|navigate|dive (?:in|into)|seamless|ecosystem|fundamentally|essentially|ultimately|crucially|arguably|certainly|definitely|undoubtedly)\b/g;

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** The tone checks, for a caption and for what an image says. */
export function auditImageText(text: string): string[] {
  const plain = normal(text.replace(WEB_URL, " ")).trim();
  const problems = TELLS.filter((t) => t.patterns.some((p) => p.test(plain))).map((t) => t.problem);
  if (plain.split(/\n\s*\n/).some((paragraph) => (paragraph.match(VOCABULARY)?.length ?? 0) >= MARKERS_PER_PARAGRAPH)) problems.push(`${MARKERS_PER_PARAGRAPH} or more AI vocabulary markers in a paragraph`);
  const dashes = text.split("—").length - 1;
  if (dashes > Math.max(MIN_DASHES_ALLOWED, Math.floor(words(text) / 100))) problems.push("too many em dashes");
  return problems;
}

/** Where the first sentence or line ends, counted from the start of the text. */
function hookEnd(text: string): number {
  const stop = /[.!?…](?=\s|$)|\n/.exec(text);
  return stop ? stop.index + (stop[0] === "\n" ? 0 : 1) : text.length;
}

/** Everything a caption must be before it goes out with `signature` after it; empty when it may. */
export function auditCaption(raw: string, signature: string): string[] {
  const text = raw.trim();
  const problems = auditImageText(text);
  if (hookEnd(text) > HOOK_CHARS) problems.push(`hook: the first sentence or line ends after character ${HOOK_CHARS}`);
  const paragraphs = text.split(/\n\s*\n/);
  const last = paragraphs.at(-1)!;
  const tags = (s: string) => s.replace(WEB_URL, " ").match(HASHTAG)?.length ?? 0;
  const count = tags(text);
  if (count < HASHTAGS.min || count > HASHTAGS.max) problems.push(`hashtags: ${count}, and it takes ${HASHTAGS.min} to ${HASHTAGS.max}`);
  if (count && (tags(last) !== count || last.replace(HASHTAG, "").trim())) problems.push("hashtags: they go alone in the last paragraph");
  if (paragraphs.length < 2 && count) problems.push("hook: nothing but hashtags or no paragraph before them");
  if (text.length + 2 + signature.length > MAX_TEXT) problems.push(`length: with the signature it passes ${MAX_TEXT} characters`);
  return problems;
}
