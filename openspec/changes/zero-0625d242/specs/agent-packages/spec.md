# Spec Delta

## Purpose

The control panel will show which package stations keep running while the factory has jobs queued or in progress. On the "Paquetes" page, each of those stations gets a note next to its state: «corre aunque la fábrica esté ocupada». On the summary page, a line lists them: «Estaciones que corren aunque la fábrica esté ocupada: …». The text is the same as in the terminal. When no station has this option, the panel looks the same as before. Someone looking at the panel can then see why a station uses the model during the day while other jobs are running.

## ADDED Requirements

### Requirement: Packages page marks whenBusy stations
The panel's /packages page (`packagesPage` in src/panel/html.ts) SHALL show the text «corre aunque la fábrica esté ocupada» in the card of each station whose `packageList` view has `whenBusy: true`, next to its state, and MUST NOT show it for a station without whenBusy.

#### Scenario: whenBusy station is marked
- **WHEN** a package with allowCode: true has a station `nota` with `whenBusy: true`, and packagesPage(packageList(ctx), [], 'n') is rendered
- **THEN** the HTML contains «corre aunque la fábrica esté ocupada» inside the card for station nota

#### Scenario: plain station is not marked
- **WHEN** the same package's station does not declare whenBusy and packagesPage(packageList(ctx), [], 'n') is rendered
- **THEN** the HTML does not contain «corre aunque la fábrica esté ocupada»

### Requirement: Panel summary lists whenBusy stations
The panel summary (`overviewPage` in src/panel/html.ts) SHALL show a line «Estaciones que corren aunque la fábrica esté ocupada: » followed by the names in `FactoryStatus.whenBusy` (`<package>/<station>`, separated by ", " and HTML-escaped) when that list is not empty, and MUST NOT show that line when it is empty.

#### Scenario: summary names the stations
- **WHEN** a whenBusy station hello/nota is loaded and overviewPage(factoryStatus(ctx), [], 'n') is rendered
- **THEN** the HTML contains «Estaciones que corren aunque la fábrica esté ocupada:» and «hello/nota»

#### Scenario: no line without whenBusy stations
- **WHEN** no loaded station declares whenBusy and overviewPage(factoryStatus(ctx), [], 'n') is rendered
- **THEN** the HTML does not contain «Estaciones que corren aunque la fábrica esté ocupada»
