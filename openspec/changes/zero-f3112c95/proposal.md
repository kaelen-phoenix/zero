# Proposal

## Why

Con el bloque `distributed` configurado, varias máquinas van a trabajar sobre la misma cola sin pisarse. Antes de usar el protocolo, cada máquina lo prueba una vez contra el repositorio de coordinación real en GitHub, para confirmar que GitHub rechaza con 422 crear una referencia que ya existe y moverla sin avance rápido. Si la prueba no sale bien, la máquina sigue trabajando sola, como hoy. Con la prueba aprobada: - cada trabajo se publica en la cola común; - cada máquina toma solo los trabajos que puede hacer (caja de aislamiento, motores); - ninguna empieza un trabajo sin tomarlo antes, y antes de cada estación confirma que sigue siendo suyo; - al terminar lo suelta y avisa a las demás cómo terminó; - la rama del trabajo se sube a GitHub en cada checkpoint y al apagar la máquina a propósito, siempre con --force-with-lease y solo si el trabajo sigue siendo suyo; - si una máquina se cae y vence su plazo, otra retoma el trabajo desde el último checkpoint subido. La que vuelve se entera de que lo perdió y deja el trabajo sin subir, sin integrar y sin comentar nada. Sin `distributed`, todo sigue exactamente igual que hoy.

## What Changes

- Fábrica distribuida, segunda parte: cola común, avance compartido y retoma
- Supuesto: El sondeo contra GitHub real solo puede correrse en una máquina con `distributed` y un token. Los tests de CI lo prueban con CoordApi falsos, así que la confirmación real llega la primera vez que el daemon corre en modo distribuido; hasta entonces el runner no depende del protocolo.
- Supuesto: Supuesto: si el sondeo no da ok, la máquina trabaja como si estuviera sola (sin tomar ni importar trabajos). Dos máquinas en ese estado pueden repetir trabajo como hoy.
- Supuesto: Requisito de plataforma: ninguna línea declara hoy en qué plataforma tiene que correr, así que needs solo lleva box y engines. La plataforma se publica en el latido pero ningún trabajo la pide todavía.
- Supuesto: Los motores se comparan con lo que cada máquina declara según su archivo, no con si el motor está instalado y con sesión iniciada.
- Supuesto: La deduplicación por origen redirige el estado de los issues de GitHub; en Linear y Jira el trabajo duplicado solo se calla, y su estado de intake puede seguir apuntando al id local.
- Supuesto: Una máquina con el reloj desfasado varios minutos puede dar por caída a otra que está viva. El caso se cubre con stillHolds y el lease del push, pero se pierde trabajo.
- Supuesto: Los trabajos en espera de una respuesta (waiting) quedan tomados mientras su máquina late; responderlos desde otra máquina queda para después.
- Supuesto: Lo que se lee de queue/ y progress/ (request, spec) es texto que después usan agentes de otra máquina: hay que validarlo estrictamente y tratarlo como dato. Quien puede escribir en el repositorio de coordinación puede repartir trabajo, como dice el ADR.

## Capabilities

### New Capabilities
- `distributed-factory`: Fábrica distribuida, segunda parte: cola común, avance compartido y retoma

### Modified Capabilities

## Impact

Generado por zero para el trabajo f3112c95.
