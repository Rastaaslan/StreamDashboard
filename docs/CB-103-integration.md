# CB-103 — intégration comparative finale

Base : `c70c5ee`. Un seul commit local d’intégration, sans push, merge distant,
changement CodexBridge ou infrastructure. Le SHA final est celui du commit contenant
ce rapport (`git rev-parse HEAD`) et figure dans le résultat remis au ticket.

## Sources et méthode

Les diffs complets, tests et corrections de review présents dans les worktrees ont
été examinés. CB-97 : `90d66a5` (dont les régressions de review, après `caa8076`).
CB-98 : `e46da5b`. CB-99/100/101/102 : modifications locales sur `c70c5ee`, y compris
leurs fichiers non suivis. Ils n’ont pas été modifiés. Les anciens journaux CB-97
consultables dans le cache npm confirment tests/browser/package et le résiduel
Electron ; les validations ci-dessous ont été réexécutées dans CB-103. Aucun rapport
externe de review des jobs spécialisés n’était fourni : la comparaison porte sur
leurs sources, tests, documentation locale et notre revue d’intégration.

## Matrice de sélection

| Domaine | Comparaison | Implémentation retenue et raison |
| --- | --- | --- |
| Twitch | CB-97 vs CB-98 | **CB-98 + gardes CB-97**. CB-98 conserve ownership externe, empreintes à la création/récupération/import, weekly-1 et séries importées, retrait durable sans ID, `deletedRemotely` jusqu’au retry explicite, suppression/réconciliation et interdiction de PATCH `start_time` récurrent. CB-97 ajoute refus des exceptions, UNTIL et occurrences virtuelles, validation avant mutations globales et transfert compagnon avec empreinte. Métadonnées de chaîne CB-101 pour les tags, sans toucher aux payloads Schedule. |
| Google | CB-97 vs CB-99 | **CB-99 + récupération hors fenêtre CB-97**. Inventaire paginé non filtré des exceptions, y compris annulations sans dates/propriétés privées ; garde ciblée à l’identité lors du retry pour ne pas bloquer une création indépendante. Identité maître, ETag/If-Match, conflits et refus des récurrences divergentes. Mapping RRULE daily/weekly-1/weekly-2/monthly, fuseau et UNTIL, fin de mois et garde all-day non représentable. Les événements simples/all-day simples gardent leurs payloads. Les maîtres locaux hors fenêtre sont relus, avec isolation du calendrier. Le rejet direct d’une instance vient de la review CB-97. Mapping unique et inverse validé par réencodage, sans parseur concurrent. |
| Moteur tags | CB-97 vs CB-100 | **CB-100**. Plus riche : contexte, langue explicite, signaux Twitch optionnels déjà disponibles, règles FR/EN par mots entiers, priorité déterministe, Unicode, normalisation/déduplication et max 10. Rejette les tags trop longs au lieu de les tronquer. Fallback `Live`. Aucun réseau, IA, clé ou dépendance. Le petit moteur partagé CB-97 n’est pas ajouté. |
| UI / preflight tags | CB-97 vs CB-101 | **CB-101 branché réellement sur CB-100**, via `localTagEngine` par défaut dans le serveur. Voir/ajuster/régénérer, langue/automatisation, source/date, persistance/redémarrage/duplication, rejet des réponses tardives, preflight titre+catégorie+tags et retry sans tags non bloquant. Les avertissements sont visibles dans les deux vues desktop. Déduplication manuelle renforcée (casse/accents/composition Unicode), journal compagnon et projection distante adaptés aux champs uniques `tags`/`tagPreferences` (apport transversal CB-97). |
| Planning | c70c5ee / CB-97 vs CB-102 | **Code fonctionnel c70c5ee + tests CB-102**. Vérification du dégradé sur toute la hauteur dynamique, cartes multiples non coupées, today/this-week/next-week, daily et copies indépendantes. Pas de refonte du renderer. Ancien test « tous providers refusent weekly » adapté aux exceptions réellement non représentables ; daily compagnon accepté. |

## Résolution des interfaces

Un seul modèle de tags (`TagMetadata` + `TagPreferences`) et un seul moteur de
sélection. L’adaptateur conserve timeout/fallback testables mais le serveur n’exige
aucune injection pour fonctionner. Les tags manuels gardent leur graphie Unicode ;
les suggestions du moteur suivent sa normalisation NFKD. Les exceptions et le
journal compagnon normalisent les mêmes champs. Le preflight reste indépendant de
la synchronisation des événements Google et Twitch Schedule.

Les contraintes Twitch sont centralisées dans `integrations/twitch/src/recurrence.ts` ;
le mapping Google reste dans `integrations/google-calendar/src/recurrence.ts`.
Les trois points d’entrée (orchestrateur, client, compagnon) partagent ces gardes.
Les tests CB-97 retenus couvrent notamment l’atomicité du sync global, les empreintes
après import et les maîtres Google anciens. Les tests CB-103 couvrent le vrai chemin
HTTP moteur/preflight, la langue, les gardes et les métadonnées compagnon daily.

## Validation

Environnement : Node 24.21.0, npm 11.19.0, Linux sans DISPLAY. `npm ci` effectué.
Les commandes nécessitant un répertoire temporaire utilisent
`TMPDIR=/var/lib/codexbridge/.npm/cb103-tmp` ; Playwright utilise
`PLAYWRIGHT_BROWSERS_PATH=/var/lib/codexbridge/.npm/playwright`. Le runner `npm test`
choisit lui-même son scratch externe au dépôt. Les caches existants ne changent
aucune infrastructure. Les logs d’exécution sont locaux et ignorés par Git.

| Commande | Résultat final |
| --- | --- |
| `npx vitest run tests/cb103-integration.test.ts tests/cb97*test.ts tests/cb98-twitch-sync.test.ts tests/cb52-twitch.test.ts tests/google*test.ts tests/twitch-tags.test.ts tests/tags-integration.test.ts tests/planning-export-layout.test.ts tests/recurrence.test.ts tests/companion-multidevice.test.ts tests/next-foundation.test.ts tests/android-provider-conflict-handover.test.ts` | 21 fichiers, 223 tests verts |
| `npm test` | 101 fichiers Vitest / 781 tests et 123 tests Node, incluant le navigateur desktop |
| `npm run test:browser` | 13 tests verts |
| `npm run mobile:smoke` | Vert : LAN, auth, pairing, scopes, WS, révocation |
| `npm run build` | Vert (également exécuté par test:node et packaging) |
| `npm run security:check` | Vert |
| `npm run check:shipped-js` | 30 fichiers verts |
| `npm audit` ; `npm audit --omit=dev` | 0 vulnérabilité chacun |
| `npm run smoke` avec serveur compilé temporaire et `DASHBOARD_URL` | Vert : santé, état et capacités API v1 |
| `npm run desktop:package` | Windows x64 + contrôle ASAR verts |
| `npm run desktop:smoke`, puis `npx playwright test -c playwright.electron.config.ts` après installation du binaire Electron local | 4 lancements bloqués par `Missing X server or $DISPLAY`, aucun test Electron déclaré vert |
| `git diff --check` | Vert |

Les premiers essais ont révélé des mocks Google devenus obsolètes (inventaire
complet), un ancien refus global des récurrences, un typage de mock OBS et l’omission
des tags à la création du journal compagnon. Ils ont été corrigés. Les erreurs de
cache temporaire/Chromium/Electron des premières commandes ont été résolues par les
chemins locaux autorisés, sans changement de configuration système.

## Risques et test humain

Le seul contrôle résiduel est le smoke Electron graphique, à exécuter dans la CI
Windows sur le package. `desktop:package-smoke` utilise la même suite ; le binaire
Windows produit ne peut pas être exécuté nativement dans ce runner Linux.
Les mutations réelles Twitch/Google sont simulées dans les tests ; vérifier avec un
compte de test la publication, le conflit, le retrait et le retry explicite. Les
exceptions de séries non représentables restent volontairement refusées, sans
aplatir ni perdre les événements locaux. L’inventaire Google complet ajoute des
lectures pour protéger les exceptions. La pertinence des tags reste heuristique et
ajustable par l’utilisateur.

Résultat : **READY_FOR_HUMAN_TEST**, sous réserve du seul smoke Electron autorisé
comme résiduel par le ticket.


## Review 1 — récupération des maîtres Google (P1)

Le scénario signalé est corrigé : le client fournit un maître avec ses RRULE brutes,
mais l’import serveur omettait sa récurrence. Une édition du titre envoyait alors
`recurrence: []`. Le serveur reconstruit désormais la récurrence avant l’import et
la conserve dans la ligne persistée. Toutes les règles récupérées sont validées
avant de modifier le planning : un refus ne laisse aucune série aplatie éditable.

L’inverse du mapping se trouve dans le même module que `googleRecurrence`. Il
vérifie le réencodage complet, le fuseau, UNTIL et tous les champs RRULE ; il refuse
les clauses inconnues/dupliquées, COUNT, les sélections BYDAY non représentables,
les fins invalides et les règles mensuelles Google qui sautent les mois courts.
L’ordre des clauses et INTERVAL=1 implicite sont acceptés et comparés sous forme
canonique. Les règles inconnues restent un refus d’import explicite ; elles ne sont
jamais converties en événement simple. Les événements simples gardent leur chemin.

`tests/google-master-recovery.test.ts` ajoute 15 régressions HTTP : planning vide,
instances Google regroupées vers le maître, import, redémarrage, édition du seul
titre, ETag/identité stable, resynchronisation sans doublon, timezone et occurrences
futures (dont DST et fin de mois), daily/weekly/all-day UTC. Les règles non prises
en charge sont refusées avant et après redémarrage ; aucune mutation distante ne
part même lors d’une tentative d’édition. Les validations de la table ci-dessus
ont été relancées après correction (journaux locaux `review-*.log`). Le commit
local unique est amendé pour inclure cette correction ; l’ancien SHA c75a2e9 est
remplacé par le SHA final indiqué dans le résultat du ticket.
