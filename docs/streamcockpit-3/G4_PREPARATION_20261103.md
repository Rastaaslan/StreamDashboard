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
