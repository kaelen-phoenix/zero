# Proposal

## Why

Con Podman 5 la puerta de salida no resuelve ningún sitio: toda conexión permitida termina en 502. La red interna de la caja se creaba con el servidor de nombres propio de Podman, que en una red interna ya no responde nombres de afuera, y la puerta, que arranca en esa red, lo tomaba como su único resolvedor. Desde que los runners de GitHub pasaron a Ubuntu 26.04 (Podman 5.7) el check `box (podman)` falla en todos los pull requests de zero y ninguno se funde solo. Con Podman 4 y con Docker no pasa.

## What Changes

- La red interna de la caja se crea, con Podman, sin servidor de nombres propio (`--disable-dns`). La puerta resuelve con los resolvedores del anfitrión, que recibe por la red por defecto. Las cajas siguen sin DNS y llegan a la puerta por dirección.
- Una red que una versión anterior dejó con ese servidor se vuelve a crear sin él en cuanto solo la puerta de esta fábrica está en ella. Mientras otros contenedores la usan queda como está y se registra un aviso.

## Capabilities

### New Capabilities

### Modified Capabilities
- `egress-gate`: la puerta resuelve nombres con cualquier versión de Podman

## Impact

`src/box/network.ts` y `test/egress.test.ts`. Sin cambios para Docker.
