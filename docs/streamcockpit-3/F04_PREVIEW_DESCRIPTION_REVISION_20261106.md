# SC3-F04 — Prévisualisation de moment périmée après modification de description (06/11/2026)

## Contrôle initial et propriété
- Via Remote Desktop Commander, exclusivement sur FIXE. PLAN, feature-matrix, CONTINUITY et MIGRATION lus AVANT modification.
- Branche canonique `streamcockpit/3.0-full-experience` ; remote `https://github.com/Rastaaslan/StreamDashboard.git` ; HEAD au départ `8f295f2`, origin synchronisé.
- Cinq fichiers F05/CONTINUITY non commis appartenant à l'autre chantier, aucun lock Git ni écriture concurrente observée sur les fichiers F04 choisis. Aucun de ces cinq fichiers n'a été modifié ni stagé.
- OBS ouvert et connecté mais pas en diffusion ou enregistrement selon l'état local consulté en lecture seule ; aucune commande OBS ou Twitch, aucun accès aux installations/utilisateurs, Android réel ou laptop. ClipForge avancé est **V4** selon PLAN du 03/11 : périmètre F04 3.0 = marqueurs/replay et clips simples, pas FFmpeg/montage.

## Défaut reproduit et correction
- Quand un événement `input` en attente (ex. IME/événement différé) arrivait durant une prévisualisation asynchrone Twitch, le handler de description retirait le consentement visible, **mais ne révoquait pas la révision** de la requête. La réponse ancienne pouvait alors réafficher le bouton « Créer ce moment sur Twitch » malgré une nouvelle description.
- RED Edge après ajustement du scénario à un événement d'entrée différé dans un champ devenu désactivé : **0 PASS / 1 FAIL**, assertion précise sur bouton à nouveau visible. Première tentative de scénario utilisant `fill()` sur entrée désactivée a expiré : **timeout d'orchestration**, pas preuve produit.
- Correctif minimal dans `apps/mobile/control/streamcockpit-twitch-moments.js` : la modification de description utilise désormais l'invalidation déjà partagée par les changements de type. Elle incrémente la révision, annule le consentement, rejette toute réponse ancienne ; si un POST était déjà en vol, conserve le statut incertain (aucune répétition).
- Test dédié `tests/streamcockpit3-f04-preview-description-race-browser.test.ts` : vrai Edge headless à 320 px, ancien GET/preview retenu puis événement input, réponse arrivée en retard. Aucun POST de confirmation, aucun journal local créé, aucun trafic réseau externe ; nouvelle vérification obligatoire.

## Qualification **sur les sources finales de ce lot**
- Vitest ciblé : **5 suites / 55 PASS / 0 FAIL / 0 skipped** : nouvelle race 1 Edge ; parcours browser existants 9 Edge ; multionglet 3 Edge ; stockage 21 ; HTTP fournisseur simulé 21. **13 scénarios Edge réels** au total, services hôtes/Twitch simulés.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `node --check apps/mobile/control/streamcockpit-twitch-moments.js` PASS.
- `npm run security:check` PASS **6 771 fichiers** avant rapport/matrice ; `git diff --check` PASS (warnings CRLF non bloquants).
- Tests généraux, compilation EXE/APK, fournisseur Twitch réel, appareil Android physique et reprise électrique : **non exécutés**. Aucune signature, packaging, publication ni installation.
- Statuts inchangés : F04 `partial`, G2 `in_progress`, G3/G4/G5 `open`. Le commit et le push doivent être vérifiés séparément, sans inclure les cinq fichiers non suivis de l'autre propriétaire.

## Suite
Poursuivre la qualification G2 des autres parcours F04 simples et la correction Settings côté propriétaire dédié, puis réserver la réception matérielle et les preuves de signature/rollback à G3–G5. Aucun contournement des confirmations ou de l'unique régie FIXE.
