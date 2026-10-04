# CB-108 — READY_FOR_HUMAN_TEST

Base exacte : `d763dc0`. Un seul commit local d’intégration au-dessus de cette base ; aucun merge, push, déploiement ou changement CodexBridge. Le SHA final est celui du commit contenant ce rapport (`git rev-parse HEAD`).

## Matrice d’intégration

| Source comparée | Intégration et revue croisée | Validation |
| --- | --- | --- |
| CB-104, diff de travail sur d763dc0 | Réservation de l’ouverture du dialogue avant chargement asynchrone ; aucune seconde ouverture ne réinitialise la saisie active. Déférer les rerenders et protéger les raccourcis clavier restent en place. | Clavier réel, double clic avec réponse retardée, télémétrie/reconnexion, création, édition, duplication, tags, récurrence et save en Chromium. |
| CB-105, diff de travail sur d763dc0 | Retry réel avec identité/ETag conservés ; relecture avant remplacement d’un objet supposé supprimé ; Google cancelled sans dates/404/410 ; conflits et erreurs UI. La validation native weekly-1 de la base est conservée. | 14 parcours bouton → API → orchestrateur → HTTP provider simulé. Weekly-1 préchargé avec l’ancien message atteint POST/PATCH Twitch ; l’erreur obsolète disparaît du résultat et du toast. Pas de POST supplémentaire après succès. Récurrences non représentables toujours refusées par les suites existantes. |
| CB-106, diff de travail sur d763dc0 | Aperçu/count, jeton à usage unique, confirmation liée aux destinations et contenu, exclusion séries/occurrences/externe/travail incertain, période durable sur les liens. Relecture distante au retry après restart ; garde Google ETag et Twitch récurrence/période. | Mélange simples + séries, refus aperçu périmé/rejoué, local seul, providers déconnectés, erreurs, déplacement/récurrence distante, restart puis retry/édition. |
| CB-107, commit 779a59c | Moteur dynamique branché à Régénérer et aux auto-tags du preflight ; Get Streams game_id + first=100, TTL 6 h, cache borné, timeout 800 ms et fallback ; historique jeu/série et exceptions isolées. | Fixture Spooktober + Dead Island 2 : DeadIsland2, Zombie, Horror, Action, Coop et Halloween. Live ordinaire sans Halloween. Test API de génération puis auto-tags sans tags sauvegardés → vrai preflight → PATCH Helix simulé. |

Le conflit Git portait sur les imports de `apps/server/src/index.ts` : les deux fonctionnalités sont conservées. Revue des chevauchements dans `planning.ts`, `index.ts`, `preview.js`, le client Twitch et les contrats. Correction supplémentaire : la suppression par période reconnaît le code Google `DELETED_REMOTELY` introduit par CB-105, y compris cancelled sans dates ; test dédié ajouté. Les protections RRULE, exceptions, identité incertaine, tags manuels, preflight et récurrence Twitch de la base restent couvertes par la suite complète.

## Validation exécutée

Environnement Linux, Node 24.21.0. Pour les commandes utilisant un répertoire temporaire ou Chromium :

```sh
export TMPDIR=/var/lib/codexbridge/.npm/cb108-tmp
export PLAYWRIGHT_BROWSERS_PATH=/var/lib/codexbridge/.npm/cb52-review-browser
export electron_config_cache=/var/lib/codexbridge/.npm/electron
```

| Commande | Résultat réel |
| --- | --- |
| `npm ci --no-audit --no-fund` | Réussi. |
| `npx vitest run tests/provider-retry.test.ts tests/google-cancelled-retry.test.ts tests/planning-bulk-delete.test.ts tests/tag-intelligence.test.ts tests/tags-integration.test.ts tests/cb103-integration.test.ts` | 52 tests, 6 fichiers réussis. |
| `node --test tests/desktop-planning-editor.node.test.mjs tests/provider-retry-real-flow.node.test.mjs tests/planning-bulk-delete.node.test.mjs` | 16 tests réussis. |
| `npm test` | 819 tests Vitest / 105 fichiers + 138 tests Node réussis, aucun skip. Inclut build. |
| `npm run test:browser` | 13 tests réussis. |
| `npm run mobile:smoke` | Réussi : auth LAN, pairing, redaction, scopes, WS ticket et révocation. |
| `npm run build` | Réussi. |
| `npm run security:check` | Réussi, 259 fichiers. |
| `npm run check:shipped-js` | Réussi, 31 fichiers. |
| `npm audit` et `npm audit --omit=dev` | Zéro vulnérabilité pour chaque audit. |
| `npm run smoke` avec DASHBOARD_URL d’un serveur démarré sur port éphémère et données temporaires | Réussi : health, état et capacités API v1. Serveur arrêté et données supprimées ensuite. |
| `npm run desktop:package` | Réussi, win32/x64 ; contrôle ASAR réussi. Artifact local : `out/StreamDashboard-win32-x64`. |
| `npm run desktop:smoke` | Non validé : Electron ne peut pas démarrer sans serveur X/$DISPLAY. Résiduel accepté par le ticket, à exécuter en CI Windows. |
| `git diff --check` et `git diff --cached --check` | Réussis avant commit. |

Les premières invocations ciblées sans TMPDIR et security:check ont échoué avant exécution à cause du `/tmp` non accessible ; les relances dans le cache npm autorisé sont vertes. Le premier essai Electron a également rencontré un cache par défaut en lecture seule ; installation avec `electron_config_cache` corrigée, puis relance pour isoler le résiduel DISPLAY.

## Risques et test humain

- Les providers sont simulés à la frontière HTTP : vérifier en usage réel Twitch/Google connectés, notamment retry weekly-1, Google supprimé, et copies distantes d’une suppression par période.
- Twitch n’offre pas de suppression conditionnelle : la relecture immédiate réduit le risque mais ne peut exclure une mutation concurrente entre GET et DELETE. Google utilise If-Match.
- Les séries sont volontairement exclues de la suppression par période. Après une suppression distante initialement en échec, le retry standard retire la copie distante mais conserve le local ; un nouvel aperçu termine le retrait local.
- À froid ou hors ligne, les auto-tags utilisent le fallback immédiatement ; Régénérer attend au plus le rafraîchissement borné. Le cache d’observations reste en mémoire ; l’historique local est persisté.
- Le correctif clavier est reproduit et vérifié en Chromium Linux. Confirmer les parcours Electron et le clavier sur Windows avec l’application packagée ; aucun résultat Electron vert n’est revendiqué ici.
