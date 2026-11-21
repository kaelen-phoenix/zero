# Proposal

## Why

The control panel will show which package stations keep running while the factory has jobs queued or in progress. On the "Paquetes" page, each of those stations gets a note next to its state: «corre aunque la fábrica esté ocupada». On the summary page, a line lists them: «Estaciones que corren aunque la fábrica esté ocupada: …». The text is the same as in the terminal. When no station has this option, the panel looks the same as before. Someone looking at the panel can then see why a station uses the model during the day while other jobs are running.

## What Changes

- Panel: show stations that run while the factory is busy
- Supuesto: The `<span>` text in the station header now includes the mark, so tests should check for the substring, not the exact header markup.
- Supuesto: Neither docs/agents/panel.md nor docs/agents/packages.md describes overviewPage or packagesPage in detail, and the package panel views are documented in packages.md. The note goes in both, and panel.md only gets a short pointer.

## Capabilities

### New Capabilities
- `agent-packages`: Panel: show stations that run while the factory is busy

### Modified Capabilities

## Impact

Generado por zero para el trabajo 0625d242.
