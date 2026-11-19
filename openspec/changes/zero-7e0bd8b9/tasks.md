# Tasks

## 1. Etapa 1: Vista de datos de la sala de control

- [x] 1.1 Write the OpenSpec change `openspec/changes/zero-7e0bd8b9/` (proposal, tasks, ADDED requirements under `specs/control-panel/spec.md`) and validate it.
- [x] 1.2 Add `ControlRoomView` and the read-only `controlRoomView(ctx, now)` to `src/app.ts`: topbar, events, graph and decisions, series per line, bus, trace, engines and alerts, all from the stored state.
- [x] 1.3 Add `test/control-room.test.ts` with the view's scenarios, including the no-writes check.

## 2. Etapa 2: Página, estética y menú

- [ ] 2.1 Create `src/panel/control-room.ts` with `controlRoomFragment`, `CONTROL_STYLE` (dark console, monospace, neon colours by `data-status`, ticker animation with `prefers-reduced-motion`, single column up to 600 px) and `controlRoomPage` through `page()`.
- [ ] 2.2 Add the `NAV` entry "Sala de control" to `src/panel/html.ts`. In `src/panel/server.ts`, serve GET `/control-room` and `/control-room?fragment=1` and add `/control-room` to the active-section mapping.
- [ ] 2.3 Add page tests: the menu link and `aria-current`, 401 without a session, every module's `data-` hooks, no external resources, the CSS rules and no forms.

## 3. Etapa 3: Stream en vivo y animación

- [ ] 3.1 Generalise the panel's stream code so each stream carries its own render function, then add GET `/control-room/events` with the same watcher, heartbeat, session check and headers as `/line/events`.
- [ ] 3.2 Add `CONTROL_REFRESH` to the page: `EventSource` with a 5 s polling fallback, dots moved in place by `data-job` with a CSS transition, other modules replaced when they change, and the clock ticking every second.
- [ ] 3.3 Add stream tests (first fragment, update after a new queued job, 401 without a session, `/line/events` unaffected) and check that the page script references both the stream and the fragment URL.
- [ ] 3.4 Update AGENTS.md and, if the READMEs list the panel tabs, both READMEs. Run typecheck, tests and the openspec validation.
