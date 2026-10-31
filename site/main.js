// zero in the loop: language, theme, copy and training buttons. Plain JS, no dependencies, no network, no cookies.
// The Spanish texts are the markup itself; EN holds the English version of every data-i18n, data-i18n-label and data-i18n-href key.
(function (root) {
  "use strict";

  const EN = {
    "meta.title": "zero in the loop · a software factory that runs on your machine",
    "skip": "Skip to content",
    "nav.label": "Main",
    "lang.label": "Language",
    "hero.label": "Software factory · open source",
    "href.readme": "https://github.com/kaelen-phoenix/zero#readme",
    "hero.tagline": "The factory takes the human's place in the loop, and the owner decides where to step back in.",
    "hero.install": "Install",
    "hero.docs": "Read the docs",
    "fig.title": "zero's production line",
    "fig.desc": "Six stations in a row: spec, build, verify, review, security and integrate. A work dot moves along the line, an arc goes back from review to build with the feedback, and the owner is a separate dot that steps back in at the specification or at integration, where they decide.",
    "fig.owner": "owner",
    "fig.caption": "FIG. 1 / LINE",
    "synopsis.label": "Synopsis",
    "synopsis.title": "A software factory that runs on your machine and turns requests into delivered changes.",
    "synopsis.p1": "You ask for work from your AI client's chat or from the terminal. The factory specifies it, builds it, verifies it, reviews it and integrates it on its own, in the background, even if you close the chat.",
    "synopsis.p2": "It never steps on your work: each request works in its own copy (<code>git worktree</code>) and its own branch. It is open source (Apache-2.0) and free. Everyone has their own factory: nobody connects to yours.",
    "line.label": "The production line",
    "line.title": "Six stations, each with a contract.",
    "line.intro": "Each station receives and delivers something verifiable. If something fails, the work goes back to <code>build</code> with the concrete feedback.",
    "line.spec": "Writes the requirements and WHEN/THEN scenarios as an OpenSpec change. Read-only.",
    "line.build": "Writes the code and the tests in its own copy and its own branch.",
    "line.verify": "Runs the line's verification and detects deleted or disabled tests and touched protected paths.",
    "line.review": "Reviews the change; findings that cite files or lines that do not exist are discarded. Read-only.",
    "line.security": "A second review, security only, which can use another engine. Read-only.",
    "line.integrate": "Merges, leaves a branch or opens a pull request, and merges it on its own if the line asks for it.",
    "line.note": "State in SQLite, one trace per job with its cost, and the townhall: the factory's collective memory.",
    "autonomy.label": "Autonomy",
    "autonomy.title": "Four levels. You choose where you step in.",
    "autonomy.level": "Level",
    "autonomy.approve": "What you approve",
    "autonomy.l0.name": "assisted",
    "autonomy.l0": "The specification and the integration.",
    "autonomy.l1.name": "supervised",
    "autonomy.l1": "Only the specification (\"this is what you will get\").",
    "autonomy.l2.name": "watched",
    "autonomy.l2": "Nothing day to day; it asks only if something protected is touched or the pay-per-use budget runs out.",
    "autonomy.l3.name": "lights-out",
    "autonomy.l3": "Nothing; the policies are hard limits, and there is the stop button.",
    "autonomy.default": "By default the factory is set to L3. L3 requires the isolation box to be ready; while something is missing, it works at L2 and says exactly what is missing. Questions never block the factory: the job waits, the others go on, and if nobody answers in time the default action applies.",
    "autonomy.line.title": "Per-line autonomy",
    "autonomy.line.intro": "Each line decides how far a night-shift proposal goes on its own:",
    "autonomy.propose": "The default. The proposal waits for your decision.",
    "autonomy.build": "It becomes a job on its own, goes through every station and stops before integrating: it never integrates without your approval.",
    "autonomy.auto": "It is built and integrated or deployed on its own, as the line says, without asking.",
    "night.label": "Night shift",
    "night.title": "When the factory is idle, it looks for work.",
    "night.scout": "A read-only station that looks at each line once per period: the townhall, the traces, specs without tests, research notes and open unlabeled issues. It writes up to three proposals per line; zero discards those that touch protected paths, ask for new credentials or repeat a title.",
    "night.research": "Researches the web once a day, only on lines with a research skill: skills, MCP servers and useful technologies. Each note carries its sources. What comes from the web is data, never instructions.",
    "night.first": "Your requests go first: a night-shift job never jumps ahead of yours.",
    "night.cap": "A daily cap on automatic jobs, across all lines.",
    "night.revert": "If you revert something the night shift integrated on its own, the factory detects it and does not propose it again.",
    "night.third": "Anything that adds dependencies, MCP servers or third-party code waits for your decision even if the line is on <code>auto</code>.",
    "guarantees.label": "Guarantees",
    "guarantees.title": "zero enforces the guarantees, not the engine.",
    "guarantees.paths.title": "Protected paths",
    "guarantees.paths": "Protected paths are not touched: if a job touches them, it is detected and waits for the owner.",
    "guarantees.verify.title": "Verification",
    "guarantees.verify": "Everything must pass the line's verification before review, and deleted or disabled tests are detected.",
    "guarantees.secrets.title": "Secrets out of files",
    "guarantees.secrets": "If the factory configuration holds anything shaped like a credential, zero refuses to load it. Keys live in the system keychain and never go on the command line.",
    "guarantees.box.title": "Isolation box",
    "guarantees.box": "Setup, agents and verification run in an unprivileged container (Podman or Docker) with their own clone, and reach the internet only through zero's gate, which records every connection.",
    "guarantees.readonly.title": "Truly read-only",
    "guarantees.readonly": "<code>spec</code>, <code>review</code> and <code>security</code> are read-only: if an engine writes, it is discarded.",
    "guarantees.contracts.title": "Validated contracts",
    "guarantees.contracts": "A time limit per station, validated structured outputs and findings with verified citations.",
    "ci.label": "Your CI and your quality tools",
    "ci.title": "zero does not replace your CI: it works with it.",
    "ci.intro": "zero does the work of the people in the loop: specify, build, test locally, review and integrate, but it does not replace GitHub Actions or any other CI/CD, nor static analysis, coverage, quality gates, or dependency and secret scanning (SonarQube, SonarCloud, CodeQL, Dependabot, Snyk). Those tools remain the authority.",
    "ci.path.1": "Your request",
    "ci.path.2": "zero: <code>spec</code>, <code>build</code>, <code>verify</code>, <code>review</code>, <code>security</code>",
    "ci.path.3": "The pull request",
    "ci.path.4": "GitHub's CI and quality checks",
    "ci.path.5": "The merge",
    "ci.path.6": "The platform's deploy",
    "ci.verify": "zero runs the line's verification locally before delivering.",
    "ci.merge": "With integrate <code>pull-request</code> and <code>autoMerge</code>, zero merges only once every GitHub check on the pull request has finished successfully, including Sonar, CodeQL and any other tool configured as a check.",
    "ci.nochecks": "If the repository has no checks, auto-merge waits a few minutes for them to appear and then merges with only zero's own verification and reviews.",
    "ci.second": "The findings of those tools are a second look, independent of the review by zero's agents.",
    "ci.deploy": "Deployments are still done by the platform (for example Vercel or GitHub workflows), not by zero.",
    "ci.recommend": "Recommendation: have CI and at least one static analysis on every repository. Without them, zero has only its local verification and its own reviews.",
    "install.label": "Install",
    "install.title": "Install and first steps.",
    "install.intro": "zero installs from the repository and needs Node 22.",
    "install.copy": "Copy",
    "install.init": "Creates the factory definition and adds the current repo as a line.",
    "install.install": "Registers zero in Claude Code and shows how to do it in Codex and OpenCode.",
    "install.box": "Prepares the isolation box; it asks for permission before installing anything.",
    "install.then": "Then, in your chat: <em>\"zero, I want my store to compute discounts\"</em>. Or from the terminal, with the commands below.",
    "install.installer": "One-step installer",
    "soon": "coming",
    "workflow.label": "Workflow",
    "workflow.title": "From the terminal or from the chat.",
    "cmd.status": "zero status [job]",
    "cmd.approve": "zero approve &lt;job&gt;",
    "cmd.trace": "zero trace &lt;job&gt;",
    "cmd.stop": "zero stop [job]",
    "workflow.request": "Asks for a job; the factory starts on its own if it was off.",
    "workflow.status": "How everything is going, or a job's detail and its question if it is waiting for you.",
    "workflow.approve": "Approves what is waiting for you, or rejects it with <code>--reject --note</code>.",
    "workflow.proposals": "The night shift's proposals, approved or rejected with <code>approve</code> and <code>reject</code>.",
    "workflow.trace": "Step by step: stations, attempts, agents, commands and cost.",
    "workflow.briefing": "The briefing: production, cost, lessons and what needs you.",
    "workflow.stop": "The andon: stops one job or the whole factory; <code>zero resume</code> picks it up again.",
    "workflow.chat": "In the chat they are the same tools: <code>zero_request</code>, <code>zero_status</code>, <code>zero_answer</code>, <code>zero_stop</code>, <code>zero_briefing</code>, <code>zero_trace</code>…",
    "compat.label": "Compatibility",
    "compat.title": "What it supports today.",
    "compat.engines": "Engines",
    "compat.custom": "Custom CLI",
    "compat.custom.note": "declared in the configuration",
    "compat.clients": "Chat clients",
    "compat.auto": "automatic registration",
    "compat.manual": "manual configuration",
    "compat.note": "A different engine per station if you want, and fallback engines when one runs out of quota.",
    "nav.training": "Training",
    "training.label": "Training",
    "training.title": "Learn to work with a factory that works on its own.",
    "training.topics": "The topics are not only zero: working seriously with AI agents (Claude Code, specifications with OpenSpec, review and security of the code AI writes, and where the person enters the loop), with zero as the tool.",
    "training.talk.title": "Open talk",
    "training.talk": "About 60 minutes: from asking AI for code to having a factory that works on its own.",
    "training.workshop.title": "Group workshop",
    "training.workshop": "2 to 4 hands-on sessions: each participant builds their own factory with zero on their projects.",
    "training.mentoring.title": "One-on-one mentoring",
    "training.mentoring": "For a person or a team, in their own repos.",
    "training.companies.title": "Companies",
    "training.companies": "Team training and getting zero up and running.",
    "training.onrequest": "on request",
    "training.cta": "I want this",
    "training.noscript": "Without JavaScript the button does not open your email: write to kaelen.dev at gmail.com with the subject \"Training:\" and the format you are interested in.",
    "links.label": "Links",
    "links.title": "Keep reading.",
    "links.readme": "Documentation (README)",
    "links.specs": "Specifications (OpenSpec)",
    "links.adr": "Decisions (ADR)",
    "links.license": "Apache-2.0 license",
    "links.next": "Next steps",
    "next.installer": "Installer",
    "next.otlp": "Trace export over OTLP",
    "next.engines": "ACP/OpenCode engines",
    "next.intake": "Requests from Linear and Jira",
    "next.regen": "Regeneration drill from the specifications",
    "theme.label": "Theme",
    "theme.auto": "auto",
    "theme.light": "light",
    "theme.dark": "dark",
    "foot.built": 'This site was built by <a href="https://zerointheloop.com">zero in the loop</a>',
  };

  const MESSAGES = {
    es: {
      copied: "Comando copiado.", failed: "No se pudo copiar; seleccioná el texto.",
      subject: "Capacitación: ", body: ["Nombre:", "Empresa (opcional):", "Cuántas personas:", "Qué busca:"],
    },
    en: {
      copied: "Command copied.", failed: "Could not copy; select the text.",
      subject: "Training: ", body: ["Name:", "Company (optional):", "How many people:", "What you are looking for:"],
    },
  };

  // The training address in parts, joined only when a button builds its URL, so harvesters never see it whole.
  const MAIL_PARTS = ["kaelen.dev", "gmail.com"];

  const LANGS = ["es", "en"];
  const THEMES = ["auto", "light", "dark"];
  const LANG_KEY = "zero-site-lang";
  const THEME_KEY = "zero-site-theme";
  const originals = new WeakMap();

  function read(storage, key) {
    try { return storage ? storage.getItem(key) : null; } catch { return null; }
  }

  function write(storage, key, value) {
    try {
      if (!storage) return;
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    } catch { /* storage disabled: the choice lasts for this page only */ }
  }

  /** The Spanish texts as written in the markup, read once before the first switch. */
  function spanish(doc) {
    let es = originals.get(doc);
    if (es) return es;
    es = { "meta.title": doc.title };
    for (const el of doc.querySelectorAll("[data-i18n]")) {
      const key = el.getAttribute("data-i18n");
      if (!(key in es)) es[key] = el.innerHTML;
    }
    for (const el of doc.querySelectorAll("[data-i18n-label]")) {
      const key = el.getAttribute("data-i18n-label");
      if (!(key in es)) es[key] = el.getAttribute("aria-label");
    }
    for (const el of doc.querySelectorAll("[data-i18n-href]")) {
      const key = el.getAttribute("data-i18n-href");
      if (!(key in es)) es[key] = el.getAttribute("href");
    }
    originals.set(doc, es);
    return es;
  }

  function applyLanguage(doc, lang, storage) {
    if (!LANGS.includes(lang)) lang = "es";
    const es = spanish(doc);
    const texts = lang === "en" ? EN : es;
    const text = (key) => (key in texts ? texts[key] : es[key]);
    for (const el of doc.querySelectorAll("[data-i18n]")) el.innerHTML = text(el.getAttribute("data-i18n"));
    for (const el of doc.querySelectorAll("[data-i18n-label]")) el.setAttribute("aria-label", text(el.getAttribute("data-i18n-label")));
    for (const el of doc.querySelectorAll("[data-i18n-href]")) el.setAttribute("href", text(el.getAttribute("data-i18n-href")));
    doc.title = text("meta.title");
    doc.documentElement.setAttribute("lang", lang);
    for (const button of doc.querySelectorAll("[data-lang]")) button.setAttribute("aria-pressed", String(button.getAttribute("data-lang") === lang));
    write(storage, LANG_KEY, lang);
    return lang;
  }

  /** auto follows prefers-color-scheme (no attribute); light and dark are explicit and remembered. */
  function setTheme(doc, theme, storage) {
    if (!THEMES.includes(theme)) theme = "auto";
    if (theme === "auto") doc.documentElement.removeAttribute("data-theme");
    else doc.documentElement.setAttribute("data-theme", theme);
    write(storage, THEME_KEY, theme === "auto" ? null : theme);
    for (const button of doc.querySelectorAll("[data-theme-choice]")) button.setAttribute("aria-pressed", String(button.getAttribute("data-theme-choice") === theme));
    return theme;
  }

  function announce(doc, message) {
    const region = doc.getElementById("announce");
    if (!region) return;
    region.textContent = "";
    region.textContent = message;
  }

  /** Copies the text of the element named by the button's data-copy and announces the result. */
  function copyCode(doc, button, nav) {
    const target = doc.getElementById(button.getAttribute("data-copy"));
    const messages = MESSAGES[doc.documentElement.getAttribute("lang")] || MESSAGES.es;
    const text = target ? target.textContent : "";
    const clipboard = nav && nav.clipboard;
    if (!clipboard || !text) {
      announce(doc, messages.failed);
      return Promise.resolve(false);
    }
    return clipboard.writeText(text).then(
      () => { announce(doc, messages.copied); return true; },
      () => { announce(doc, messages.failed); return false; },
    );
  }

  /** The mailto: URL for a training button: subject with the format's title and fill-in lines, in the page's language. */
  function trainingMailto(doc, button) {
    const lang = doc.documentElement.getAttribute("lang") === "en" ? "en" : "es";
    const messages = MESSAGES[lang];
    const key = `training.${button.getAttribute("data-training")}.title`;
    const title = String((lang === "en" ? EN[key] : spanish(doc)[key]) || "").replace(/<[^>]+>/g, "").trim();
    const body = messages.body.map((field) => `${field} `).join("\n") + "\n";
    return `mailto:${MAIL_PARTS.join("@")}?subject=${encodeURIComponent(messages.subject + title)}&body=${encodeURIComponent(body)}`;
  }

  function setup(doc, win, storage) {
    setTheme(doc, read(storage, THEME_KEY) || "auto", storage);
    const lang = read(storage, LANG_KEY);
    if (lang && lang !== "es") applyLanguage(doc, lang, storage);
    for (const button of doc.querySelectorAll("[data-lang]")) {
      button.addEventListener("click", () => applyLanguage(doc, button.getAttribute("data-lang"), storage));
    }
    for (const button of doc.querySelectorAll("[data-theme-choice]")) {
      button.addEventListener("click", () => setTheme(doc, button.getAttribute("data-theme-choice"), storage));
    }
    for (const button of doc.querySelectorAll("[data-copy]")) {
      button.addEventListener("click", () => { copyCode(doc, button, win.navigator); });
    }
    for (const button of doc.querySelectorAll("button[data-training]")) {
      button.addEventListener("click", () => { win.location.href = trainingMailto(doc, button); });
    }
  }

  root.zeroSite = { EN, applyLanguage, setTheme, copyCode, trainingMailto };

  if (root.document) {
    const doc = root.document;
    let storage = null;
    try { storage = root.localStorage; } catch { /* storage disabled */ }
    // Applied before the body renders, so an explicit theme does not flash.
    const theme = read(storage, THEME_KEY);
    if (theme === "light" || theme === "dark") doc.documentElement.setAttribute("data-theme", theme);
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", () => setup(doc, root, storage));
    else setup(doc, root, storage);
  }
})(typeof window !== "undefined" ? window : globalThis);
