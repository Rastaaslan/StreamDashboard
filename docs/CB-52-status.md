# CB-52 — READY_FOR_HUMAN_TEST

Reprise du même chantier depuis `b96237d`, conservant la lignée CB-50 et `87c4031` (secret Google sécurisé). Source de vérité : mapping canonique F01–F16/U01–U20 fourni dans le résultat du job et repris explicitement par l’utilisateur. Aucun rapport externe supplémentaire requis. Aucun job parallèle, push, publication ou merge.

Les P1 démontrés sont clos côté sources et tests automatisables. Les essais matériels/comptes ci-dessous restent **HUMAN_TEST_REQUIRED** ; ce document ne déclare ni pixels OBS ni son réel ni OAuth fournisseur réel validés.

## Mapping exhaustif

`ALREADY_FIXED_IN_BASE+TEST` désigne une correction présente dans `b96237d`, conservée et retestée. `CORRECTED+TEST` désigne une correction complétée dans cette reprise. Les chemins de tests sont relatifs à `tests/`.

| Finding | Statut | Correction et preuve exécutée |
| --- | --- | --- |
| F01 P1 | ALREADY_FIXED_IN_BASE+TEST | Bind Desktop fixe 48132 ; aucun retry aléatoire. `port-fallback.test.ts` : EADDRINUSE/EACCES, un seul bind, redémarrage et pairing. |
| F02 P1 | ALREADY_FIXED_IN_BASE+TEST | Identifiant Google public réel ; secret uniquement dans stockage sécurisé. `google-desktop-credentials.test.ts`, `google-desktop-e2e.node.test.mjs` et contrôle ASAR sans env développeur. OAuth réel : test humain. |
| F03 P1 | CORRECTED+TEST | Lecture du segment par ID puis PATCH des seuls champs modifiés ; durée chaîne ; pas de start_time passé inchangé pour titre récurrent. `cb52-twitch.test.ts`. |
| F04 P1 | ALREADY_FIXED_IN_BASE+TEST | Discovery Discord relit le DOM courant ; snapshots HTTP anciens ignorés après WS. `desktop-connections.node.test.mjs`, `desktop-audit.node.test.mjs`, `cb52-planning.node.test.mjs`. |
| F05 P1 | CORRECTED+TEST | Même PATCH minimal dans ProviderBridge Android. `node/provider-bridge-compile.test.mjs` compile le vrai Java et exécute le cas titre récurrent ancien + changement durée avec JSONObject en mémoire. Ce n’est pas un build APK. |
| F06 P1 | ALREADY_FIXED_IN_BASE+TEST | Timer : HTTP accessible, URL attendue, Browser Source présente, attachée et activée dans scène courante. `obs-websocket-runtime.test.ts` utilise serveur HTTP et protocole OBS v5 ; absente, mauvais type/port, désactivée, détachée et HTTP indisponible refusés. |
| F07 P1 | CORRECTED+TEST | Hotfixes dans les sources, build JS synchronisé ; contrôle ASAR compare renderer/helper Planning/client OBS aux fichiers sources/build. `desktop:package` inclut ce contrôle ; logs/temp exclus. |
| F08 P1 | CORRECTED+TEST | `npm test` = Vitest + découverte récursive de tous les `.test.mjs` (incluant `.node.test.mjs`) après build. Gate release = tests + navigateur + sécurité/syntaxe + smoke Electron + package/ASAR. Les workflows Windows et Android installent Chromium avec ses dépendances avant npm test et imposent test:browser avant artifacts ; la release Windows dépend de ce job Desktop. Temp hors dépôt, nettoyage garanti ; aucun `.cb52-tmp`. |
| F09 P2 | CORRECTED+TEST | Détail Twitch utile conservé après masquage tokens connus, formes encodées et champs secrets ; Android sépare le diagnostic HTTP nettoyé du message brut, y compris persistance. `cb52-twitch.test.ts`, suites confidentialité Twitch, `node/provider-diagnostics.test.mjs`, test Java. |
| F10 P2 | ALREADY_FIXED_IN_BASE+TEST | Réponses Discord mobile inversées ignorées, ancien salon invalidé. `cb52-planning.node.test.mjs`. |
| F11 P2 | ALREADY_FIXED_IN_BASE+TEST | Callback Streamlabs dérivé du runtime 48132. Suites Streamlabs/runtime et recherche des anciens ports. |
| F12 P2 | ALREADY_FIXED_IN_BASE+TEST | Desktop, Android, launchers, exemples et URLs alignés 48132. `port-fallback.test.ts`, `mobile-network-ui.spec.ts` (adresse Android livrée), tests runtime/assets et package. |
| F13 P2 | CORRECTED+TEST | Soundboard exige Media Source attachée/activée, présence active dans scène courante, volume > 0, non mute, piste routée et monitoring compatible sortie. Lecture refusée avant restart si inutilisable. Le renderer laisse le backend appliquer le nouveau volume avant cette vérification : un ancien volume nul ne bloque pas la reprise. `cb52-soundboard-recovery.node.test.mjs` exécute les handlers renderer réels contre le backend compilé : zéro → refus → volume positif → succès, puis refus inactive/mute/non routée. `obs-soundboard.test.ts`, vrai protocole mock dans `obs-websocket-runtime.test.ts`. Audibilité matérielle : test humain. |
| F14 P2 | CORRECTED+TEST | Google exige calendrier choisi writable ; Discord exige destination vérifiée ; actions Twitch suivent scopes et état. `discord-api.test.ts`, `api-v1.test.ts`, `desktop-audit.node.test.mjs`, `desktop-planning-editor.node.test.mjs`, diagnostics natifs. |
| F15 P2 | CORRECTED+TEST | HTTP_400/4xx/5xx restent des erreurs fournisseur, pas NETWORK ; texte sûr. `node/provider-diagnostics.test.mjs`, compilation Java. |
| F16 P2 | CORRECTED+TEST | Config Desktop illisible signalée sans écrasement ni contenu secret ; config publique manquante fatale en package. Discovery scènes OBS propage le refus. `port-fallback.test.ts` (config corrompue préservée), `obs-websocket-runtime.test.ts` (discovery refusée), E2E erreurs connexions. |
| U01 P1 | ALREADY_FIXED_IN_BASE+TEST | Premier volume Soundboard non nul (100 %) ; mute enregistré respecté. `cb52-planning.node.test.mjs` : absent, persisté, invalide et bornes. |
| U02 P1 | CORRECTED+TEST | Édition canonique préserve timezone/exceptions/borne exacte, y compris règle existante absente du select mobile. `cb52-planning.node.test.mjs`, `recurrence.test.ts`, round-trip réel éditeur mobile dans `mobile-network-ui.spec.ts`. |
| U03 P1 | ALREADY_FIXED_IN_BASE+TEST | Date civile locale, fin explicite multijour, overnight sans fin explicite. `cb52-planning.node.test.mjs` (minuit Europe/Paris), E2E Desktop Paris/multijour, round-trip mobile et `cb2-local.test.mjs` overnight. |
| U04 P1 | ALREADY_FIXED_IN_BASE+TEST | Suppression simple ONLINE_PC utilise l’API PC et ne modifie pas le store autonome. `cb2-local.test.mjs`. |
| U05 P1 | CORRECTED+TEST | Confirmation explicite « toute la série Twitch » ; confirmRecurring uniquement après accord pour événement récurrent, jamais automatiquement sur événement simple. `desktop-planning-editor.node.test.mjs` : annulation sans requête, acceptation avec flag, sauvegarde simple flag false ; garde backend Twitch. |
| U06 P1 | ALREADY_FIXED_IN_BASE+TEST | Scènes rapides ajoutées aux modes principaux ; changement scène synchronise mode après confirmation OBS. `desktop-live-matrix.node.test.mjs`, tests commandes/Live. |
| U07 P1 | CORRECTED+TEST | Toutes sources actives, volume individuel et micro principal conservés ; micro configuré absent identifié et désactivé. `desktop-live-matrix.node.test.mjs` : 7+ sources, ajout WS, volume et focus DOM. |
| U08 P1 | ALREADY_FIXED_IN_BASE+TEST | Agenda Desktop sans troncature à 40 ; filtres conservés. `desktop-planning-editor.node.test.mjs` : 45 événements, ouverture du 45e. |
| U09 P2 | ALREADY_FIXED_IN_BASE+TEST | Description dans patch d’occurrence mobile. `cb2-local.test.mjs` et `mobile-network-ui.spec.ts` exécutent le submit réel. |
| U10 P2 | CORRECTED+TEST | ACK chat ne vide que le texte/réponse correspondant à l’envoi initial. `mobile-network-ui.spec.ts` : réponse différée puis nouveau brouillon. |
| U11 P2 | CORRECTED+TEST | Révision et état dirty du formulaire profil : ni refresh ni réponse save ne remplacent la saisie suivante. `mobile-network-ui.spec.ts` : save différé puis refresh périodique. |
| U12 P2 | CORRECTED+TEST | Réconciliation sliders mobile par nom ; recherche Sons Desktop ne remplace que résultats. Identité DOM et focus vérifiés dans `mobile-network-ui.spec.ts` et `desktop-audit.node.test.mjs`. |
| U13 P2 | CORRECTED+TEST | Focus réduit les informations secondaires via CSS, conserve timer/actions. `mobile-network-ui.spec.ts` vérifie effet visible. Persistance : suites préférences existantes. |
| U14 P2 | CORRECTED+TEST | Sons sélectionne Sons et non Plus. Assertion d’onglet actif dans `mobile-network-ui.spec.ts`. |
| U15 P2 | CORRECTED+TEST | Timer visible et contrôlable directement dans Live (pause/reprise, +1 min), commandes avancées conservées. `mobile-network-ui.spec.ts` vérifie visibilité et commande timer.add. Pas de refonte du cockpit. |
| U16 P2 | CORRECTED+TEST | VOD/clips consultables, suppression VOD confirmée, suppression message/timeout/ban/unban via endpoints existants ; contrôles scènes/audio/médias conservés. `desktop-audit.node.test.mjs` exécute mutations confirmées ; matrice Live et suites Twitch backend. Aucun endpoint ou pouvoir nouveau. |
| U17 P2 | CORRECTED+TEST | Succès local distingué de publication partielle ; échec refresh Desktop explicitement signalé. `desktop-planning-editor.node.test.mjs` injecte provider en erreur et vérifie avertissement ; mobile conserve états/erreurs fournisseur dans agenda. |
| U18 P2 | CORRECTED+TEST | WizeBot n’annonce plus events sans pipeline ; conserve configuration/test existants. `api-v1.test.ts` vérifie absence events ; registre modules cohérent. |
| U19 P1 | CORRECTED+TEST | Ancien profil sans startMode avec Live mais sans Intro migre vers Live ; choix explicites préservés. `cb52-upgrade.test.ts` : 4 variantes, persistance et redémarrage ; aucune scène réécrite. |
| U20 P2 | CORRECTED+TEST | Panne GET Soundboard isolée, Runtime reste disponible, diagnostic local Sons. `desktop-audit.node.test.mjs` injecte HTTP 503 et vérifie Runtime PC. |

Aucun finding source différé. Les seules validations différées sont celles nécessitant matériel, comptes réels ou SDK/affichage absents. Le contrat mobile conserve 5 onglets Accueil/Live/Sons/Planning/Plus, sans palette globale/FAB, cockpit Live, Sons complet, agenda/éditeur, état connexion, Focus et thèmes clair/sombre/OLED.

## Validations de reprise

Commandes lancées dans ce worktree. `npm test` choisit lui-même un répertoire temporaire writable hors dépôt : aucune dépendance à un TMPDIR dans le repo. Pour les CLI tsx/packaging dans ce sandbox, `TMPDIR=/var/lib/codexbridge/.npm/cb52-validation` ; cache navigateur `PLAYWRIGHT_BROWSERS_PATH=$PWD/node_modules/.cache/ms-playwright`, cache Electron local ignoré. Ces variables ne sont pas des identifiants développeur.

| Commande | Résultat final |
| --- | --- |
| `npm test` | **PASS** : 643 tests Vitest (91 fichiers) + 115 tests Node ; aucun skip. Inclut build TypeScript, E2E Chromium Desktop, compilation Java et tests de politique native. |
| `npm run test:browser` | **PASS** : 13 scénarios Playwright mobile, dont WS/races, brouillons, DOM/focus et round-trip récurrence/description. |
| `npm run build` | **PASS**, également réexécuté par `npm test` et le packaging final. |
| `npm run security:check` | **PASS** : 275 fichiers. |
| `npm run check:shipped-js` | **PASS** : 30 fichiers JavaScript livrés. |
| `npm run desktop:package` | **PASS** : paquet Windows x64 et `desktop:check-package` ASAR ; variables GOOGLE_CLIENT_SECRET/GOOGLE_CLIENT_ID/TWITCH_CLIENT_ID retirées de l’environnement. |
| `npm run android:sync` | **PASS** : assets reconstruits depuis apps/mobile. |
| `npm run desktop:smoke` | **ENV_BLOCKED** : 4 scénarios ne peuvent lancer Electron, erreur « Missing X server or $DISPLAY ». Aucun PASS Electron revendiqué. |
| `npm run android:check` | **ENV_BLOCKED** après sync et syntaxe JS : SDK location not found. Lint/tests/build Gradle non validés. |
| `npm run android:build` | **ENV_BLOCKED** : SDK location not found avant compilation Release. Aucune APK réelle validée. |
| `git diff --check` | **PASS**. |

Les premiers essais révélant des attentes de tests obsolètes ou une variable de fixture incorrecte ont été corrigés, puis les suites ont été relancées intégralement. Les erreurs d’écriture des caches tsx/Android ont été contournées avec des répertoires autorisés (`ANDROID_USER_HOME` et `GRADLE_USER_HOME` sous android/.gradle, ignorés et exclus du package). Les blocages restants sont l’absence réelle de DISPLAY et du SDK. Aucun reset/revert des corrections produites après b96237d.

## HUMAN_TEST_REQUIRED

1. **Windows / port / OBS** : lancer le paquet sans env développeur. Avec 48132 occupé ou réservé, obtenir un échec explicite sans port alternatif. Libérer puis vérifier pairing/callbacks/URL timer sur 48132. Dans OBS, vérifier pixels timer et audio Soundboard réels ; désactiver/détacher la source, couper HTTP, muter audio ou retirer les pistes : obtenir un refus/diagnostic, pas un faux état prêt.
2. **Google réel** : renseigner le secret via stockage sécurisé, autoriser le compte, sélectionner un calendrier writable, créer/modifier un événement, redémarrer. Vérifier secret absent de distribution.json/renderer ; refus clair avec calendrier readonly.
3. **Twitch réel Desktop + Android** : modifier seulement le titre d’un segment récurrent, puis horaire/durée/catégorie ; vérifier résultat et erreur fournisseur utile sans token. Annuler puis confirmer la suppression de toute la série. Tester les actions VOD/modération sur contenu/compte de test.
4. **APK réelle** après SDK : `npm run android:check`, `npm run android:build`, installer puis premier son, pairing/restart, édition série avec exception/timezone, occurrence avec description, minuit Paris et overnight/multijour, suppression ONLINE_PC, 5 onglets/thèmes/Focus. Vérifier les races de saisie et rotation/reprise sur appareil.

Sur machine avec affichage : `npm run release:check`. Pour le binaire Windows produit : définir `STREAMDASHBOARD_PACKAGED_EXE`, puis `npm run desktop:package-smoke`. Aucun PASS Electron/Android réel n’est déduit du seul packaging ou des stubs Java.


## Correction après review 3

- P1 Soundboard : supprimé le refus anticipé fondé sur `ready=false`, qui reflète le volume de la lecture précédente. Les contrôles structurels renderer restent présents ; le backend applique le volume demandé puis vérifie activation, mute et routage avant tout redémarrage média. Le test renderer/backend reproduit le blocage initial et vérifie la reprise sans intervention OBS.
- P1 runner neuf : installation explicite `npx playwright install --with-deps chromium` après `npm ci` et avant `npm test` dans les workflows Windows et Android. Vérification locale avec un nouveau répertoire navigateur hors dépôt, `/var/lib/codexbridge/.npm/cb52-review-browser` : téléchargement Chromium/headless shell/FFmpeg réussi, puis `npm test` exécuté exclusivement avec ce cache nouvellement provisionné. Les bibliothèques système Linux sont déjà disponibles ici ; aucun runner GitHub neuf ni Windows distant n’a été exécuté.
- P2 gate mobile : étape obligatoire `npm run test:browser` avant packaging Windows et construction APK Android, sans `continue-on-error`. La release Windows taguée conserve `needs: desktop`, donc dépend de cette validation. Aucune exécution ni publication de workflow distant.
- Validations de cette correction : `npm test` (643 Vitest + 115 Node sans skip), `test:browser` (13), build, security:check, check:shipped-js, desktop:package/ASAR, android:sync et git diff --check. Les limites DISPLAY/SDK et les scénarios HUMAN_TEST_REQUIRED ci-dessus restent applicables.
