# CB-129 — les sept prochaines occurrences

Base exacte : `9b4be7c08ccb312f7b8e0dd8fa913aa7ce26a728`.

La publication matérialisée Twitch/Google maintient les sept prochaines occurrences
valides, ou moins si `until` termine la série. Les stratégies exactes Twitch
weekly-1 et Google RRULE restent natives. Une série quotidienne publie normalement
sept événements, une bihebdomadaire couvre environ quatorze semaines et une
mensuelle environ sept mois. Aucun timeout n’est augmenté.

## Contrat du moteur

`projectRecurrence(master, { windowStart, nextCount: 7 })` et
`expandRecurringItems(items, { from, nextCount: 7 })` utilisent le même moteur
partagé navigateur/serveur. Les fenêtres explicites `windowEnd`/`to` restent
utilisables pour les calendriers et exports ; elles ne définissent plus le rolling.
Le compte s’applique par série. Une occurrence en cours reste incluse jusqu’à sa
fin, comme auparavant. Le tri porte sur les dates effectives, avec la clé stable
comme départage. Les exceptions sont examinées avant la sélection, y compris les
ancres anciennes ou lointaines déplacées dans les sept premières places.
`until` reste inclusif sur l’ancre originale. Annulation et préférence provider
retirent une occurrence de la sélection et la suivante complète le compte.

Les dates civiles et la résolution DST restent partagées avec l’expansion par
période. La recherche indexée évite de rescanner l’historique d’une vieille série.
Le scan s’arrête dès que les futures ancres ne peuvent plus précéder la septième
occurrence effective. Il est plafonné à 100 000 candidats ; dépassement, cadence,
fuseau ou date invalides produisent une erreur explicite, jamais une projection
partielle présentée comme réussie. `nextCount` accepte les entiers de 1 à 10 000.
Le point d’injection `OccurrenceSource.expand` reçoit le compte et le prédicat
`accept` : un futur moteur custom doit respecter ce contrat. Les moteurs custom
inconnus continuent à produire une erreur explicite.

## Migration et reprise

Aucune réécriture globale du stockage n’est nécessaire. Au prochain passage
concernant une série matérialisée, `projectionWindow` devient `{ from, nextCount: 7 }`.
Les anciens journaux `{ from, to }` restent lisibles. Les clés et identités des sept
occurrences retenues sont conservées. Les entrées excédentaires, passées ou
annulées sont retirées seulement si `managedBy === 'StreamDashboard'` ; les remotes
sans entrée gérée et les entrées d’un autre gestionnaire restent intacts.

Le nettoyage utilise le chemin durable existant : intent/identité incertaine,
préconditions Google, conflits et DELETE en échec restent dans le journal pour
reprise ; un 404/410 confirme le retrait. Les tombstones Google conservent la
protection contre une recréation ambiguë. Une erreur de projection survient avant
le nettoyage, évitant de traiter un résultat incomplet comme un retrait massif.
Après succès, un nouveau passage ne recrée ni ne réécrit les occurrences inchangées.
Des échecs distants peuvent donc temporairement laisser plus de sept remotes,
visibles en erreur, jusqu’à la réussite du nettoyage.

Le coalescing CB-126, le retry ciblé prioritaire, la maintenance horaire après
startup et la portée des éditions/bulk delete sont conservés. Aucun scan global
n’est ajouté à une édition de série. La fenêtre desktop ne dépend pas de la fin
de maintenance. Les interfaces mobile/desktop décrivent désormais les prochaines
occurrences plutôt qu’un horizon daté.

## Mesure et validation

Le test `cb129-next-occurrences` compare un premier passage quotidien avec
l’ancienne expansion 28 jours injectée dans le même reconciler coalescé, puis le
nouveau mode : **28 → 7 CREATE**, **21 → 7 checkpoints** (−75 % et −67 %).
Le test CB-122 de cycle HTTP quotidien mesure 35 checkpoints après changement,
contre les 181 rapportés pour les cinq passes CB-126. Son budget inclut désormais
explicitement les résumés fixes du cycle, en plus du coût par occurrence.

Les tests couvrent les dates daily/biweekly/monthly, fin de série, exceptions
annulées/déplacées, préférences de publication, DST, recherche historique,
identités au restart, migration owned/unowned et roulement d’un jour (un DELETE,
un CREATE). Les suites existantes couvrent retry ciblé, conflits, bulk delete,
coalescing, startup non bloquant et stratégies natives.

Validation exécutée sous Linux/Chromium, avec les répertoires temporaires et le
navigateur dans les chemins autorisés :

- `TMPDIR="$PWD/node_modules/.cb129-tmp" npx vitest run tests/cb129-next-occurrences.test.ts tests/recurrence-projection.test.ts tests/twitch-projection*.test.ts tests/google-projection.test.ts tests/cb114*.test.ts tests/cb122*.test.ts tests/provider-sync-performance.test.ts` : 177 tests réussis.
- `PLAYWRIGHT_BROWSERS_PATH="$PWD/node_modules/.cb129-browsers" npm_config_cache=/var/lib/codexbridge/.npm npm test` : deux passages complets réussis, chacun avec 1 032 tests Vitest (122 fichiers) et 164 tests Node, aucun échec ni skip.
- `PLAYWRIGHT_BROWSERS_PATH="$PWD/node_modules/.cb129-browsers" TMPDIR="$PWD/node_modules/.cb129-tmp" npm run test:browser -- --repeat-each=3` : 45 tests réussis, dont les régressions CB-127 et le round-trip de série CB-52.
- `npm run build`, `npm run check:shipped-js`, `git diff --check` : réussis.

Les premiers lancements ont rencontré le répertoire `/tmp` inaccessible, puis les
anciennes attentes de quantités et une fixture TypeScript incomplète. Ces problèmes
ont été corrigés avant les passages verts ci-dessus, sans changement de timeout.
