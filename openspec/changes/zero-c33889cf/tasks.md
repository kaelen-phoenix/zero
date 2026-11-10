# Tasks

## 1. Implementación

- [ ] 1.1 Add the OpenSpec change `openspec/changes/zero-c33889cf/` (proposal.md, tasks.md, specs/agent-packages/spec.md with ADDED requirements named as above; agent-packages has no main spec, only deltas of unarchived changes such as zero-87d60999) and check it with `npx openspec validate --all`.
- [ ] 1.2 In src/app.ts, add `onDemandPendingSince?: string` (documented: ISO time of the pending on-demand request, only for stations declaring onDemand) to `PackageStationView`, and set it in `packageList` from `ctx.store.getKv(stationOnDemandKey(p.name, name))` only when the loaded station has `onDemand` (spread it so it is absent otherwise).
- [ ] 1.3 In src/app.ts, add `onDemand: { station: string; since: string }[]` to `FactoryStatus`, filled in `factoryStatus` from `ctx.config.loadedPackages?.stations` filtered by `onDemand` and a present `stationOnDemandKey` (station written `<package>/<name>`). Reads only.
- [ ] 1.4 In src/format.ts, give `formatPackages` an optional `now = new Date()` parameter and append ` · corrida a demanda pendiente desde ${resetTime(s.onDemandPendingSince, now)}` to the station line when the field is present.
- [ ] 1.5 In src/format.ts `formatStatus`, after the package problems line, push `Corridas a demanda pendientes: ` + entries `${station} (desde ${resetTime(since, now)})` joined with `, ` when `s.onDemand.length` is greater than 0. Read it as `s.onDemand ?? []` if tests building FactoryStatus by hand would otherwise break, or update those fixtures so typecheck passes.
- [ ] 1.6 Add tests in test/package-on-demand.test.ts covering packageList (pending, absent, station without onDemand with a stray key, kv untouched), formatPackages (same-day HH:MM, other stations unchanged) and factoryStatus/formatStatus (line present with `hello/nota (desde 10:05)`, absent when nothing is pending). Use local `new Date(y, m, d, h, min)` dates so results do not depend on the timezone.
- [ ] 1.7 Update the `src/packages.ts` paragraph of AGENTS.md to say that `packageList` and `factoryStatus` show the pending on-demand request time, and run `npm run typecheck` and `npm test`.
