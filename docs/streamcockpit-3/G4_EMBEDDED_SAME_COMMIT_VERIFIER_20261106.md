# G4 — vérification indépendante de provenance EXE/ASAR et APK

**Date** : 06/11/2026 ; **poste** : FIXE Windows 11 uniquement ; **branche** : streamcockpit/3.0-full-experience.

## Défaut réel fermé au niveau code
Le vérificateur G4 existant vérifiait hash SHA-256 des fichiers, signature Authenticode Windows, APK v2/v3 signé avec empreinte épinglée, et HEAD Git propre, mais terminait systématiquement par `EMBEDDED_SAME_COMMIT_ATTESTATION_MISSING` sans jamais examiner les métadonnées effectivement embarquées. Une paire signée, de même source, restait donc impossible à qualifier même si tous les critères étaient réunis.

Le nouveau vérificateur lit `resources/streamcockpit-build.json` **dans l'ASAR réel** attenant à l'EXE, contrôle l'intégrité de son en-tête SHA256 dans les ressources PE x64 Electron (INTEGRITY/ELECTRONASAR), puis lit le fichier `assets/public/streamcockpit-build.json` **dans les octets de l'APK** via ZIP .NET en lecture seule. Les deux attestations doivent présenter exactement les six champs prévus, le même commit Git que le manifeste et HEAD, le même hash d'arbre source, la même version et `sourceTreeDirty=false`. Taille des métadonnées plafonnée à 8 KiB, chemins passés à PowerShell encodés, aucun unzip sur disque. Le vérificateur recontrôle les SHA256 des artefacts et l'état de HEAD après inspection : aucun succès à partir de métadonnées manifestes seulement.

## Preuves
- 3 suites ciblées : **14 PASS / 0 FAIL / 0 skipped**, incluant rejets commit différent, arbre différent, build sale, champs additionnels et version incompatible.
- Lecture réelle de la paire QA **EXE/ASAR + APK** préexistante au commit `73a6aae2a8e59c1c22c1f0d304cccb08c1586718` : commit et SHA256 d'arbre concordants `9da384c3e69b69827576fc7d0e34c3f96d621199ddd8ac6e4eaea4581f9b9838` ; opération **lecture seule**, sans signature de production.
- `npm run build:types` PASS, `npm run check:browser-types` PASS, `npm run security:check` PASS (**6795 fichiers**) et `git diff --check` PASS ; aucune régression UI applicable à ce contrôle CLI.
- OBS, Twitch, les exécutables installés, les profils, les secrets, laptop et Android physique : **aucun accès ni commande**. Les fichiers F05/mixeur et CONTINUITY appartenant aux autres propriétaires sont préservés.

## Bloquants restants
Le code du vérificateur est utilisable, **pas une attestation G4 réussie pour une candidate de production**. L'ancienne paire QA testée a une signature Android de debug et un EXE Windows non signé ; la nouvelle candidate issue du dernier HEAD n'est ni emballée ni signée. La vérification de provenance des deux archives ne constitue ni réception matérielle G3, ni adaptateur de mise à jour réel, ni migration/rollback après crash. La machine est utilisée pour le live : aucun packaging lourd ni installation. G2 in_progress, G3–G5 open, F10 partial.
