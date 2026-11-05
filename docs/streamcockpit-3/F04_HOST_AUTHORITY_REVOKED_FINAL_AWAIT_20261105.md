# F04 — Révocation de l'autorité FIXE pendant la dernière lecture de session (05/11/2026)

## Préflight / propriété
- Intervention exclusivement via Remote Desktop Commander sur FIXE Windows 11, dépôt canonique et branche `streamcockpit/3.0-full-experience` ; HEAD initial `56e4230` égal à upstream, origin GitHub conforme. PLAN, feature-matrix, CONTINUITY et MIGRATION consultés avant modification ; aucun index.lock, merge/rebase ou propriétaire actif de ces deux fichiers F04 détecté.
- Cinq fichiers F05 et `CONTINUITY.md` déjà modifiés par un autre propriétaire, conservés sans écriture, restauration ni indexation. Pas d'accès aux autres machines, installations utilisateur, RC2, F09-Q, Contra, Director, Crafty, secrets, ni commande OBS/Twitch.
- OBS observé comme processus seulement ; pas de test matériel ni action réseau publique. Campagnes ciblées et contrôles statiques sans build de distribution.

## Défaut prouvé et correction
- `ObsReplayMomentProducer.observe()` contrôlait `hostEligible()` avant le deuxième `activeSessionId()`. Si FIXE perdait l'autorité pendant cette seconde lecture asynchrone, l'ID de session inchangé et l'état OBS toujours valide laissaient enregistrer un marqueur OBS malgré la révocation.
- Nouveau test RED `tests/streamcockpit3-moments-obs-replay.test.ts` : la seconde lecture retire l'autorité sans modifier la session, puis exige zéro appel de `record()`. **14 PASS / 1 FAIL / 0 skipped**, l'événement a été incorrectement `recorded` ; log `.git/sc3-f04-host-revoke-red-20261105.log`.
- Correction minimale : nouvelle vérification asynchrone `hostEligible()` et de l'état OBS **après** la dernière lecture de session, immédiatement avant `record()`. La tentative déjà réservée ne peut pas être automatiquement rejouée après rétablissement de l'autorité. Aucune API, persistance ni action OBS modifiée.

## Qualification source corrigée
- Vitest 3 suites ciblées (`moments-obs-replay`, `obs-runtime`, `moments-sqlite`) : **46 PASS / 0 FAIL / 0 skipped**, log `.git/sc3-f04-host-revoke-final-tests-20261105.log` ; vraies écritures SQLite Windows temporaires, événements OBS synthétiques.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (**6 750 fichiers**) ; `git diff --check` PASS (avertissements CRLF uniquement). Logs `.git/sc3-f04-host-revoke-{types,browser,security}-20261105.log`.
- Revue du diff étroit : uniquement producteur F04, test associé, matrice et ce rapport. Pas de tests généraux, packaging, vrai replay, changement de live, appareil Android/laptop, signature, mise à jour ni reprise après coupure électrique. La relecture d'autorité réduit la fenêtre, sans rendre atomiques les changements de rôle et l'écriture durable.

## Gates et suite
- **F04 partial ; G2 in_progress ; G3/G4/G5 open**. La source corrigée ne constitue pas une réception matérielle.
- `CONTINUITY.md` ne reçoit pas cette entrée car il reste modifié par le propriétaire F05 ; ce document et la matrice assurent la traçabilité sans conflit de propriété.
- Priorité : correction F05 par son propriétaire et réception réelle G3 de la perte/reprise d'autorité sur le trio, puis preuves de signatures et de rollback G4 avant G5.
