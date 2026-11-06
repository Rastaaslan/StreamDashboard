# SETTINGS — Android ne peut pas se présenter comme régie OBS FIXE (06/11/2026)

## Préflight et attribution
- Uniquement Remote Desktop Commander, appareil FIXE `b5db7551-143d-410a-8b84-157070125122`, dépôt canonique et branche `streamcockpit/3.0-full-experience`, origin GitHub attendu.
- `PLAN.md`, `feature-matrix.json`, `CONTINUITY.md`, `MIGRATION_TO_FIXE_20261101.md` lus avant modification. HEAD initial `a281cc3`, synchronisé avec origin ; aucun lock Git ni processus de build concurrent identifié au préflight. OBS et QA `f15845b` constatés uniquement au niveau processus, sans interaction.
- Quatre fichiers F05 (trois sources mixeur et un test) et `CONTINUITY.md` déjà modifiés par un autre propriétaire : aucun de ces cinq chemins n'est modifié, stagé ou attribué au présent lot. Le journal séparé sert de handoff jusqu'à libération explicite de `CONTINUITY.md`.
- Le PLAN actuel reporte le montage avancé/ClipForge à V4. F04 3.0 reste marqueurs/replays/clips simples, pas d'ouverture de chantier FFmpeg.

## Défaut mesuré
- La vue `renderDevicesSettings` utilisait `device.role === 'stream'` pour désigner l'autorité OBS FIXE, même sur `native === true` (Android).
- Un Android portant un ancien profil local `stream` affichait alors « Régie de cet ordinateur », le lien « Configurer OBS sur FIXE », la liste locale des télécommandes de FIXE et un bouton de création de code **sur FIXE**, alors que ces actions sont réservées à la régie Windows.
- Reproduction RED dans le test ajouté : **1 PASS / 2 FAIL / 1 skipped** (le scénario Edge étant réservé à la passe avec son indicateur). Le défaut est une **présentation UI**, pas la preuve d'une seconde autorité OBS réellement créée ; aucune commande réseau ni secret n'a été utilisé.

## Correctif limité
- `apps/mobile/control/settings-simplified.js` : `isMaster = !native && device?.role === 'stream'`.
- Les clients Android ont toujours l'accès au parcours « Associer une régie ». Leur exécuteur local explicite, s'il existe, conserve la gestion **de ses propres** permissions/transport, jamais la présence d'une régie OBS FIXE.
- Le vrai Desktop Windows FIXE de rôle `stream` garde ses outils OBS et son association de télécommandes. Aucun schéma de profil, API, secret, rôle sauvegardé, installation, ou mappage OBS n'a été changé.

## Qualification après correction
- Dix suites ciblées Settings/topologie/Android/OAuth/pairing/présence serveur/mot de passe OBS : **55 PASS / 0 FAIL / 1 skipped**, avec **11 véritables scénarios Microsoft Edge** en fenêtre 320px ou desktop (données et services simulés). Log : `%TEMP%\sc3-android-settings-owner-green-final-20261106.log`.
- Première tentative GREEN interrompue **sans résultat de campagne finale** par la conversion PowerShell de l'avertissement expérimental `node:sqlite` sur stderr en erreur fatale ; seconde exécution a conservé l'avertissement mais traité le **code retour effectif**, aboutissant à 55 PASS.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (**6 768 fichiers**, y compris modifications non commises F05 du propriétaire tiers) ; `node --check` PASS ; `git diff --check` PASS (avertissements CRLF sans whitespace error).
- Logs individuels : `%TEMP%\sc3-android-settings-owner-20261106-{types,browser-types,security,syntax,diff}.log`.
- Pas de test sur vrai téléphone Android, pas de provenance du rôle natif vérifiée sur matériel, pas de test OBS/Twitch public, pas de build/installation Windows/APK, ni G3/G4/G5.

## État et suite
- F00 reste `partial`, G2 `in_progress`, G3–G5 `open`. Aucun feu vert installation ou RC.
- Suite utile : reproduire le parcours sur Android WebView **avec validation opérateur G3**, puis continuer l'audit de propriétés réelles des réglages sans double état FIXE/client ; conserver un seul propriétaire par fichier.
