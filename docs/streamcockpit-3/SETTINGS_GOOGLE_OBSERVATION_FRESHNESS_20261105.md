# SETTINGS — Fraîcheur du statut Google de FIXE (05/11/2026)

## Préflight et propriété
- Exécution exclusive par Remote Desktop Commander sur FIXE Windows 11, dépôt canonique, branche `streamcockpit/3.0-full-experience`, remote `https://github.com/Rastaaslan/StreamDashboard.git`.
- PLAN, feature-matrix, CONTINUITY et MIGRATION consultés avant modification. HEAD initial `fdf6628`, origin synchronisé, aucun verrou Git observé ; processus OBS et QA observés sans commande.
- Cinq fichiers appartenant au chantier F05 sont déjà modifiés : trois modules mixeur, un test mixeur et `CONTINUITY.md`. Aucun de ces cinq fichiers n'a été édité ou stagé par ce lot. Documentation de continuité propre à ce lot conservée ici à cause du conflit d'écriture.
- Périmètre : code source Settings partagé Windows/Android et deux fichiers de tests ; aucun accès au laptop ou aux installations / profils / secrets, aucune commande OBS/Twitch.

## Défaut et correction
- Avant correction, le statut Google de la régie pouvait rester « connecté » malgré un `state.at` manquant, invalide, vieux de plus de 90 secondes ou futur de plus de 15 secondes, même si `online=true` à cause d'une reconnexion sans rafraîchissement du snapshot. Le champ `state.google` absent pouvait en outre provoquer une exception.
- Régression RED sur la source initiale : **8 PASS / 1 FAIL / 2 skipped** sur deux suites ; log `%TEMP%\sc3-settings-google-freshness-red-20261105.log`.
- Correctif strictement présentation : Google et Discord/Streamlabs/WizeBot utilisent le même contrôle de fraîcheur du snapshot FIXE. Google absent/inconnu et horodatages non plausibles sont affichés comme **non vérifiables**, sans prétendre aux droits OAuth ni à la fraîcheur de synchronisation du planning. L'affichage d'un compte Google local facultatif reste indépendant.
- Aucun retry, nouvelle horloge maître, écriture de compte, changement de scope, token ou publication Google/Twitch.

## Qualification sur code corrigé
- Trois suites ciblées `streamcockpit3-desktop-settings-role`, `streamcockpit3-settings-navigation-browser`, `streamcockpit3-settings-integrations-scope` : **16 PASS / 0 FAIL / 0 skipped**, avec contrôles Microsoft Edge réel (dont 320 px) sur états synthétiques. Log `%TEMP%\sc3-settings-google-freshness-final-20261105.log`.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (**6761 fichiers**) ; `git diff --check` ciblé PASS (avertissements LF/CRLF sans erreur). Log `%TEMP%\sc3-settings-google-freshness-static-20261105.log`.
- Contrôle diff ciblé : uniquement `settings-view.js` et deux suites Settings, plus le présent rapport et la matrice F06. Aucun build complet/Windows/APK ou réception physique de ces sources, aucun effet sur OBS en activité.

## Limites et prochain pas
- La fraîcheur dépend du timestamp global du snapshot FIXE, pas d'une attestation OAuth propre à Google ; un snapshot hôte frais ne prouve ni droits ni synchronisation Calendar. Les tests utilisent un FIXE synthétique et Edge headless, pas Android physique.
- G0/G1 historiquement qualifiés ; **F06 partial, G2 in_progress, G3/G4/G5 open**. Pas de publication ni installation. Passer ensuite aux permissions effectives des boutons de configuration et aux observations par fournisseur ; qualifier les appareils uniquement avec autorisation de réception.
