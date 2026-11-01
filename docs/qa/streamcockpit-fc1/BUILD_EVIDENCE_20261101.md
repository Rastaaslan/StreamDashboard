# Le StreamCockpit FC1 — preuves de compilation et limites au 01/11/2026

## Révision et livraison interne non qualifiée
- Source commune **`0bd8ee4`**, branche `streamcockpit/fc1-integration-active-20261101`, version **2.1.0-rc.2**.
- Windows x64 : `out/StreamDashboard-win32-x64/StreamDashboard.exe`, SHA256 **`53a770b9f985f0b86e3c76abd50455df194d0dd6450b9098ccf5e11355b7933c`**.
- Windows `resources/app.asar`, SHA256 **`8005d15c0a7c4e2750219ee6285da7cc1974acc88f1fccbaddc6e03deb917252`**.
- Android APK **de laboratoire uniquement** : `android/app/build/outputs/apk/debug/app-debug.apk`, SHA256 **`4b74e6449c069ee694d1fa4a75d41cf56abdc6696ad46c2858803d1035d19eba`**, package `com.rastaaslan.streamdashboard.remote.next`, versionCode **2010092**, target SDK **35**, min **26**.
- Signature de cette APK : **Android Debug**, certificat `C=US, O=Android, CN=Android Debug` (SHA256 `c09e61d51adcc0e06398e5f23bc4a88aa3afb68493dea1564f0b248fcb3403b0`), **NON UTILISABLE comme signature de production**. Ne pas distribuer comme candidate finale.
- Validation croisée **8/8 fichiers identiques SHA256** : `control/index.html`, `control/control.js`, `control/mobile-five-tab-ui.js`, `control/streamcockpit-mobile-v2.css`, `control/mobile-panes.js`, `control/floating-mic-battery.js`, `control/mobile-ergonomics.css`, `control-sw.js`; comparaison source ↔ `app.asar` ↔ `assets/public/` APK. Version desktop embarquée = source.

## Tests réalisés sur cette source
- TypeScript, browser-types, sécurité (1016 fichiers), build public, JS distribué (119 fichiers) : **PASS**.
- Vitest : **1572 PASS, 2 skipped** ; Node : **355 PASS, 0 échec**.
- Playwright mobile UX cinq onglets et minuteur : **28 PASS**.
- Playwright transport mobile/réseau/reconnexion simulée : **35 PASS**.
- Android : `lintDebug testDebugUnitTest assembleDebug` **BUILD SUCCESSFUL**, 48 tâches Gradle.
- Electron Windows : `desktop:package:built` et `desktop:check-package` **PASS**, après correction d'environnement non intrusive décrite ci-dessous.
- Captures Chromium vérifiées à 320 px : `fc1-320-home-20261101.png` et `fc1-320-plus-20261101.png`.
- Journaux détaillés de cette passe : `/tmp/streamcockpit-fc1-full-0919.log`, `/tmp/streamcockpit-fc1-ux-0918.log`, `/tmp/streamcockpit-fc1-build-0923.log`, `/tmp/streamcockpit-fc1-desktop-retry-0925.log`.

## Anomalie de packaging résolue sans toucher aux autres projets
Le premier packaging Windows a échoué `EPERM: rmdir '/tmp/electron-packager'`. Audit : `/tmp/electron-packager` était un dossier **vide appartenant à codexbridge**, datant du 08/10; le compte `damien` ne pouvait pas le supprimer (sticky bit de `/tmp`). **Ce dossier n'a pas été supprimé ni modifié.** Nouvelle exécution avec un `TMPDIR` propre, créé sous `/tmp/streamcockpit-fc1-package.*` et appartenant à `damien` : Windows packaging **PASS**. L'avertissement SDK Android en lecture seule `package.xml` est non bloquant.

## Ce qui reste à prouver — gates strictement fermées
- **Pas de téléphone Android visible par ADB** sur FIXE; ADB non disponible dans le PATH de dam-server. Aucun essai sur téléphone réel, rotation, réassociation, réseau coupé/repris n'a été effectué.
- Aucune **clé de signature Android release existante** n'a été fournie au build. Pas de signature release et pas de test d'installation par-dessus l'APK de l'utilisateur. Interdiction de substituer une nouvelle clé.
- FIXE OBS actif et connecté, pas de live actif au contrôle, mais **pas de validation sur FIXE du writer Agent V2 nouvellement compilé** et pas de pilotage de scène réel. Aucune commande publique Twitch/OBS n'a été envoyée.
- Laptop RC2 en `--role=client` présent, mais **égalité réelle des minuteurs et authority unique sur FIXE/laptop/Android non qualifiée** avec ces binaires.
- Retour arrière matériel et migration préservant les données **non testés**.
- `node scripts/check-universal-release.mjs --final` **FAIL ENOENT** pour `docs/qa/next21-qualification.json`; la liste de modules contient encore YouTube (héritage Next 2.1, non conforme au périmètre Twitch-only). Il faut une matrice réelle, pas un fichier aux PASS inventés.

**Statut : sources et deux binaires de test cohérents; aucune RC finale autorisée.** Les sauvegardes et installations de l'utilisateur ont été préservées.
