# CB-125 — intégration comparative 119–123

Base exacte : `6036b7b`. Les différences cumulées des candidats ont été examinées et appliquées avec résolution des chevauchements, sans cherry-pick ni merge. Aucun changement CodexBridge, workflow ou infrastructure.

## Matrice des candidats

| Ticket / candidat | Intégration et arbitrage | Preuves croisées |
| --- | --- | --- |
| CB-119 `c887c3841a96a6779e6eaac4bc7ebe2efe0dcb3a` | Fenêtre visible avant acquisition du runtime, restore/focus et récupération d’écran, single-instance, diagnostics, annulation OBS et arrêt possédé par une promesse commune. Son attente réseau finale est remplacée par le démarrage différé CB-121. | `desktop-lifecycle`, `desktop-recovery`, `server-startup-cancellation`, smoke Electron et package Linux. |
| CB-120 `e4607450e105e601f071332696d18728807ed616` | Brouillons DOM, révisions/sessions, clavier/IME, garde des réponses tardives ; identité créée conservée pour le PUT suivant. Les retries/conflits Preview gardent le dialogue ouvert et actualisent son statut sans effacer la saisie. | Tests Node `desktop-modal-drafts`, `desktop-modal-completions`, `desktop-modal-creation`, `provider-retry-real-flow`. |
| CB-121 `ae0b2542ecc500b407e49340abe30cd4b64d86a3` | Initialisation partagée Twitch, attente par `session.prepare` et actions fournisseur seulement ; maintenance différée, coalescence, inventaires par passe, trois workers, retries bornés et diagnostics locaux. | `provider-sync-startup`, `provider-sync-performance` ; HTTP/UI accessible avec Twitch et Google bloqués, préparation en attente puis PATCH unique. |
| CB-122 `037c87034dee3887b6300936055ff4fe5f4620e0` | Transitions Twitch durables et récupération du CREATE incertain ; résolution native Google fréquence/fuseau/retrait avec identité et ETag frais. Rolling de la base conservé. | 52 scénarios `cb122-recurrence-runtime`, suites CB-114, projection, conflit et performance. |
| CB-123 `ff0f59df1a5684cd7b994c16c4b7d8e46f5b1233` | Seulement les deux commits Live/tags depuis leur parent : édition sans catégorie obligatoire, warning/retry, suggestions par contexte conservées pendant refresh/requête. Aucun remplacement de fichiers par la vieille branche, qui aurait supprimé rolling et qualité tags. | `live-metadata-tags`, `desktop-live-drafts`, fixtures Minecraft/DeadIsland dans `tag-intelligence` et `tags-integration`. |

Les documents 119–122 importés décrivent leurs validations historiques ; les résultats de cette intégration sont ceux ci-dessous.

## Corrections propres à l’intégration

- La garde rapide de projection CB-121 doit laisser passer `nativeReplacementRequested` **et** `nativeRetained`. Sinon le remplacement Twitch est ignoré ou un retry Google réécrit la version distante explicitement conservée. La suite CB-114 a reproduit ce dernier problème avant correction.
- Le serveur retourne avant le réseau ; `providersReady` expose séparément la fin de maintenance. Le runtime possède un signal d’arrêt qui annule aussi Streamlabs/WizeBot. La récupération du socket token Streamlabs via OAuth est différée, testée avec requête bloquée et arrêt sans perte du secret.
- Le signal desktop annule l’acquisition locale ; si le serveur a déjà été acquis, le desktop attend `stop()`. Aucun second bootstrap fournisseur bloquant n’est conservé depuis CB-119.
- Les tests de restart CB-122 attendent explicitement `providersReady`. Leur faux HTTP offline utilise `Retry-After: 0` ; les délais réels de retry restent vérifiés séparément par les tests de performance. Le test tags utilise le répertoire temporaire système. Le faux DOM pré-live expose maintenant les champs du formulaire Live.

## Validation locale

Environnement Linux, Node 24.21.0. Préfixes utilisés lorsque nécessaires :

```sh
export TMPDIR=/var/lib/codexbridge/.npm
export PLAYWRIGHT_BROWSERS_PATH=/var/lib/codexbridge/.npm/playwright
```

| Commande | Résultat |
| --- | --- |
| `npm ci --cache /var/lib/codexbridge/.npm` | Réussi ; 0 vulnérabilité. |
| `npx vitest run tests/cb114-review.test.ts tests/cb122-recurrence-runtime.test.ts tests/provider-sync-performance.test.ts` | 3 fichiers, 87 tests réussis après correction de la garde. |
| `node --test tests/node/prelive-integration.test.mjs` | 20/20 réussis après adaptation du faux DOM. |
| `npm test` | 121 fichiers / 1 019 tests Vitest, puis 160 tests Node/Chromium réussis, aucun ignoré. |
| `npm run test:browser` | 13/13 réussis. |
| `npm run mobile:smoke` | Réussi : LAN, appairage, scopes, état filtré, ticket WS et révocation. |
| `npm run build` | Réussi, y compris lors des suites Node et du packaging. |
| `npm run security:check` | Réussi, 291 fichiers. Premier essai sans TMPDIR refusé par le répertoire temporaire du runner ; relance avec TMPDIR réussie. |
| `npm run check:shipped-js` | 32 fichiers valides. |
| `npm audit` et `npm audit --omit=dev` | 0 vulnérabilité chacun. |
| `npm run smoke` | Réussi contre un serveur local éphémère, `DASHBOARD_URL` pointant vers son port ; arrêt et nettoyage attendus. |
| `npm run desktop:smoke` sous Xvfb | 5/5 réussis, 35,8 s, dont 20 démarrages/fermetures. |
| `npm run desktop:package` | Package Windows x64 et contrôle ASAR réussis après corrections. |
| `npx electron-forge package --platform=linux --arch=x64` | Réussi. |
| `STREAMDASHBOARD_PACKAGED_EXE=out/StreamDashboard-linux-x64/StreamDashboard npx playwright test -c playwright.electron.config.ts tests/electron.smoke.spec.ts` sous Xvfb | 2/2 réussis, 36,9 s : 20 secondes instances réelles avec restore/focus, 20 démarrages/fermetures. |
| `git diff --check HEAD` | Réussi ; vérification répétée avant commit. |

Les premières exécutions ont servi à détecter les conflits ci-dessus : elles ne sont pas présentées comme vertes. Aucun test ignoré n’est accepté dans la suite finale complète.

Le harnais Xvfb déjà disponible dans le cache npm a été adapté uniquement pour lancer les commandes dans CB-125 (`/var/lib/codexbridge/.npm/cb125-xvfb.sh`). Sur Linux standard, utiliser `xvfb-run -a`. Les logs de cette session sont dans `/var/lib/codexbridge/.npm/cb125-*.log` ; ce ne sont pas des artefacts livrés.

## Risques et validation Windows requise

La CI native Windows existante `.github/workflows/windows.yml` doit être verte avant acceptation Windows : `npm run desktop:package`, puis `STREAMDASHBOARD_PACKAGED_EXE` vers l’EXE Windows et `npm run desktop:package-smoke`. Elle exerce notamment 20 secondes instances avec minimisation/restore/focus et 20 démarrages/fermetures. Les vérifications manuelles complémentaires de CB-119 (écran retiré, port occupé, crash renderer) restent décrites dans son document.

Le package Windows construit sous Linux ne prouve pas le comportement natif du gestionnaire de fenêtres Windows. Aucun compte Twitch/Google réel n’a été utilisé ; leurs réponses HTTP, ETag, pannes et latences sont simulées par les tests. Les mesures de performance ne sont pas des mesures réseau de production. Aucun push, publication, déploiement ou merge n’a été effectué.
