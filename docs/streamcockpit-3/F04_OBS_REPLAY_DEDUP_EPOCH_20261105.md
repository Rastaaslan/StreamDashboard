# F04 — Garde anti-doublon des notifications OBS ReplayBufferSaved (05/11/2026)

## Préflight et périmètre
FIXE Windows 11 exclusivement via Remote Desktop Commander. Documents PLAN.md, feature-matrix.json, CONTINUITY.md, MIGRATION_TO_FIXE_20261101.md lus. Branche `streamcockpit/3.0-full-experience`, origin GitHub canonique, HEAD initial `7c35f80` égal upstream. Pas d'index.lock ni de propriétaire F04 actif. Cinq fichiers F05/CONTINUITY.md déjà modifiés par un autre propriétaire sont conservés et exclus du staging. OBS réel constaté comme processus, mais aucun état/commande OBS/Twitch sollicité. Aucune autre machine, installation, RC2, Contra, Director, Crafty ou secret ouvert.

## Anomalie et correction
`ObsReplayMomentProducer` oubliait la plus ancienne tentative de journalisation au-delà de 512 événements `ReplayBufferSaved` dans le même runtime. Une notification tardive pouvait alors déclencher une **seconde tentative** pour une écriture SQLite initialement incertaine, malgré l'interdiction de retry automatique.

Test de régression ajouté avec plus de 512 notifications distinctes et même epoch OBS, plus nouvelle epoch. Avant correction : test ciblé **0 PASS / 1 FAIL / 9 skipped**, log `%TEMP%\\sc3-f04-obs-dedup-red-20261105.log`, résultat inattendu « recorded » au lieu de « ignored ».

Correction strictement F04 : la table de dédoublonnage ne perd plus de UUID dans un live. Passé 512 notifications distinctes par même couple génération de connexion/epoch de diffusion, elle refuse les nouveaux événements (fail-closed), sans effacer de tentative incertaine. Elle ne se renouvelle que lorsqu'un snapshot OBS valide atteste une nouvelle epoch ; une notification obsolète ou étrangère ne peut pas la vider. Cela conserve les contrôles d'autorité, session et reprise après `await`, sans commander OBS et sans second producteur.

## Qualification et limites
Trois suites ciblées sur FIXE : **39 PASS / 0 FAIL / 6 skipped** ; incluent un vrai stockage SQLite temporaire Windows dans le test historique, mais **le nouveau test de capacité est synthétique** (aucun OBS réel). TypeScript, types JS navigateur, contrôle de sécurité et revue `git diff --check` revérifiés avant commit. Logs de qualification : `%TEMP%\\sc3-f04-obs-dedup-final-tests-20261105.log`, `%TEMP%\\sc3-f04-obs-dedup-final-types-20261105.log`, `%TEMP%\\sc3-f04-obs-dedup-20261105-browser.log`, `%TEMP%\\sc3-f04-obs-dedup-20261105-security.log`.

**Limite explicite :** après 512 notifications distinctes dans une diffusion, d'autres marqueurs automatiques sont ignorés jusqu'à une nouvelle epoch OBS. Ce choix conservateur refuse un événement plutôt que risquer un deuxième commit incertain ; métrique/alerte dédiée à ajouter si la limite devient observable sur un vrai long stream. Pas de preuve du replay OBS matériel, Android, crash électrique, signature, packaging ou publication. F04 reste `partial`, G2 `in_progress`, G3–G5 `open`. ClipForge avancé demeure reporté en V4.

## Suite prioritaire
Réception matérielle G3 des notifications OBS et de leur journal ; régler séparément le F05 de reconnexion avec son propriétaire. Aucun changement d'installation ou de profil utilisateur.
