# F04 — validation de forme des identifiants ReplayBufferSaved (05/11/2026)

## Contrôle préalable
Remote Desktop Commander sur FIXE exclusivement. PLAN, matrice, CONTINUITY, MIGRATION_TO_FIXE lus avant intervention ; branche `streamcockpit/3.0-full-experience`, remote GitHub canonique, HEAD initial `c2e4f07`. Arbre initial avec uniquement cinq modifications F05/CONTINUITY appartenant à un autre propriétaire : intégralement préservées, non indexées. Aucun lock de dépôt, aucun processus de build du chantier actif ; OBS seulement observé au niveau processus, sans requête ni action.

## Défaut observé et correction
Le producteur de marqueurs replay acceptait tout identifiant commençant par `obs_replay_`, même `obs_replay_not_a_digest`, comme origine valide à journaliser. Un test ciblé a reproduit le défaut : **0 PASS / 1 FAIL / 10 skipped**, assertion `recorded` au lieu de `ignored` ; log `.git/sc3-f04-eventid-red-20261105.log`.

Correction étroite : accepter seulement la forme `obs_replay_[a-f0-9]{64}`, conforme au HMAC-SHA256 minuscule généré par le client OBS de FIXE (`integrations/obs/src/client.ts`). Les quatre variantes malformées testées sont refusées **avant l'accès au journal**. Les contrôles existants de session OBS, génération de connexion, epoch et propriétaire FIXE restent obligatoires. **Une forme de digest correcte ne prouve PAS que le HMAC est authentique** ; aucune attestation supplémentaire n'est revendiquée.

## Qualification
Code corrigé : **20 PASS / 0 FAIL / 0 skipped** sur trois suites ciblées (ReplayBufferSaved, SQLite Windows temporaire, confidentialité), `.git/sc3-f04-id-format-final-tests-20261105.log`.
`npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (**6 750 fichiers**) ; `git diff --check` PASS avec avertissements LF/CRLF non bloquants. Logs `.git/sc3-f04-idfmt-*-20261105.log`. Pas de campagne générale, build de distribution ni test physique.

F04 reste **partial**, G2 **in_progress**, G3–G5 **open**. Aucun live, commande OBS/Twitch, installation, signature ni publication. Les cinq fichiers F05/CONTINUITY restent à leur propriétaire ; un rapport dédié et la matrice sont utilisés faute de pouvoir modifier CONTINUITY en sécurité. Prochain pas : finir le correctif F05 de reconnexion par son propriétaire, puis réception G3 matérielle des replays sur FIXE/Android.
