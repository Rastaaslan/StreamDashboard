# CB-52 — corrections vérifiées, livraison bloquée

Baseline : `87c4031`, descendant de `14256c2`, incluant le stockage sécurisé du secret Google CB-50. Aucun push, publication, déploiement ou merge. Un seul chantier, aucun agent/job parallèle.

## Référence manquante

Le rapport complet CB-51 (technique et UX) n'est pas dans le worktree. La branche locale `codexbridge/CB-51` pointe sur `14256c2` et ne contient pas de rapport CB-51 ; aucun commit trouvé avec ce numéro dans le message. Son chemin/contenu a été demandé. **Ne pas considérer ce commit comme la baseline finale validée.** Le ticket ne donne pas la correspondance individuelle des identifiants aux descriptions : inventer cette correspondance rendrait le mapping trompeur.

| Findings demandés | État du mapping |
| --- | --- |
| F01–F08 | Corrections thématiques ci-dessous ; qualification individuelle bloquée par l'absence du rapport CB-51. |
| U01–U08 | Corrections thématiques ci-dessous ; qualification individuelle bloquée par l'absence du rapport CB-51. |
| U19 | Migration non entreprise : données et règle de migration concernées non identifiées sans le rapport. |
| F09–F16, U09–U18 | Couverture partielle ci-dessous ; reste à confronter aux reproductions originales. |

## Corrections et preuves

| Sujet explicite du ticket | Correction | Validation |
| --- | --- | --- |
| Runtime 48132 | Desktop et défaut serveur fixes ; suppression du fallback ; URLs mobiles, Streamlabs, launchers et exemples alignés | `port-fallback.test.ts` : EACCES/EADDRINUSE, un seul bind, échec Desktop ; pairing et credentials après redémarrages ; tests URL existants |
| Google sécurisé | Lignée CB-50 conservée, identifiants publics réels dans le paquet ; aucun secret dans distribution.json | Suites Google, E2E OAuth simulé avec/sans secret, persistance, contrôle ASAR réel |
| Twitch PATCH | Durée chaîne et timezone envoyées ; détail fournisseur conservé pour Planning Desktop et Android, token masqué | `cb52-twitch.test.ts`, tests Twitch existants ; compilation Java et test de masquage. API Twitch Android réelle : HUMAN_TEST_REQUIRED |
| Discord Desktop | Élément serveur relu après réponse asynchrone/rerender ; un ancien snapshot HTTP ne remplace plus un état reçu par WS | E2E connexions Desktop existant, avec WS et chargement asynchrone |
| Discord mobile | Réponses de salons obsolètes ignorées, sélection précédente invalidée | Test de réponses inversées dans `cb52-planning.node.test.mjs` |
| Timer OBS | Avant Start obligatoire : source browser présente, attachée/activée dans scène courante, URL attendue, HTTP accessible, connexion OBS inchangée | Mock réel protocole WS OBS v5 et HTTP dans `obs-websocket-runtime.test.ts`, tests Start ; moteur de rendu OBS réel : HUMAN_TEST_REQUIRED |
| Soundboard mobile | Absence de préférence donne 100 %, mute explicitement enregistré conservé | Premier lancement, redémarrage logique avec valeurs stockées, valeurs invalides/bornes |
| Planning récurrence | Conservation timezone, exceptions, borne exacte et règle existante lors d'édition Desktop ; même helper mobile ; édition de série mobile utilise l'événement canonique | Tests round-trip du helper partagé, suites récurrence/persistance existantes |
| Planning dates | Date mobile locale ; overnight et dates de fin explicites sur plusieurs jours | Tests Europe/Paris à minuit, overnight, multijour ; E2E Desktop date/fin locales |
| Planning Android | Description incluse dans patch d'occurrence ; suppression ONLINE_PC passe par API PC ; référence du formulaire capturée avant await | Test de suppression PC dans `cb2-local.test.mjs`, suites Planning existantes ; description occurrence à compléter en E2E |
| Suppression Twitch récurrente | Texte explicite « toute la série » ; confirmation transmise et acceptée par l'API de suppression | Garde backend existante ; confirmation UI à compléter en E2E |
| Scènes Desktop | Modes principaux conservés avec scènes rapides ; commande directe synchronise le mode correspondant après confirmation | Matrice renderer et test service de commandes, timer inchangé |
| Audio Desktop | Suppression limite 6, ajout micro principal connu, curseurs volume ; rapprochement par nom conserve les contrôles durant télémétrie | E2E plus de 7 sources, ajout source par WS, focus curseur conservé, commande volume |
| Planning Desktop 40 | Suppression de la troncature de l'agenda ; filtres existants conservés | 45 événements accessibles dans le vrai renderer |
| Gates | `npm test` inclut tous les `.test.mjs` récursifs avec build préalable ; suites `.spec.ts` dans gates navigateur et Electron ; contrôle JS et ASAR | Exécution détaillée ci-dessous |
| Artefact | Exclusion des logs ; contrôle paquet réel : identifiants publics, port, assets et absence sources/tests | `desktop:package` puis `desktop:check-package` |

## Travail restant — non déclaré corrigé

- Confronter chaque F/U à ses reproductions et valider que les hotfixes utilisateur exacts ont été remplacés. Impossible de certifier « tous les P1 » actuellement.
- Terminer les scénarios E2E de round-trip mobile des exceptions, description d'occurrence et confirmation de portée Twitch ; vérifier les brouillons modifiés pendant les requêtes et les sélections de formulaires asynchrones.
- Qualifier/corriger les autres cas explicitement cités : Focus effectif, sélection Sons, sliders/search, feedback partiel, capacités/config/discovery/diagnostics, Soundboard readiness, restauration VOD/modération Desktop V2. Ce sont des travaux restants, **pas des validations prétendument bloquées par un fournisseur**.
- Examiner U19 avant toute migration de données. Aucun format ni migration destructrice inventé.
- Le micro principal est conservé dans le mixer lorsqu'il figure dans les inputs OBS ; traitement UX d'une source configurée mais absente à confronter au rapport.

## Exécutions

Les variables locales TMPDIR et caches Electron/Playwright/Gradle ont été dirigées vers des répertoires ignorés du worktree pour respecter le sandbox. Chromium a été installé localement. Les premiers échecs liés aux caches et les attentes obsolètes ont été corrigés avant relance.

- `npm test` : **PASS**, 632 tests Vitest et 112 tests Node, aucun skip. Comprend build TypeScript, E2E Chromium, compilation Java via stubs et tests de politique Java ; ce dernier n'est pas un build Android.
- `npm run test:browser` : **PASS**, 10 scénarios Playwright réseau/mobile.
- `npm run build` : **PASS**.
- `npm run security:check` et `npm run check:shipped-js` : **PASS** (sécurité : 285 fichiers ; syntaxe : 30 fichiers).
- `npm run desktop:package` : paquet Windows x64 construit sans variables développeur Google/Twitch ; contrôle ASAR réel **PASS**, incluant exclusion des logs et identifiants Google/Twitch publics. Aucune publication.
- `npm run desktop:smoke` : **BLOCKED_ENVIRONMENT**, 4 lancements Electron impossibles : aucun serveur X / DISPLAY ; pas de PASS fonctionnel Electron.
- `npm run android:check` : assets synchronisés et syntaxe JS vérifiée, puis **BLOCKED_ENVIRONMENT** : SDK Android absent. Lint/tests/build Gradle non validés.
- `git diff --check` : **PASS**.

## Tests humains courts — HUMAN_TEST_REQUIRED

1. Windows, paquet produit, sans env développeur : démarrer, configurer Google via stockage sécurisé, authentifier, redémarrer et vérifier calendrier/Planning. Inspecter que le secret n'est ni dans distribution.json ni réaffiché dans le renderer.
2. Occuper/réserver 48132 sur Windows : démarrage explicitement en échec, aucun port alternatif. Libérer le port, redémarrer, vérifier pairing mobile, callback Google/Streamlabs et URL timer sur 48132.
3. OBS réel : timer Browser Source sur `http://127.0.0.1:48132/overlay/timer/`, attaché et activé ; Start obligatoire autorisé. Désactiver/détacher la source, changer son port ou arrêter HTTP : Start refusé. Vérifier le rendu visible, pas seulement le refresh.
4. Twitch réel Desktop et Android : modifier un segment récurrent, vérifier titre/horaire/durée et détail d'une erreur fournisseur ; annuler puis confirmer la suppression de toute la série.
5. Après disponibilité SDK : `npm run android:check` et `npm run android:build`, puis appareil : premier son audible, date locale autour de minuit, occurrence et série avec exceptions, édition overnight/multijour, suppression ONLINE_PC, contrat des 5 onglets/thèmes/Focus.

Pour exécuter les nouvelles gates hors sandbox : `npm ci`, `npx playwright install chromium`, `npm test`, puis `npm run release:check` sur une machine permettant Electron. Le paquet Windows doit être exécuté sur Windows via `STREAMDASHBOARD_PACKAGED_EXE` et `npm run desktop:package-smoke`.
