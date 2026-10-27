# Proposal

## Why

Cuando un trabajo que vino de un issue termina, el dueño sigue la conversación en el mismo issue: pregunta por qué no ve el cambio publicado, pide un ajuste o responde una consulta. Hoy la fábrica no lee los comentarios, así que esas respuestas se pierden. Pasó con el primer issue de newoman: el trabajo quedó integrado solo en la PC del dueño, el dueño comentó "No lo veo desplegado" y nadie contestó.

También el mensaje de entrega confunde en las líneas `merge`: dice "integrado en la rama base", pero no aclara que el cambio está en la PC del dueño y no en GitHub.

Principios que sirve:
- **Fábrica a oscuras**: el dueño conversa con la fábrica desde el issue, en el celular, sin abrir un chat.
- **Garantías impuestas por zero**: solo se leen comentarios de personas con permiso de escritura, igual que los issues; los hechos que responde el agente los calcula zero (dónde quedó el cambio), no el agente.
- **Agnóstico al motor**: el agente que responde es una estación más, con instrucciones en `agents/` y motor configurable.

## What Changes

- **Comentarios del issue**, en los issues que tienen un trabajo de la fábrica:
  - se leen solo los comentarios nuevos de personas con permiso de escritura; los de la propia fábrica (marcados) y los de otras cuentas se ignoran;
  - se atienden cuando el trabajo terminó o está esperando al dueño; mientras trabaja, esperan;
  - una estación nueva, `reply`, de solo lectura y sin acceso al repositorio, lee el issue, el trabajo y los comentarios, y decide: **responder**, **pedir un cambio**, o **aprobar/rechazar** la consulta pendiente;
  - zero le pasa los hechos del trabajo: estado, qué se entregó, y si el cambio está en GitHub (la rama base del remoto lo contiene, el pull request está abierto o fundido);
  - un pedido de cambio crea un trabajo nuevo sobre el mismo issue, con el pedido original, lo que se hizo y el comentario; aprobar o rechazar solo vale si el trabajo está esperando;
  - la fábrica responde en el issue, una vez por tanda de comentarios.
- **Mensajes de entrega más claros** en el issue: en las líneas `merge` dicen que el cambio quedó en la PC del dueño y que hay que subirlo.
- La consulta en el issue explica que también se puede responder comentando.

## Capabilities

### Modified Capabilities
- `work-intake`: el issue también sirve para seguir la conversación con la fábrica.

## Impact

- Código nuevo: `agents/reply.md`, `src/intake/comments.ts`.
- Cambios en `src/intake/github.ts` (leer comentarios, marca en los comentarios de la fábrica, mensajes), `src/agent.ts` y `src/config.ts` (estación `reply`), `src/daemon.ts` (pasa el ejecutor de agentes), `src/line/automerge.ts` (marca).
- Sin dependencias nuevas.

**Fuera de alcance**:
- Comentarios en pull requests.
- Editar o borrar comentarios ya respondidos.
- Leer comentarios de personas sin permiso de escritura.
