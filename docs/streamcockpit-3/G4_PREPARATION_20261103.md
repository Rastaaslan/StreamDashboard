# G4 — état préparatoire de construction
SC3-FINAL-DELIVERY-001, FIXE Windows 11. Version de développement 3.0.0-alpha.1. Aucune RC publiée.

## Provenance
- Les ressources publiques communes comprennent streamcockpit-build.json : commit Git, version, SHA-256 des sources et indicateur d’arbre modifié.
- Windows embarque cette même provenance dans resources/streamcockpit-build.json et les assets UI ; Android la reçoit dans assets/public/streamcockpit-build.json.
- Le contrôle ASAR compare la provenance, refuse une source sale ou un commit différent de HEAD et vérifie le lien d’intégrité EXE/ASAR x64. Ce contrôle ne remplace ni signature ni réception.
- Les sources/tests ClipForge restent dans Git, hors runtime et UI de production 3.0.

## Contrôle des prérequis sur FIXE
- Node et Java 21 disponibles ; CLI Forge présente.
- Runtime Electron de développement absent initialement ; restauration locale au dépôt effectuée via son install.js, sans installation utilisateur.
- Aucun SDK Android 35/build-tools configuré/détecté, aucune clé Android de production ni ses variables configurées.
- Aucun certificat personnel de code signing avec clé privée détecté ; aucune chaîne Windows de signature configurée.
- Diagnostic reproductible : node scripts/streamcockpit3-toolchain.mjs --save. Il n’affiche pas les secrets.

## Blocages restant obligatoires
APK production et contrôle de compatibilité du certificat existant ; essais EXE isolé et APK du même commit ; migration/rollback réels. L’installation transactionnelle F10 reste incomplète et G3 n’est pas réalisé. G4 reste open même si une construction préparatoire Windows réussit.

## Construction préparatoire effectivement exécutée
- Source propre : `99ac62622c3055366201dc481c0ed9121115bd1c`, poussée sur origin ; version 3.0.0-alpha.1.
- `build`, `check:shipped-js`, `desktop:package:built` PASS ; contrôle de provenance et intégrité EXE/ASAR x64 PASS. Deux tests Electron sur le paquet PASS, profils temporaires, faux OBS/rôle client et fermeture du runtime constatée.
- SHA-256 EXE : `20260be73ff2437f0bf14bebd80a9687999d44144587b0ba98f39e893b94b7a0` ; ASAR : `c00c4d6ec17ccdb76ee037b913e5a2e223ba487831c589d823b30d02ace80c85`. Authenticode : `NotSigned`.
- `android:sync` PASS : ressources communes avec le même commit et SHA-256 de sources, arbre propre. Aucune APK produite ; SDK 35/build-tools et signature existante manquent.
- Archives sources, paquet portable de travail et manifeste : `out/sc3-final-delivery/99ac62622c30/` sur FIXE. Ce dossier est explicitement PREPARATORY_NOT_A_RELEASE, sans installation ni publication. Il ne valide pas G4 et peut précéder les prochains commits de correction.
- Premier archivage des sources refusé par Git à cause d’un argument PowerShell mal formé ; repris avec `git archive -o`, sans reconstruire ou remplacer le paquet déjà testé.
