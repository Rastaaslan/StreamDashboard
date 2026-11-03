# F04 — Admission Windows ClipForge : binaires, signatures et ACL NTFS (2026-11-03)

## Résultat réel sur FIXE
Intervention via Remote Desktop Commander exclusivement sur FIXE Windows 11 dans le dépôt canonique 3.0, sans installer d'application, sans accéder à un replay OBS utilisateur ni exécuter une action Twitch/OBS publique. Le labo FFmpeg Windows préexistant reste **isolé** de l'API de production : aucun export en production n'est qualifié par ce travail.

Deux bloqueurs ont été vérifiés, en lecture seule, sur la machine :
- L'exécutable FFmpeg WinGet actuellement disponible renvoie **Get-AuthenticodeSignature.Status = NotSigned**. Un binaire disponible sur disque n'est pas, à lui seul, un fournisseur approuvé.
- La DACL du dossier TEMP utilisateur comporte des droits `Modify` pour des identités locales de sandbox en plus du propriétaire, de SYSTEM et des administrateurs. C'est un répertoire d'essai, **pas** un espace de staging privé qualifié contre un autre processus local.
- Un magasin personnel de certificats Windows a montré **0 candidat de signature de code avec clé privée** lors de ce contrôle. Aucun emplacement SDK Android configuré (`ANDROID_HOME`, `ANDROID_SDK_ROOT`, chemin standard local) n'a été identifié. Cela ne prouve pas qu'aucun autre outil/certificat puisse être provisionné ultérieurement.

## Code implémenté, sans contourner les gates
- `apps/server/src/streamcockpit-clipforge-windows-provenance.ts` : contrôle des trois rôles EXE FFmpeg / FFprobe / superviseur Job Object, chemins absolus locaux, répertoires sans reparse point, fichier ordinaire mono-lien, SHA-256 avant/après une inspection Authenticode non interactive PowerShell, **statut Valid et empreintes SHA-256 + thumbprints attendus par politique externe**. Une comparaison pure accepte les preuves synthétiques pour tests, **mais elle n'est pas** une admission runtime ; seule l'inspection de vrais octets peut fournir une preuve. Pas de fallback vers un binaire non signé.
- `apps/server/src/streamcockpit-clipforge-windows-acl.ts` : lecture non mutante d'ACL avec SID via Get-Acl ; exige propriétaire correspondant à l'identité hôte, héritage de DACL protégé, et aucune règle Allow pour un autre SID que l'hôte, SYSTEM et Administrateurs. `chmod(0700)` n'est PAS supposé assurer cette confidentialité sous NTFS.
- `npm run streamcockpit3:clipforge-status` : préflight F04 **en lecture seule**, configuré par des chemins et pins externes de l'hôte ; retourne des codes de blocage sans divulguer de chemin, de clé ou de nom de compte. Sans configuration explicite, les prérequis `BINARIES_MISSING` et `OUTPUT_ROOT_NOT_CONFIGURED` sont remontés. Le mode `--final` reste toujours bloquant sans provenance OBS, signatures, durabilité et rollback, indépendamment des statuts partiels.
- Ces contrôles **ne sont pas encore un launcher de production** : pas d'accès à un fichier replay OBS, pas de montage API ni de nouveau bouton autorisant l'encodage. Ils préparent l'admission future sans changer les règles du laboratoire existant.

## Tests et résultats de cette passe
- **30 PASS / 0 skipped / 0 FAIL** sur cinq suites F04/roadmap, journal `%TEMP%\sc3-f04-provenance-acl-20261103.log` : 15 tests laboratoire Windows FFmpeg/FFprobe **réels** + superviseur Job Object compilé uniquement dans un dossier de fixture (vidéo synthétique 360×640), cinq provenance dont inspection Authenticode effective du FFmpeg installé, cinq ACL dont inspection réelle TEMP FIXE, deux CLI et trois roadmap.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (**893 fichiers** sur l'arbre partagé à ce contrôle). `git diff --check` PASS (avertissements CRLF de Windows sans erreur).
- Le chantier F08 d'un autre propriétaire a modifié ses fichiers et la matrice commune pendant cette passe ; ses changements ne sont ni staged ni attribués à F04. Aucune suite générale Vitest/Node ni build de production n'est réattribuée à cette révision F04.

## Ce qui manque encore réellement
**F04 demeure PARTIAL et G2 in_progress** : il faut une chaîne de confiance externe pour les trois exécutables (y compris le superviseur signé et livré), des ACL NTFS privées provisionnées sur les vrais répertoires de staging, une source ReplayBufferSaved OBS effectivement autorisée et identifiée durablement, un service API et un parcours Desktop/Android contrôlés, la gestion persistante des erreurs de stockage et les preuves d'encodage de vrais replays sans perturber le live. Le transcodage d'une vidéo synthétique n'est pas un test de la diffusion.

**G3 open** : le laptop est hors ligne et aucune validation physique Android appairé + FIXE/laptop n'a été possible. **G4 open** : aucun couple Windows x64/APK release signé et prouvé issu du même commit, ni backup/migration/rollback matériel ; **G5 open** : candidate unique impossible sans toutes les preuves précédentes et consentement de l'opérateur. Les commandes de release restent bloquées. Ne pas publier une RC ni modifier les installations existantes.

Prochaine étape F04 : lier une identité de fichier OBS vérifiable sans divulgation de chemin à une sélection explicite du propriétaire FIXE, puis relier l'admission ci-dessus à un exécuteur Windows provisionné/signé et une API UX, avant les essais matériels G3.

## Régression générale post-intégration F08 + F04
- Vitest général séquentiel sur FIXE, **2208 PASS / 108 skipped / 0 FAIL**, **276 fichiers (259 PASS / 17 skipped)** ; log `%TEMP%\sc3-f04-full-vitest-20261103.log`, exit 0. Les tests F04 Windows/Edge opt-in restent qualifiés séparément, pas par les skips de cette suite.
- Build de développement `npm run build` PASS (**136 ressources publiques**, 15 JS runtime copiés), `check:shipped-js` PASS **143 fichiers**, Node construit `test:node:built` **349 PASS / 6 skipped / 0 FAIL**, log `%TEMP%\sc3-f04-build-node-20261103.log`, exit 0. Le build et Node sont séquentiels, sans concurrence sur `dist`.
- `test:browser` Playwright réseau **35/35 PASS**, log `%TEMP%\sc3-f04-playwright-20261103.log`, exit 0.
- Ces succès démontrent l'absence de régression logicielle visible ; **ils n'effacent aucun blocage G2–G5** relatif au matériel, à OBS réel, aux signatures, à la durabilité NTFS ou au rollback. La branche F09-Q et la RC2 restent intactes.
