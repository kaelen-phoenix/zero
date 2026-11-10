# Proposal

## Why

La fábrica deja de preguntarle a GitHub en cada vuelta por los pull requests cerrados sin fundir, y vuelve a mirar cada uno una sola vez cada 24 horas. La fecha de la próxima consulta queda guardada, así que reiniciar el daemon no la adelanta. Si un pull request se reabre y se funde, la fábrica lo nota en la siguiente consulta y registra su commit, con hasta 24 horas de demora, y puede reconocer una reversión posterior. Los pull requests abiertos se siguen consultando como hoy. Si la fecha guardada no se puede leer, la fábrica consulta como siempre.

## What Changes

- detectReverts: consultar una vez cada 24 horas los PRs cerrados sin fundir
- Supuesto: Supuesto: un PR que se reabre y se funde durante la espera se registra hasta 24 horas tarde. La reversión no se pierde, porque `revertMessages` busca en todo el historial de la rama base, pero se reconoce más tarde. Lo acepta el pedido.
- Supuesto: Un PR cerrado para siempre sigue costando una consulta cada 24 horas y conserva su clave kv mientras la propuesta siga `approved`. El pedido lo descarta a propósito: no se abandona definitivamente para poder ver una reapertura.
- Supuesto: Supuesto: los términos `abierto`, `no fundido` se toman de `PullRequestState` tal como los informa la `MergeApi`. Un PR fundido sin `mergeCommitSha` no se considera cerrado sin fundir, así que se sigue consultando en cada pasada.
- Supuesto: Supuesto: borrar la clave cuando el PR aparece abierto o fundido no figura en el pedido; se agrega para no dejar filas viejas en kv y porque un PR abierto no debe esperar. Si el borrado falla, una fecha vigente podría demorar una consulta hasta 24 horas, sin más efecto.
- Supuesto: Si se atrasa el reloj de la máquina, una fecha guardada puede quedar más lejos que 24 horas y demorar la siguiente consulta. No se limita, para mantener el cambio chico.

## Capabilities

### New Capabilities
- `night-shift`: detectReverts: consultar una vez cada 24 horas los PRs cerrados sin fundir

### Modified Capabilities

## Impact

Generado por zero para el trabajo 3c31bef8.
