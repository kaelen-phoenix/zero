# Spec Delta

## ADDED Requirements

### Requirement: La puerta resuelve nombres con cualquier runtime
La puerta SHALL resolver los nombres de los sitios con los resolvedores del anfitrión, sea cual sea el runtime y su versión. La red interna de la caja MUST NOT tener un servidor de nombres propio del runtime: con Podman se crea sin él, y una red que ya lo tiene se vuelve a crear sin él cuando solo la puerta de la fábrica está en ella.

#### Scenario: Sitio normal con Podman 5
- **WHEN** una caja con Podman 5 descarga de `registry.npmjs.org` a través de la puerta
- **THEN** la puerta resuelve el nombre, la descarga funciona y la conexión queda registrada como permitida

#### Scenario: Red creada por una versión anterior
- **WHEN** la red interna existe con el servidor de nombres de Podman y solo la puerta de la fábrica está en ella
- **THEN** zero quita la puerta, vuelve a crear la red sin ese servidor y enciende la puerta otra vez

#### Scenario: Red en uso
- **WHEN** la red interna existe con el servidor de nombres de Podman y otros contenedores la usan
- **THEN** zero no la toca en esa ejecución y registra un aviso
