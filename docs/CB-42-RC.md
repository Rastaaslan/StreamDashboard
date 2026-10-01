# CB-42 — validation RC, 29 septembre 2026

**BLOCKED (environnement)** : le smoke Electron/package Windows reste à exécuter sur Windows. Ne pas annoncer `READY_FOR_HUMAN_TEST` avant cette validation. Base exacte : `79b76ed509761f1bfa09dcc56cdd8bf8284fdc58`. Aucun feature, redesign, commit, push ou merge.

## Revue 2 — preuve Windows toujours manquante

Aucun changement produit supplémentaire. Nouvelle tentative locale : `npm run desktop:package-smoke` avec Xvfb en espace de noms utilisateur, affichage TCP `127.0.0.1:77` et caches locaux. Xvfb avorte (`munmap_chunk(): invalid pointer`) ; **4 échecs de lancement, aucun scénario Electron validé**. Logs : `.dependencies/rc-logs/review2-{xvfb,electron}.log`. Aucun exécuteur Windows disponible ; aucune CI distante déclenchée. `git diff --check` passe. Les suites vertes de la revue 1 ne sont pas réexécutées sans changement de code.

Archive locale à transmettre à l'exécuteur Windows : `out/CB-42-RC-review2-win32-x64.zip`, SHA-256 `77f3835e6c8b30077f714d1aa70c9929194cc89638fc19f93a0c22630c67187d`. Elle contient le package final inchangé, **pas encore validé sur Windows**. SHA-256 du `.exe` : `18a62bd523300bdad8484c73d8e70f0167ae1669b544ba7c79a9aec7a45db819` ; de `resources/app.asar` : `c2097c823956132c5970055d4e91396fb816920b66af5a660a21e1ec6f073849`.

Sur une copie Windows de ce worktree **incluant les corrections non commitées**, installer les dépendances avec `npm ci`, puis `npm run build` et `npm run desktop:icon`. Extraire l'archive dans `out` sans reconstruire le package et exécuter en PowerShell :

```powershell
Get-FileHash out/CB-42-RC-review2-win32-x64.zip -Algorithm SHA256
Get-FileHash out/StreamDashboard-win32-x64/resources/app.asar -Algorithm SHA256
$env:STREAMDASHBOARD_PACKAGED_EXE = (Resolve-Path 'out/StreamDashboard-win32-x64/StreamDashboard.exe').Path
npm run desktop:package-smoke 2>&1 | Tee-Object -FilePath CB-42-windows-smoke.log
if ($LASTEXITCODE -ne 0) { throw 'Validation Windows/Electron échouée' }
```

Cette commande doit valider les **4 scénarios** : trois scénarios Electron sur les sources corrigées et le smoke sur le package identifié. Retour attendu : log complet, code de sortie zéro et empreintes concordantes. La checklist réelle ci-dessous reste ensuite nécessaire.

## Revue 1 — corrections et relance

Les cinq scénarios de régression échouent sur le renderer de la première livraison, puis passent après correction. Un sixième couvre une nouvelle saisie égale à la valeur d'origine pendant la sauvegarde.

- Conservation centralisée dans `render()` : fermeture WS, erreur HTTP, reconnexion et réponses de sauvegarde incluses ; focus et sélection restaurés après réouverture des panneaux.
- Suivi explicite des modifications, indépendant de `defaultValue` ; nom et ID caché de catégorie conservés ensemble. Test sélection → blur → WS → HTTP retardé → soumission : `gameId=42` conservé (ancien code : `old-id`).
- Une réponse de sauvegarde n'acquitte que les valeurs soumises encore présentes ; nouvelle saisie et chat non envoyé conservés. Un accusé chat retardé n'efface plus le message suivant. Après acquittement, les champs non modifiés suivent à nouveau les données distantes.
- Aucun scénario Electron/Windows validé : les relances finales échouent au lancement sur cet hôte Linux. Le test ciblant explicitement le `.exe` Windows avec `STREAMDASHBOARD_PACKAGED_EXE` échoue aussi avant tout scénario. Ce résultat ne remplace pas un smoke sur Windows.

## Corrections reproduites

- Live : après saisie puis perte du focus, les mises à jour WS remplaçaient le brouillon de titre par le titre Twitch courant. Le test navigateur échouait avec `Draft title` attendu et `Soirée Minecraft Moddé` reçu. La correction initiale est remplacée par la protection centralisée décrite ci-dessus. Test étendu aux mises à jour répétées, au brouillon chat et à une réponse HTTP tardive sans focus.
- Packaging : `.dependencies` était copié dans le package ; un répertoire temporaire situé dans ce cache provoquait `ERR_FS_CP_EINVAL` (copie dans un sous-répertoire de soi-même). Exclusion du cache local de la distribution ; packaging ensuite réussi.
- Test auxiliaire Java : doublures de `ProviderBridge` obsolètes depuis Google natif (classes/signatures manquantes). Mise à jour des doublures, compilation de la vraie classe `GoogleAuthorizationFlow` ; aucune modification du produit Android.

## Commandes et résultats

Commandes exécutées dans le worktree, avec les adaptations locales suivantes :

```sh
export TMPDIR="$PWD/.dependencies/tmp"
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.dependencies/playwright"
export XDG_CACHE_HOME="$PWD/.dependencies/cache"
export ELECTRON_CACHE="$PWD/.dependencies/cache/electron"
export GRADLE_USER_HOME="$PWD/.dependencies/gradle"
export ANDROID_HOME="$PWD/.dependencies/android-sdk"
export ANDROID_USER_HOME="$PWD/.dependencies/android-user"
export JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=$TMPDIR"
```

| Validation | Résultat final |
| --- | --- |
| `npm ci --no-audit --no-fund` | OK |
| `npm test` | **607/607**, 87 fichiers, après corrections |
| `npm run build` | OK |
| `npm run security:check` | OK, 611 fichiers ; contrôle statique du dépôt, pas un audit de vulnérabilités npm |
| `npm run check:shipped-js` | OK, 29 fichiers |
| `node --test tests/google-desktop-e2e.node.test.mjs tests/desktop-planning-editor.node.test.mjs tests/desktop-connections.node.test.mjs tests/connections-capabilities.node.test.mjs tests/desktop-audit.node.test.mjs tests/desktop-live-matrix.node.test.mjs tests/desktop-live-drafts.node.test.mjs` | **12/12**, dont 6 tests de brouillons de la revue |
| `npx playwright test -c playwright.mobile-network.config.ts` | **10/10**, relance finale |
| `node --test tests/mobile-offline.node.test.mjs tests/thumbnails.node.test.mjs tests/node/*.test.mjs tests/cb2-local.test.mjs tests/cb3-sync-center.test.mjs` | **94/94**, aucun skip |
| `npm run desktop:package` | OK, `out/StreamDashboard-win32-x64/StreamDashboard.exe` |
| `npm run desktop:package-smoke` | **4 échecs de lancement infrastructure** : Electron Linux sans serveur X ; aucun scénario Electron validé |
| `STREAMDASHBOARD_PACKAGED_EXE="$PWD/out/StreamDashboard-win32-x64/StreamDashboard.exe" npx playwright test -c playwright.electron.config.ts tests/electron.smoke.spec.ts` | **1 échec de lancement** sur Linux ; Windows réel toujours requis |
| `npm run android:sync` puis `diff -qr apps/mobile android/app/src/main/assets/public` | OK, assets identiques |
| `node scripts/gradle-wrapper.mjs assembleDebug assemblePreview testDebugUnitTest --tests '*AuthorizationFlow*'` | **BUILD SUCCESSFUL**, Debug + Preview (à jour) |
| `node scripts/gradle-wrapper.mjs testDebugUnitTest --rerun --tests '*AuthorizationFlow*'` | **10/10 tests natifs réexécutés**, zéro erreur/skip |
| `npm run mobile:smoke` | OK : LAN, auth, pairing, redaction, scopes, ticket WS, révocation |
| `scripts/smoke.ts` | OK avec serveur local explicitement démarré sur port éphémère et `DASHBOARD_URL` ; un appel sans serveur a échoué `ECONNREFUSED` |
| `git diff --check` | OK |

Logs de cette relance : `.dependencies/rc-logs/review-*.log`. APK : `android/app/build/outputs/apk/{debug,preview}/`. Les téléchargements et caches restent locaux et ignorés par Git.

## Couverture de la matrice

- Planning : saisie, focus, sauvegarde complète, brouillons pendant télémétrie/reconnexion ; tests navigateur et suite complète verts.
- Connexions Desktop/mobile : providers et CTA, Google/Discord/Twitch/OBS/Streamlabs/WizeBot/Remote, états off/non provisionné/offline couverts.
- Google Desktop mocké : ID embarqué, Connecter, PKCE S256, callback loopback sur port de repli, token sans `client_secret`, état connected, sélection calendrier et redémarrage serveur avec stockage de tokens mocké. Erreurs explicites couvertes par la suite. Le stockage chiffré Electron et OAuth réel restent à vérifier humainement.
- Live : start/stop et confirmations, cinq modes, scène custom, micro, timer, chat, titre/catégorie, audience/modération, clips, médias, Soundboard couverts par tests navigateur/API. Brouillons titre/chat/catégorie conservés après perte du focus, WS répétés, déconnexion/reconnexion, erreur HTTP et réponses de sauvegarde tardives.
- Mobile : cinq onglets exacts, commandes HTTP sans WS, reconnexion, réponses tardives et absence de commandes fantômes couverts.
- Repli `EACCES`/`EADDRINUSE` couvert par les tests de port ; occupation réelle du port également exercée dans l'E2E Google.
- Distribution ASAR inspectée avec `@electron/asar` : Google ID exact `206682842774-lu1efnct6o2cjn3jrtgo2a33r2amontq.apps.googleusercontent.com`, seules clés publiques `googleClientId`/`twitchClientId` dans la configuration. Aucun `.env`, keystore, clé PEM ou cache embarqué ; scan de 88 fichiers applicatifs livrés sans littéral de secret OAuth/token/clé privée détecté. Renderer livré comparé octet pour octet au fichier corrigé. ASAR final SHA-256 : `c2097c823956132c5970055d4e91396fb816920b66af5a660a21e1ec6f073849`.
- `git ls-remote origin refs/heads/main refs/heads/fix/control-deck-scene-clicks` confirme respectivement `030bb188` et `3ab24c90`, déjà ancêtres du snapshot. L'ancien `deck-pointer-guard.js` est absent dans cette architecture ; le comportement pertinent est vérifié par un clic de scène interrompu entre mouse-down/up par un WS : bouton conservé, une seule commande. Le rafraîchissement OBS après commande est présent dans `command-service.ts`. Aucune divergence produit bloquante identifiée, aucune fusion.

## Blocage restant et contrôle humain (5 minutes)

Les caches `/tmp` et utilisateur en lecture seule ont été contournés localement. SDK Android téléchargé et builds réussis après relance réseau. Electron est installé, mais l'hôte est Linux sans affichage ; Xvfb local échoue aussi (sockets `/tmp` interdits, tentative TCP avortée). Cela ne démontre pas une régression produit et ne valide pas le package Windows.

Sur Windows, exécuter d'abord le smoke ciblé avec `STREAMDASHBOARD_PACKAGED_EXE` pointant sur le `.exe` livré : `npx playwright test -c playwright.electron.config.ts tests/electron.smoke.spec.ts`. Puis, avec OBS et les comptes habituels prêts :

1. **1 min** — ouvrir le package, parcourir Accueil/Live/Sons/Planning/Application ; saisir et sauvegarder un événement Planning.
2. **2 min** — connecter Google réel, choisir un calendrier, fermer/rouvrir ; vérifier connexion et calendrier conservés.
3. **2 min** — vérifier OBS connecté, cinq scènes + scène custom, micro, timer et un son ; confirmer start/stop uniquement sur la destination de test prévue. Vérifier qu'un brouillon Live reste intact pendant les changements OBS.

Si l'authentification ou la configuration dépasse ce créneau, arrêter la checklist et consigner le blocage ; ne pas déclarer la RC verte.
