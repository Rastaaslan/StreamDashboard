# G4 — Android QA non distribuable, même source que Windows (03/11/2026)

**Nature : preuve préparatoire de compilation ; PAS une candidate G4/G5, PAS une APK de production.** Travail uniquement sur FIXE Windows 11 via Remote Desktop Commander, sous `.build/sc3-android-toolchain` (SDK/Gradle isolés des installations utilisateur).

## Paire de construction effectivement obtenue
- Commit source commun : `b8a96697454d98bcb18d4b4adacb597930a9f741` ; version `3.0.0-alpha.1` ; empreinte de l'arbre source embarquée dans l'APK **et** le manifeste Windows : `233906d55fdf9eb50ee1ec40d33f825b1ce8c082a20e2b1c1cd420fc86679c90`, source non modifiée au moment de la compilation.
- Windows x64 préparatoire : `out/sc3-final-delivery/b8a96697454d/` ; EXE, Setup, nupkg et portable, 48 fichiers vérifiés par le lot précédent, Authenticode `NotSigned`.
- Android **debug QA** : `out/sc3-android-qa/b8a96697454d/Le-StreamCockpit-3.0.0-alpha.1-android-debug-qa.apk`. SHA-256 : `113729546149ef4e4f4e7c2a00ed8dd56f9feb5405bba67a91e9870cdff64e03`. Taille : 3 783 015 octets.
- `aapt` : `com.rastaaslan.streamdashboard.remote.next`, versionCode `3000001`, minSdk `26`, targetSdk `35`. `apksigner verify` : **PASS**, signature v2 valide, **certificat Android Debug** (pas la clé de production, incompatible mise à jour d'une installation signée différemment). Aucune génération de clé de production ni modification des installations.
- Le fichier `qa-verification.json` hors Git contient le SHA, la provenance, le statut explicite non publiable et le résultat des tests ; les artefacts historiques sc3-final-delivery/ restent inchangés.

## Essais exécutés sur FIXE
- CLI officiel Android téléchargé de dl.google.com et SHA-1 d'archive `57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d` comparé à son métadonnée officielle ; plate-forme SDK 35 et build-tools 35.0.0 installés uniquement dans l'arbre de développement.
- `npm run android:sync` : **PASS**, ressources publiques 142 fichiers ; `assembleDebug` : **PASS** sur SDK local. Vérification indépendante `assembleDebug --offline --no-daemon --max-workers=1` : **PASS**, 32 tâches à jour, log `%TEMP%\\sc3-android-20261103-assemble-debug-confirm.log`.
- `testDebugUnitTest lintDebug --no-daemon --max-workers=1` : **PASS**, **49 tests Java PASS / 0 FAIL / 0 skipped** sur 11 fichiers XML JUnit ; `lintDebug` **PASS**, 15 avertissements / **0 erreur**. Log `%TEMP%\\sc3-android-20261103-qa-verify-online.log`. Ce ne sont pas des tests sur Android physique.
- Historique d'échecs préservé : tentative initiale de wrapper PowerShell interrompue par `JAVA_TOOL_OPTIONS` émis en stderr sous ErrorActionPreference Stop, alors que l'APK a effectivement été générée ; commande revalidée avec exit 0. Essai de tests Java en mode Gradle offline : **FAIL** car JUnit 4.13.2 non présent dans le cache local, suivi d'un essai online **PASS** sans changement des sources. Le SDK moderne produit un avertissement XML v4, et Java 21 avertit sur source/target 8 ; aucun de ces avertissements n'a été effacé.
- Git canonique resté propre pendant ces builds. Aucune connexion OBS/Twitch, aucune installation Windows/Android, aucune publication.

## Blocages de la candidate distribuable
G2 toujours `in_progress` ; G3 physique FIXE/laptop/Android **non réalisé** ; G4 nécessite la **signature Windows de confiance**, la **clé Android de production préexistante et compatible avec l'app installée**, l'APK `assembleRelease` signée du **même commit**, migrations/backup/rollback réels ; G5 reste ouvert. Le debug QA ne peut servir à contourner une clé absente. La matrice ne doit pas être promue sur ce seul résultat.
