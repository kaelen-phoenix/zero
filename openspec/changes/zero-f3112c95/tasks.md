# Tasks

## 1. Etapa 1: Protocolo endurecido y sondeo contra GitHub real

- [x] 1.1 Registro de cierre por CAS en releaseJob, cierre tratado como libre y takenFrom en claimJob, validación estricta de los registros
- [x] 1.2 probeCoord, `coord:probe` en coordPass (como mucho un intento por hora) y coordReady
- [x] 1.3 Tests de protocolo, sondeo y ausencia de llamadas sin distributed

## 2. Etapa 2: Tomar, comprobar y soltar en el daemon y el runner

- [x] 2.1 claimJob antes de runJob y releaseJob con el estado final, solo con coordReady
- [x] 2.2 Dep `holds` en el runner antes de cada estación y final como perdido sin tocar el origen
- [x] 2.3 Silenciar los reportes al origen de los trabajos terminados en otra máquina o perdidos, más sus tests

## 3. Etapa 3: Cola común con capacidades

- [x] 3.1 Publicar queue/<job> con needs y la request pasada por scrubLocal, deduplicar por sources/<clave>, importar con el mismo id
- [x] 3.2 Filtrar por capacidades (caja, motores) y no fallar líneas desconocidas
- [x] 3.3 Terminar las copias locales que se cerraron en otra máquina, más sus tests

## 4. Etapa 4: Subir el avance en cada checkpoint y al apagar

- [x] 4.1 push --force-with-lease contra el último sha propio, después de stillHolds, y progress/<job> por CAS
- [x] 4.2 Llamadas del runner después de la spec, de cada etapa verificada y antes de integrar
- [x] 4.3 Subir y soltar al apagar a propósito antes de liberar el lock, con tests sobre un remoto bare

## 5. Etapa 5: Retoma desde el último checkpoint y documentación

- [ ] 5.1 Leer progress, traer la rama del remoto y poner el trabajo en su checkpoint cuando hay takenFrom
- [ ] 5.2 Tests de retoma y de la máquina que vuelve
- [ ] 5.3 docs/agents/distributed.md, ADR 0007 con test/adr-distribuida.test.ts y el cambio OpenSpec
