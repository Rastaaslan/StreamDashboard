# Lot O — F06 visible dans Planning, wave4, 2026-11-01

Base `b242696`, branche `streamcockpit/3.0-lot-o`, worktree `/home/damien/StreamCockpit-3.0-Lot-O`. PLAN, matrice, CONTINUITY et rapports des modules A–L consultés. G2 reste **in_progress**, G3–G5 **open** ; aucune qualification matérielle ou finale.

## Fichiers et branchement réel

- `apps/mobile/control/control.js` : transmet seulement l’état `online` existant à Planning. Aucun changement de navigation, timer, routage de commandes ou Live.
- `apps/mobile/control/planning.js` : importe le module navigateur et rend l’assistant dans la page classique et chacune des vues Android Prochain live / Cette semaine / Événements / Gestion de l’onglet Planning des cinq onglets. Une seule instance par rendu.
- `apps/mobile/control/streamcockpit-planning.js` : rendu échappé, sans effet, et adaptateur navigateur ES2022 du moteur canonique. La section balisée est la transpilation TypeScript exacte de `packages/core/src/streamcockpit-planning.ts`, avec les deux imports redirigés vers `../shared/recurrence.js` et `../shared/uuid.js`. Pas de fork algorithmique : un test compare intégralement cette section à la transpilation canonique. Les modules partagés existent déjà ; pas de bundle Node ni import TS à l’exécution navigateur. Le panneau de revue wave2 reste disponible, mais n’est pas activé dans ce parcours.
- `tests/streamcockpit3-planning-integration.test.ts` : fidélité de l’adaptateur, montage via le vrai `createPlanning`, vues Android, transitions connexion/hors ligne/reconnexion, données inchangées, absence d’appel API/modal, XSS échappé, conflits, fraîcheur et DST.
- `tests/streamcockpit3-planning-integration-browser.test.ts` : scénario Chromium opt-in `PLANNING_BROWSER_TEST=1`, bundle en mémoire du vrai module Planning, montage DOM, brouillon préexistant conservé, zéro requête. Fourni mais **non validé** : lancement Chromium interdit dans cette sandbox.
- Le présent rapport. Ticket préexistant exclu.

## UX et vérité des données

Affiche jusqu’à trois créneaux de 60 minutes sur les 24 prochaines heures, grille de 30 minutes en temps écoulé, dates Europe/Paris avec fuseau. Le calcul appelle réellement `suggestPlanningSlots` et son contrôle de chevauchement/récurrences canonique. Il lit tous les événements de `getData().host.planning`, sans appliquer les filtres ou la pagination de l’affichage. Un événement importé Google reste bloquant. Les origines et les noms des liens providers sont affichés comme provenance de la copie, sans les transformer en preuve de fraîcheur.

L’avertissement permanent « Suggestion locale non publiée », Google/Twitch UNKNOWN et « Fraîcheur distante inconnue » reste affiché même après reconnexion. `observedAt` correspond uniquement à la lecture synchrone de la copie en mémoire, jamais à une acquisition Google/Twitch. L’entrée Google `disabled` est un détail du contrat moteur pour exclure toute consultation distante de ce **calcul local** : elle n’affirme pas que le compte est désactivé. Les événements importés présents restent tous dans l’entrée locale. La copie peut être périmée ou incomplète ; aucune disponibilité distante n’est affirmée. Un événement invalide, en conflit ou en suppression bloque le calcul avec explication échappée.

Pas de requête réseau, POST/PUT, stockage, réservation, nouveau minuteur, retry ou ouverture d’éditeur depuis cet assistant. La duplication assistée est visiblement désactivée : le submit existant sauvegarde directement, sans étape de confirmation distincte ni vérification atomique des conflits. Aucun brouillon n’est donc injecté, aucun formulaire écrasé, aucun doublon créé par la preview. La duplication manuelle préexistante et son éditeur restent inchangés ; ils ne constituent pas une livraison de duplication assistée sécurisée.

## Vérifications et limites de preuve

Toutes les commandes de tests ci-dessous préfixées `nice -n 15 ionice -c 3`. Vitest utilise au plus un worker simultané. Aucun full npm test, build Windows/APK ni installation.

| Commande exacte | Code et résultat |
|---|---|
| `nice -n 15 ionice -c 3 node node_modules/vitest/vitest.mjs run tests/streamcockpit3-planning*.test.ts tests/mobile-offline-planning-validation.test.ts tests/streamcockpit3-context-integration.test.ts --maxWorkers=1 --configLoader runner --no-cache` | 0, première passe 40 PASS / 5 fichiers ; passe finale 40 PASS, 1 scénario navigateur ignoré explicitement |
| `nice -n 15 ionice -c 3 node node_modules/vitest/vitest.mjs run tests/streamcockpit3-planning-integration-browser.test.ts --maxWorkers=1 --configLoader runner --no-cache` | 1, avant ajout du opt-in : Chromium SIGTRAP, `sandbox_host_linux.cc:41 ... Operation not permitted`; aucune assertion DOM exécutée |
| `nice -n 15 ionice -c 3 npm run build:types` | 0 |
| `nice -n 15 ionice -c 3 npm run security:check` | 1, IPC tsx `listen EPERM` avant analyse |
| `nice -n 15 ionice -c 3 node --import tsx scripts/security-check.ts` | 0, 662 fichiers vérifiés |
| `git diff --check` | 0 |

Logs : `/tmp/lot-o-tests.log`, `/tmp/lot-o-tests-final.log`, `/tmp/lot-o-browser.log`, `/tmp/lot-o-types.log`, `/tmp/lot-o-security.log`, `/tmp/lot-o-security-direct.log`.

La suite valide les modules Planning existants (propositions, concurrence de confirmation, annulation, stale, conflits), le parcours de rendu réel et les protections offline existantes. Le test de rendu est une preuve logicielle de composition HTML, pas une preuve tactile ou Android. Le scénario Chromium préserve un champ de formulaire externe au rendu Planning ; il ne démarre pas tout `control.js`. Aucun montage complet de la régie dans un navigateur n’a été réussi ici. Les autres onglets, Home, minuteur maître, Live→Diffusion, Sons/Deck, Plus/Santé, WizeBot/Streamlabs n’ont pas été modifiés ; leur comportement physique n’est pas requalifié par cette suite.

## À intégrer / non fait

Le moteur TypeScript ne pouvant être importé directement par le WebView, l’adaptateur local propriétaire est inclus dans le seul fichier autorisé. Pour le régénérer : `ts.transpileModule` avec `target: ES2022, module: ES2022`, remplacement des imports recurrence/uuid comme décrit, remplacement de la section BEGIN/END ; le test de fidélité donne la recette exécutable exacte. Le build global n’a pas été modifié. L’intégrateur devra maintenir cette génération et régénérer le ServiceWorker au build d’intégration : interdit dans ce lot, donc les appareils déjà installés ne reçoivent pas encore ce code.

Restent : observations distantes avec couverture/fraîcheur fiables, préflight complet, confirmation de sauvegarde et protections atomiques avant activation du brouillon assisté, scénario navigateur sur hôte compatible et essais Android/FIXE/laptop. Aucun serveur, index partagé, CSS, SW, package.json, feature-matrix ou CONTINUITY modifié. Aucun accès aux installations, RC2, WorldPrep, Director, Crafty, secrets, profils ou clés. Aucun live, OBS réel, publication, push ou deploy.

## Staging bloqué, aucun commit

`nice -n 15 ionice -c 3 git add apps/mobile/control/control.js apps/mobile/control/planning.js apps/mobile/control/streamcockpit-planning.js tests/streamcockpit3-planning-integration.test.ts tests/streamcockpit3-planning-integration-browser.test.ts docs/streamcockpit-3/LOT_O_WAVE4.md` : code **128**, `Unable to create .../.git/worktrees/StreamCockpit-3.0-Lot-O/index.lock: Read-only file system`. Aucun contournement ni commit tenté après cet échec. Les six fichiers restent disponibles dans le worktree ; l’intégrateur devra les indexer depuis un contexte autorisé. Le ticket reste exclu.
