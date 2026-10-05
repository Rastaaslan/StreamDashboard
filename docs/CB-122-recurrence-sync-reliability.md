# CB-122 — synchronisation récurrente réelle

Base auditée : `6036b7b937632dbbeb465724807f8bcb7b5ffe3c`.
Aucune modification CodexBridge, infrastructure, performance ou modal.

## Reproduction et corrections

`tests/cb122-recurrence-runtime.test.ts` lance le serveur réel, ses endpoints
`/api/v1/planning`, occurrence, retry, conflict, bulk-delete et sync. Les adapters
réels parlent à un faux HTTP Twitch/Google avec inventaire persistant entre
redémarrages, IDs, tombstones Google, ETags/412, 409 sur ID existant, échecs 503/403
et perte de réponse après CREATE. Twitch refuse les PATCH de récurrence et
horaire natif. Les tests comparent le distant, les providerLinks, le journal et
`dashboard.json` après arrêt/rechargement. Aucun compte réel n'est utilisé.

La même matrice sur les sources de base donne **12 échecs, 22 succès** ; après
correction, **34 succès**. Les sources corrigées ont été restaurées après cette
exécution comparative, sans changement de branche ni commit intermédiaire.

| Scénarios HTTP | Twitch avant → après | Google avant → après |
| --- | --- | --- |
| weekly-1, until, exception cancel/patch, daily, weekly-2, monthly ; create/edit/retry/restart/delete | 7 succès → 7 succès | 7 succès → 7 succès |
| Retrait/ajout de récurrence, déplacement date/heure, changement timezone natif, offline puis reload/retry | 4 échecs → 4 succès | RRULE natif conservé ; suites Google existantes |
| native → materialized → native répété, remote annulé/manquant, retry, fenêtre +7 jours, recurrence retirée, suppression et tiers préservé | succès → succès | succès → succès |
| Conflit pendant retrait du master, choix local/distant après restart | 2 échecs → 2 succès | 2 échecs → 2 succès |
| Pré-rolling sans ownership prouvé : pas de mutation automatique, retrait explicite ; bulk période exclut la série | succès → succès | succès → succès |
| Native supprimé distant : sync/error, restart, retry unique | succès → succès | succès → succès |
| Occurrence déplacée pendant panne, reload puis retry avec même ID | succès → succès | succès → succès |
| DELETE confirmé puis CREATE refusé ; reprise startup | échec → succès | — |
| Ancienne erreur UI de récurrence après projection réussie | échec → succès | — |
| Suppression locale refusée si retrait distant en conflit | échec → succès | — |
| Réponse CREATE de remplacement perdue, récupération par sync, restart/retry sans nouvelle mutation | échec → succès | — |

Causes racines et invariants corrigés :

- **Champs Twitch immuables** : les éditions passaient par PATCH ou l'ancien
  garde de récurrence. Une intention de remplacement conserve désormais la règle
  précédente avant I/O. Seules les identités natives détenues par l'application
  sont retirées automatiquement ; la création suivante reprend après restart.
  weekly-1 sans fin/exception reste natif, les autres règles restent matérialisées
  sur les 7 prochaines occurrences valides (CB-129). Le fuseau est envoyé au nouveau CREATE.
- **Retrait Twitch en conflit** : comparaison de l'empreinte avant DELETE,
  conflit durable, retry refusé tant que le choix n'est pas résolu. Une erreur ou
  un conflit de retrait empêche la suppression du propriétaire local. Le choix
  distant restaure aussi la règle et l'intention de publication.
- **Conversion Google avec 412** : le retrait du master est enregistré avant
  DELETE. La résolution lit l'identité et l'ETag du master précédent au lieu de
  comparer sa récurrence à la nouvelle projection. Le choix distant restaure la
  règle distante et retire le journal vide, évitant une suppression/recréation
  lors de l'édition suivante. Le choix local arme le retrait avec l'ETag courant.
- **Erreur UI périmée** : une projection Twitch réussie efface également l'ancien
  `syncError`, y compris pour les données pré-rolling.
- **CREATE de remplacement incertain** : ne pas créer un journal d'occurrences
  vide qui rendrait le master invisible à la récupération d'inventaire. La sync
  clôt les intentions uniquement quand le distant correspond au corps CREATE
  original ; ni duplication ni nouveau retrait de l'identité récupérée.

Les tests existants complètent la matrice : DST/clamp mensuel et clés stables,
Google RRULE/master/instances et exceptions distantes non représentables,
ETag/412 des occurrences, tombstones, destinations calendriers, pertes CREATE,
retraits partiels et UI desktop/mobile. Une création Twitch ambiguë sans identité
prouvée reste protégée contre une republication aveugle ; une identité legacy
sans preuve d'ownership exige toujours un retrait explicite.

## Validation initiale (5654b2a)

Commandes exécutées depuis le worktree ; `TMPDIR` et le cache navigateur utilisent
le répertoire autorisé `/var/lib/codexbridge/.npm`.

- Reproduction sur base : `TMPDIR=/var/lib/codexbridge/.npm npx vitest run tests/cb122-recurrence-runtime.test.ts` — 12 échecs attendus / 22 succès.
- Suites ciblées : `TMPDIR=/var/lib/codexbridge/.npm npx vitest run tests/cb122-recurrence-runtime.test.ts tests/twitch-projection-runtime.test.ts tests/twitch-projection.test.ts tests/cb114-integration.test.ts tests/cb114-native-withdrawal.test.ts tests/google-projection.test.ts tests/google-remote-exceptions.test.ts tests/google-cancelled-retry.test.ts tests/planning-bulk-delete.test.ts`.
  Résultat : **9 fichiers, 112 tests réussis**, dont 34 scénarios HTTP.
- Suite complète : `PLAYWRIGHT_BROWSERS_PATH=/var/lib/codexbridge/.npm/playwright npm test`.
  Résultat : **116 fichiers / 969 tests Vitest**, puis **141 tests Node/UI**, tous réussis, aucun ignoré.
- Compilation : `npm run build`.
  Résultat : TypeScript et copie runtime réussis.
- Espaces/conflits : `git diff --check`.

Résultat du diff check : aucune erreur.

Le premier `npm test` a identifié un ancien test imposant le retrait manuel : il
vérifie maintenant l'ordre DELETE puis CREATE pour une série owned. Une première
exécution Node a échoué faute de navigateur Playwright ; installation dans le
cache autorisé puis relance intégrale, sans désactivation de test.


## Revue 1 — conflit Google natif → natif

Le cas omis dans la matrice initiale est reproduit sur `5654b2a` : après une
modification distante, une édition locale weekly → daily, un changement de fuseau
ou le retrait de récurrence reçoit un 412 ; les choix local et distant échouaient
ensuite sur la comparaison avec la nouvelle règle locale, même après restart.

La lecture du provider reçoit maintenant un contexte explicite de résolution
fourni par `PlanningOrchestrator.resolveConflict`. Pour un master Google, ce
contexte autorise une règle distante différente **uniquement si elle est
représentable** et valide toujours le calendrier lié, l'ID du master, l'identité
locale gérée, l'ownership et l'ETag. Les lectures automatiques gardent leur garde
de récurrence. Aucune extension des règles Google prises en charge.

Le choix distant restitue aussi la récurrence (y compris son absence) au modèle
canonique. Le choix local conserve l'édition voulue et utilise l'ETag fraîchement
lu pour PATCH. Un nouveau 412 conserve le conflit et impose une nouvelle décision.
Ni DELETE ni CREATE n'est nécessaire pour ces modifications natives.

| Nouveaux scénarios via endpoints réels | Avant correction de revue | Après |
| --- | --- | --- |
| Fréquence weekly → daily × choix local/distant après restart | 2 échecs | 2 succès |
| Fuseau UTC → Europe/Paris × choix local/distant après restart | 2 échecs | 2 succès |
| Retrait de récurrence × choix local/distant après restart | 2 échecs | 2 succès |
| Identité, ownership, ETag, règle ou ID distant invalide × deux choix | Gardes vérifiées après correction | 10 succès, aucune mutation |
| Nouveau 412 entre lecture et PATCH de résolution | Vérifié après correction | Conflit conservé, résolution suivante avec nouvel ETag |
| Récurrence retirée à distance, choix distant | Vérifié après correction | Absence restaurée, conservée après restart/retry |

Chaque cas positif vérifie le contenu distant, l'identité stable du master, les
liens persistés, l'ETag, l'effacement du conflit et le retry après reload. Le faux
HTTP vérifie If-Match et permet une modification concurrente avant PATCH.
La matrice contient désormais **52 scénarios HTTP** (34 initiaux + 18 nouveaux).

Validation de revue :

- Rouge avant correction : `TMPDIR=/var/lib/codexbridge/.npm npx vitest run tests/cb122-recurrence-runtime.test.ts -t 'Google native recurrence conflict'` — **6 échecs / 34 exclus par filtre** sur le code `5654b2a`.
- Même commande après correction — **6 succès / 34 exclus par filtre**.
- Suites ciblées : `TMPDIR=/var/lib/codexbridge/.npm npx vitest run tests/cb122-recurrence-runtime.test.ts tests/planning-conflict.test.ts tests/android-provider-conflict-handover.test.ts tests/google-remote-exceptions.test.ts tests/google-recurrence.test.ts tests/google-projection.test.ts tests/cb114-native-withdrawal.test.ts` — **7 fichiers, 112 tests réussis**, aucun ignoré.
- `npm run build` — TypeScript et copie runtime réussis.
- `PLAYWRIGHT_BROWSERS_PATH=/var/lib/codexbridge/.npm/playwright npm test` — **116 fichiers / 987 tests Vitest**, puis **141 tests Node/UI**, tous réussis, aucun ignoré.
- `git diff --check` — aucune erreur.
