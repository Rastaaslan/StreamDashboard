# CB-119 — lancement Windows

## Diagnostic et correction

L'incident du build 6036b7b n'a pas été reproduit sur une machine Windows dans cet environnement Linux. L'audit identifie des chemins concrets compatibles avec le processus sans fenêtre :

- `boot()` attendait tout le runtime (OBS, serveur, initialisation des fournisseurs) avant de créer la fenêtre. Pendant cette attente, `second-instance` ignorait le relancement.
- La fenêtre était cachée jusqu'à `ready-to-show`, sans autre présentation. `loadURL()` n'était pas attendu et son rejet était seulement journalisé par le handler global, parfois avant qu'un logger existe.
- `window-all-closed` était ignoré pendant le démarrage ; `activate` n'avait aucun handler. Les erreurs précoces et celles de fermeture pouvaient perdre leur logger.

Le démarrage crée maintenant une fenêtre visible avec une page locale de progression, avant le runtime. La visibilité ne dépend plus de `ready-to-show` ni d'un délai arbitraire. Le boot est unique ; un second lancement ou `activate` restaure, affiche et focalise cette fenêtre, avec correction de position après retrait d'un écran. Avant `whenReady`, le prochain boot la présente systématiquement.

Les événements renderer sont installés avant toute navigation ; les rejets de chargement, crashs et erreurs de démarrage sont journalisés puis présentés dans un dialogue natif unique. Après acquittement, l'application ferme le runtime disponible et quitte avec le code 1. Les erreurs de sous-frames ne déclenchent pas cette fermeture. La fermeture pendant le démarrage n'est plus ignorée. La fermeture annule le démarrage et attend son résultat, puis la fin de `stop()` pour tout runtime acquis. L'annulation des requêtes fournisseurs et du handshake Streamlabs empêche une attente du réseau sans fin ; aucun timeout de sortie forcée n'est ajouté.

Le port reste **48132** : pas de sélection silencieuse d'un autre port, car les URL OBS, callbacks OAuth et téléphones en dépendent. Un conflit est fatal et visible. L'arrêt existant termine les WebSockets, ferme HTTP, arrête les fournisseurs et persiste l'état. Aucun processus tiers n'est tué.

Journal stable : `%APPDATA%\StreamDashboard\logs\streamdashboard.log` (chemin effectif fourni par `app.getPath('userData')`). Le logger rotatif et sa suppression des secrets sont réutilisés dès le bootstrap : PID, acquisition du verrou, demandes de présentation, création, runtime prêt, chargement, erreur et arrêt. Aucun argument de commande ni contenu de configuration n'est ajouté.

## Validation Windows à effectuer

Sur le package produit, hors session de stream :

1. Lancer puis fermer l'EXE 20 fois. Vérifier la page de démarrage puis l'accueil, et l'absence du processus après fermeture.
2. Minimiser la fenêtre, puis relancer l'EXE 20 fois : une seule fenêtre, restaurée et focalisée. Essayer aussi pendant le démarrage, depuis un autre bureau, et après déconnexion d'un moniteur.
3. Fermer pendant la page de démarrage ; relancer immédiatement et vérifier l'accueil. Contrôler `Get-NetTCPConnection -LocalPort 48132 -State Listen -ErrorAction SilentlyContinue` après fermeture.
4. Application fermée, occuper temporairement 48132 avec un serveur de test. Lancer : dialogue explicite, log `EADDRINUSE`, sortie après acquittement. Libérer le port et relancer.
5. Via un harnais Electron, forcer `webContents.forcefullyCrashRenderer()` ou un échec de navigation principale : dialogue unique, log et sortie ; une nouvelle exécution fonctionne.

Smoke automatisé PowerShell (package déjà construit) :

```powershell
$env:STREAMDASHBOARD_PACKAGED_EXE = (Resolve-Path 'out/StreamDashboard-win32-x64/StreamDashboard.exe').Path
npx playwright test -c playwright.electron.config.ts tests/electron.smoke.spec.ts
```

Ce smoke conserve les parcours existants, vérifie 20 relancements réels après minimisation (visibilité, focus, fenêtre unique), puis le redémarrage, la persistance et la fermeture de l'endpoint. Un second test réalise 20 démarrages, alternant chargement complet et fermeture dès l'apparition de la fenêtre, avec contrôle du port fermé et de la dernière ligne `Shutdown complete`. Les tests simulés du bootstrap couvrent 20 événements pendant l'attente du runtime, écran absent, `activate`, rejet serveur/port, rejet `loadURL`, crash renderer, dialogue unique, arrêt et instance secondaire perdante. Les tests existants de port valident aussi la réutilisation de 48132 et la persistance sur plusieurs redémarrages.

## Correction après revue 1

La revue a reproduit une course dans 34b81b4 : `before-quit` pouvait constater `runtime === null`, puis quitter alors que le runtime nouvellement acquis exécutait encore `stop()`. La journalisation « Shutdown complete » était alors prématurée.

`runtimePromise` possède désormais l'acquisition ; `cleanupPromise` est partagée par tous les appels de fermeture. Le boot ne lance plus un nettoyage concurrent. Une demande de fermeture annule le démarrage via `AbortController`, attend la promesse d'acquisition (ou son rejet d'annulation), puis attend `stop()` avant le log final et `app.exit`. Les demandes répétées de fermeture restent bloquées jusqu'à cette fin commune. Une erreur de nettoyage produit « Shutdown failed » et une sortie 1, jamais « Shutdown complete ».

Le signal est transmis à la recherche OBS, aux requêtes HTTP de démarrage Twitch/Google/Streamlabs/WizeBot et au handshake Streamlabs. Le serveur installe son nettoyage avant d'attendre les fournisseurs et ferme ses ressources partielles avant de rejeter une annulation. Les contrôles d'annulation empêchent de démarrer les fournisseurs suivants. Une fois le serveur prêt, les requêtes HTTP ordinaires conservent leur comportement de drainage existant.

Tests ajoutés : acquisition et arrêt différés séparément, acquisition qui se termine pendant `before-quit`, fermeture normale, échec de persistance simulé et annulation d'une acquisition qui attend le réseau. Aucun test ne permet la sortie tant que l'arrêt différé n'est pas résolu. Un test serveur réel bloque une requête Google, l'annule, vérifie le fichier persistant et réacquiert immédiatement le même port ; un autre annule un handshake Streamlabs sans avancer l'horloge.

## Résultats de la revue 1 dans le worktree Linux

- `npx vitest run tests/desktop-lifecycle.test.ts tests/server-startup-cancellation.test.ts tests/desktop-recovery.test.ts tests/port-fallback.test.ts` : **33/33**.
- `npm test` : **117 fichiers / 946 tests Vitest**, puis **141/141 tests Node** réussis. Le build TypeScript exécuté par cette suite réussit.
- `npm run security:check` : réussi ; `npm run check:shipped-js` : **31 fichiers** valides.
- `npm run desktop:package` : réussi, y compris build Windows x64 et `desktop:check-package` (ASAR).
- `npm run desktop:smoke` : **5/5, 29,4 s** sous Electron réel/Xvfb, incluant les quatre parcours existants et le stress de 20 démarrages. Le nettoyage du test Preview attend maintenant ses interceptions réseau avant de fermer le navigateur (`unrouteAll({ behavior: 'wait' })`). Sa simulation de changement OBS incrémente aussi la version de télémétrie comme une vraie mise à jour, pour empêcher un snapshot HTTP antérieur de remplacer la fixture pendant le clic. Ces deux courses du harnais ont été révélées par les exécutions graphiques ; après correction, le parcours Preview a passé trois répétitions consécutives (11,5 s).
- `npx electron-forge package --platform=linux --arch=x64` puis `STREAMDASHBOARD_PACKAGED_EXE=out/StreamDashboard-linux-x64/StreamDashboard npx playwright test -c playwright.electron.config.ts tests/electron.smoke.spec.ts` sous Xvfb : **2/2, 46,1 s**, incluant les 20 secondes instances et les 20 démarrages/fermetures. Les assertions de visibilité, focus, fenêtre unique, port fermé et journal de fermeture passent.

Les commandes utilisent `TMPDIR=/var/lib/codexbridge/.npm/cb119-tmp`, `XDG_CACHE_HOME=/var/lib/codexbridge/.npm/cb119-cache` et, pour les tests navigateur, `PLAYWRIGHT_BROWSERS_PATH=/var/lib/codexbridge/.npm/playwright`. Les chemins temporaires/cache par défaut ne sont pas inscriptibles ici. Xvfb a été extrait localement dans le cache npm, avec ses littéraux `/tmp` relocalisés vers un répertoire de travail inscriptible et une copie locale de sa configuration clavier ; il écoute uniquement pendant les tests et est arrêté par le harnais. Aucun fichier système ni composant du produit n'a été modifié pour cet affichage. Le harnais local est `/var/lib/codexbridge/.npm/cb119-xvfb/run-smoke.sh` ; sur un Linux standard, utiliser `xvfb-run -a` à sa place.

Les échecs initiaux de smoke (DISPLAY puis fichiers clavier non inscriptibles) sont résolus pour Linux. **Aucune preuve native Windows n'est disponible dans cet environnement** : la réussite du package Linux et les assertions Electron ne prouvent pas le comportement du gestionnaire de fenêtres Windows. Les vérifications Windows ci-dessus, notamment focus/minimisation natifs, conflit de port et annulation du démarrage de l'EXE Windows, restent à exécuter et à joindre avant validation complète de la demande de revue.
