# F04 — Régression de concurrence ReplayBufferSaved (05/11/2026)

## Préflight et propriété
Contrôle exclusivement via Remote Desktop Commander sur FIXE. PLAN.md, feature-matrix.json, CONTINUITY.md et MIGRATION_TO_FIXE_20261101.md lus avant écriture. Branche `streamcockpit/3.0-full-experience`, remote origin canonique, HEAD initial `c127ede` synchronisé. Aucun verrou Git ni compilateur StreamCockpit concurrent identifié. Cinq fichiers F05/CONTINUITY.md sont modifiés par un autre propriétaire : aucun n'a été écrit, remis à zéro ni indexé. OBS a seulement été constaté comme processus. Aucun accès aux autres machines/projets, RC2, installations, Twitch ni aux profils.

## Traitement ciblé
Deux scénarios de régression supplémentaires dans `tests/streamcockpit3-moments-obs-replay.test.ts` vérifient le producteur existant, sans changer sa logique :
- Deux événements OBS identiques reçus simultanément pendant un commit de journal volontairement suspendu : une seule écriture, un seul marqueur.
- Un événement d'une ancienne diffusion reste bloqué après réveil de son contrôle de propriétaire, même si une nouvelle epoch OBS a entre-temps enregistré un autre replay ; aucune réadmission de l'événement obsolète.

## Qualification mesurée
Trois suites ciblées sur FIXE (replay OBS, SQLite temporaire Windows et confidentialité) : **22 PASS / 0 FAIL / 0 skipped**, journal `.git/sc3-obs-epoch-concurrency-20261105-tests.log`. `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (**6 750 fichiers**) ; `git diff --check` PASS avec avertissement LF/CRLF non bloquant. Journaux `.git/sc3-obs-concurrency-{types,browser,security}-20261105.log`.

Les nouveaux tests utilisent des callbacks synthétiques et un stockage isolé ; ils ne certifient pas un OBS public, un réveil Android réel, ni la durabilité après une panne électrique. Le dépôt comporte toujours les modifications F05 non commitées et externes au lot. **F04 partial, G2 in_progress, G3/G4/G5 open.** Aucune installation, signature, publication ni commande OBS/Twitch réalisée. Prochaine réception utile : tester le vrai replay et sa projection sur FIXE/Android lors de G3, et intégrer séparément le correctif F05 par son propriétaire.
