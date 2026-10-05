# CB-120 — saisie dans les modales Desktop

## Cause racine

CB-104 protégeait le DOM de l’éditeur Planning preview, mais le raccourci
Alt+1…4 ne vérifiait que cette modale. Les sons, la suppression par période et
les champs contenteditable pouvaient donc déclencher une navigation pendant la
saisie. La surface Desktop legacy reconstruisait `#view` avec `innerHTML`, y
compris ses dialogues Planning et onboarding, lors des mises à jour structurelles.
Les recherches de catégories preview n’avaient pas de contrôle des réponses
inversées. Les tags comparaient seulement la valeur courante : saisir puis revenir
à la même valeur, ou commencer une composition, laissait une réponse ancienne
réécrire le champ. Une relance fournisseur fermait aussi le formulaire et perdait
son brouillon.

## Politique de brouillon

Le DOM ouvert est le brouillon explicite ; `dialog.dataset.dirty` et les révisions
monotones du helper commun suivent input/change/composition/reset/close. Aucun
remplacement de ses champs n’est autorisé par un rafraîchissement automatique.
Les états canoniques HTTP/WebSocket continuent d’être reçus ; les indicateurs et
permissions existants continuent d’être mis à jour. Les champs sont repeuplés à
l’ouverture explicite, au choix d’un template/d’une portée ou au changement
explicite d’étape de l’assistant. Save lit les champs du brouillon ; Annuler/Escape
les abandonne et une réouverture relit le canonique.

Les réponses asynchrones vérifient la révision du brouillon et sa session. La
recherche efface immédiatement l’identifiant de catégorie devenu obsolète. Les
ouvertures répétées Planning/sons/période ne réinitialisent pas le formulaire.
Les raccourcis ignorent inputs, textarea, select, contenteditable et dialogues
ouverts ; Enter/Escape pendant une composition ne soumettent/ferment pas l’éditeur.
Les relances fournisseur mettent à jour leur statut sans fermer le brouillon.

## Inventaire des surfaces actives

| Surface | Champs / comportement |
| --- | --- |
| Preview `event-dialog` | Création, édition, occurrence/série, duplication, titre, description, dates/heures, tags, catégorie, template, récurrence, destinations. DOM stable ; invalidation des recherches/tags tardifs. |
| Preview `sound-dialog` | Nom, catégorie, volume, délai, écoute, cases. DOM statique hors `#view` ; ouverture répétée protégée, sélection native tardive invalidée. |
| Partagé `openBulkDelete` | Dates début/fin, destinations, confirmation. DOM indépendant ; génération d’aperçu existante conservée ; ouverture unique. |
| Legacy `event-dialog` | Planning, dates, catégories, récurrence, destinations. Conservation du DOM pendant l’ouverture, y compris avant la première frappe. |
| Legacy `onboarding` | Profil, modules, services optionnels, apparence. Refresh conserve les champs ; Continuer/Retour reconstruisent explicitement l’étape. |
| Preview `obs-setup-dialog` | Statut et boutons seulement, aucun champ éditable. |
| Settings/auth Desktop | Formulaires intégrés aux pages Connexions/Application/Réglages, aucun dialogue HTML supplémentaire. OAuth externe, codes et sélecteur de fichier natif. Couverture existante des connexions et drafts Live conservée. |
| Electron / overlay | Aucune autre modale HTML éditable ; overlay timer en lecture seule. Sources archivées `_integration_sources` et Android hors périmètre. |

## Vérification

`desktop-modal-drafts.node.test.mjs` utilise Chromium et le serveur réel : saisie
caractère par caractère avec mutations settings/WebSocket, stabilité des nœuds,
focus/caret, onboarding, création legacy, sons création/édition/save/réouverture,
select, dates de suppression, tags edit-undo, réponses catégories inversées,
contenteditable et compositionstart/end. La composition est simulée ; aucun IME
natif Windows n’est piloté par ce test.

`desktop-planning-editor.node.test.mjs` couvre création/édition Planning, textarea,
reconnexion, ouverture concurrente, permissions live, sauvegarde en échec puis
réussie, tags, discard, duplication et réouverture canonique.
`planning-bulk-delete.node.test.mjs` couvre aperçu, invalidation, annulation,
confirmation et suppression réelle. Les tests de fragments/API tags ont été
adaptés à l’import du helper ; les courses sont vérifiées dans le vrai navigateur.

Commandes (environnement du runner : `PLAYWRIGHT_BROWSERS_PATH=/var/lib/codexbridge/.npm/playwright`,
`TMPDIR=/var/lib/codexbridge/.npm/test-tmp`) :

- `node --test tests/desktop-modal-drafts.node.test.mjs tests/desktop-planning-editor.node.test.mjs tests/planning-bulk-delete.node.test.mjs`
- `npm run test:browser`
- `npm test` (Vitest, build puis tous les tests Node/DOM)
- `npm run build`
- `git diff --check`

Résultat final : 3 tests DOM ciblés, 14 cas de relance fournisseur, 13 tests de
`test:browser`, 935 tests Vitest et 142 tests Node/DOM verts. Build et
`check:shipped-js` (32 fichiers) verts ; `git diff --check` sans erreur.

## Revue 1 — réponses de mutation retardées

La première correction ne liait pas la fin d’une sauvegarde/suppression au
brouillon envoyé. Une réponse ancienne fermait donc aussi un dialogue rouvert,
réinitialisait ses champs et effaçait sa cible d’édition. Le scénario Planning
« submit → close → ouvrir un autre événement → saisir → réponse » reproduit cette
perte sur le commit `2f26572` (dialogue attendu visible, reçu fermé).

`dialogCompletion` capture la révision et les valeurs au départ de la mutation.
Une ouverture explicite invalide les anciennes captures. La fermeture, le reset,
les événements de saisie/composition et les modifications programmatiques des
champs empêchent une réponse ancienne de terminer le brouillon courant. La
sauvegarde/suppression continue à mettre à jour les données canoniques, mais ne
ferme/réinitialise que le brouillon d’origine resté intact. Planning conserve aussi
la cible envoyée pour examiner le résultat de publication. La sélection d’un
nouveau fichier son et le rejet d’une suggestion de tag invalident les captures.

`node --test tests/desktop-modal-completions.node.test.mjs` : huit scénarios
Chromium couvrent Planning preview, Soundboard et Planning legacy. Ils retardent
les réponses de sauvegarde, ferment/rouvrent sur une autre cible ou continuent la
saisie après l’envoi, puis vérifient valeur, identité DOM, focus et caret. Deux cas
couvrent également les suppressions retardées. Une seconde sauvegarde vérifie
l’identifiant cible et le payload, puis une réouverture confirme le canonique.
Le serveur Planning est réel ; les réponses Soundboard sont simulées sans fichier
ni périphérique audio. Les huit scénarios passent avec le correctif.

Validation finale de la revue : 11 tests ciblés verts avec
`node --test --test-concurrency=1 tests/desktop-modal-completions.node.test.mjs tests/desktop-modal-drafts.node.test.mjs tests/desktop-planning-editor.node.test.mjs tests/planning-bulk-delete.node.test.mjs` ;
`npm test` : 935 Vitest + 150 Node/DOM verts ; `npm run test:browser` : 13 verts ;
build, syntaxe des 32 fichiers livrés et diff check verts. Les suites finales ont
été exécutées séparément après un échec de temporisation du test du timer serveur
lors d’une exécution simultanée avec les tests Chromium. Le nouveau test identifie
les événements par contenu, car une fermeture peut appliquer un rendu différé et
changer leurs indices dans la liste.

## Revue 2 — identité d’une création dont la saisie continue

La révision du brouillon empêchait correctement une fermeture tardive, mais elle
ne suffisait pas à suivre l’identité créée. Un formulaire de création conservé
restait sans ID et sa sauvegarde suivante effectuait un second POST.

Le helper distingue désormais une session d’ouverture de la révision de saisie.
Une création en cours appartient à sa session (une seconde soumission est ignorée
jusqu’à sa réponse, les champs restent éditables). Les réponses locales de création
Planning et Soundboard fournissent `createdItemId`, issu directement de l’objet
créé ; aucune comparaison de titres ou de listes ne devine l’identité. Lorsque la
session reste ouverte, le formulaire adopte cette cible sans repeupler ses champs.
Sa prochaine sauvegarde est un PUT. Une fermeture/réouverture ou une duplication
explicite démarre une autre session, qui ne peut pas adopter l’ancienne identité.
La révision continue de décider si une réponse peut fermer le formulaire intact.
Un changement de fichier audio modifie la révision, pas l’identité de session.

`tests/desktop-modal-creation.node.test.mjs` ajoute six tests Chromium : poursuite
de saisie et fermeture/réouverture pour Planning preview, Planning legacy et
Soundboard. Les créations et mises à jour passent par le serveur réel ; seul le
sélecteur/importeur Electron est simulé vers un fichier de bibliothèque temporaire.
Les tests vérifient le verrou contre un deuxième POST en cours, valeur/focus/caret,
le PUT vers l’ID exact, un seul objet canonique et la réouverture après sauvegarde.
Le cas rouvert vérifie au contraire un nouveau POST et deux objets distincts.

Validation revue 2 : `node --test --test-concurrency=1 tests/desktop-modal-creation.node.test.mjs tests/desktop-modal-completions.node.test.mjs tests/desktop-modal-drafts.node.test.mjs tests/desktop-planning-editor.node.test.mjs tests/planning-bulk-delete.node.test.mjs`
(17/17), `npm test` (935 Vitest + 156 Node/DOM), `npm run test:browser` (13/13),
`npm run build`, `npm run check:shipped-js` (32 fichiers) et `git diff --check` verts.
Les six régressions de création ont également été relancées avec des dates
relatives au jour du test : 6/6.
