# G4 — Refus de signature APK v1 seule (05/11/2026)

## Préflight et exclusivité
Exécuté uniquement via Remote Desktop Commander sur FIXE, dépôt canonique `streamcockpit/3.0-full-experience`, HEAD initial `54738e8` synchronisé avec `origin`, sans verrou Git. `PLAN.md`, `feature-matrix.json`, `CONTINUITY.md` et `MIGRATION_TO_FIXE_20261101.md` lus avant modification. OBS et tests World Director observés, jamais commandés/interrompus. Quatre fichiers F05 et `CONTINUITY.md` déjà modifiés par un autre propriétaire : aucun accès en écriture ni indexation de ces fichiers. Pas de build global ni accès laptop, dam-server, Android, RC2, F09-Q, Contra, Director, Crafty, installations, profils ou secrets.

## Anomalie reproduite et correctif
Le vérificateur G4 `scripts/streamcockpit3-artifact-verifier.mjs` acceptait l'indication `Verifies` de `apksigner` et le digest du certificat épinglé sans exiger une signature APK moderne : un résultat **v1 seulement**, v2/v3 `false`, passait le contrôle textuel. Cela aurait laissé passer un APK v1 seul vers la prochaine étape de vérification si les autres prérequis étaient fournis (le garde final G4 reste volontairement bloquant).

Garde désormais dans `checkApkSignerOutput` : certificat épinglé unique, confirmation exacte `Verifies` et au moins une preuve `Verified using v2 scheme ...: true` ou `v3 ...: true` avec version cohérente dans le libellé. Refus explicite `SC3_ARTIFACT_ANDROID_STRONG_SCHEME_MISSING` des cas v1 seul ou v2/v3 non confirmés. Vérification réalisée à partir de la sortie du processus Java `apksigner` déjà exécuté sans shell, sans autre dépendance ni signature fabriquée.

## Preuves exactes
- RED : **5 PASS / 1 FAIL / 0 skipped**, le test d'un APK v1 seul avec digest valide révélait l'acceptation indue ; `.git/sc3-g4-v1-scheme-red-20261105.log`.
- GREEN ciblé final : **13 PASS / 0 FAIL / 0 skipped** sur deux suites (v1 seul refusé, v2 validé, v3 validé, absence de confirmation refusée, incohérence de libellé refusée et tests existants) ; `.git/sc3-g4-apk-strong-final-20261105.log`.
- TypeScript `build:types` PASS ; `check:browser-types` PASS ; `security:check` PASS (**6750 fichiers dans l'arbre incluant les modifications F05 concurrentes**), syntaxe Node et diff-check PASS. Journaux `.git/sc3-g4-strong-{types,browser,security}-20261105.log`. Aucun build, test Android matériel ou installateur.

## Statuts et limites
`F10=partial`, `G2=in_progress`, `G3/G4/G5=open`. Les sorties `apksigner` sont **synthétiques** ; aucun certificat de production ni APK réel de cette livraison n'a été qualifié. L'attestation indépendante de provenance embarquée des deux artefacts, les signatures Windows/Android de production, la migration/reprise et le rollback matériel demeurent indispensables. Aucun contournement du refus final `EMBEDDED_SAME_COMMIT_ATTESTATION_MISSING`. Matrice F10 enrichie uniquement de cette preuve logicielle, sans promotion de statut. `CONTINUITY.md` doit être référencé après libération de son propriétaire F05 ; ne pas écraser son travail.
