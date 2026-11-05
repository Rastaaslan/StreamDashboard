# G2 — Diagnostic non destructif du bouton « Lancer Twitch » (05/11/2026)

## Contexte et périmètre

Traitement **exclusivement sur FIXE Windows 11 via Remote Desktop Commander**. Source canonique `streamcockpit/3.0-full-experience` à partir du HEAD `f8a04f2`, remote GitHub vérifié, sans lock Git ni rebase/merge. Préflight de `PLAN.md`, `feature-matrix.json`, `CONTINUITY.md`, `MIGRATION_TO_FIXE_20261101.md` réalisé. OBS utilisateur seulement observé, aucune requête ni commande OBS/Twitch et aucune installation.

Quatre fichiers F05 déjà modifiés par un autre propriétaire et `CONTINUITY.md` également modifié : **intégralement préservés, ni modifiés ni indexés**. Tests World Director actifs sur FIXE : pas de build général, d'installation ni d'opération concurrente sur `dist`.

## Traitement effectif

Quand `liveControlState(...).canStartBoth` est `false`, le bouton Twitch était désactivé avec un message générique, donnant l'impression qu'il « ne fonctionne pas ». Aucun changement d'autorisation, de command dispatch ou de garde OBS/Twitch n'était nécessaire.

Ajout de `liveStartBlockReason` : diagnostic **lecture seule** distinguant régie FIXE hors ligne, commande en cours, diffusion existante, OBS absent ou état de sortie inconnu, destination Twitch non configurée, télémétrie Twitch périmée et préflight non confirmé. Rendu visible sous le bouton désactivé sur Windows et mobile compact, et dans le toast de refus d'une action. Ne transforme jamais un état indéterminé en permission de démarrage. Twitch only.

Fichiers possédés par ce lot :
- `apps/mobile/control/live-controls.js`
- `apps/mobile/control/live-controls.d.ts`
- `apps/mobile/control/control.js`
- `tests/node/live-controls.test.mjs`

## Preuves

- RED (avant implémentation) : test Node en échec à l'import de la fonction absente, exit 1, aucune action réelle.
- GREEN : `node --test tests/node/live-controls.test.mjs` **11 PASS / 0 FAIL / 0 skipped**, dont le nouveau cas couvrant sept types d'état et la conservation de `canStartBoth=false`.
- `vitest` ciblé Twitch-only + live-stabilization : **8 PASS / 0 FAIL / 0 skipped** (2 suites). Journal `.git/sc3-live-start-diagnostics-vitest-20261105.log`.
- `npm run build:types` : PASS ; `npm run check:browser-types` : PASS.
- `npm run security:check` : PASS, **6750 fichiers** (arbre comprenant d'autres modifications F05 non commitées), `node --check apps/mobile/control/control.js` : PASS.
- `git diff --check` : exit 0 ; seuls avertissements de conversion LF/CRLF.
- Journaux conservés localement dans `.git/sc3-live-start-diagnostics-{types,browser-types,security,vitest}-20261105.log`.

Ces résultats ne prouvent **ni** que le défaut de démarrage observé par l'opérateur est corrigé sur son installation, **ni** le démarrage d'un live réel, **ni** une réception Android physique. Le bouton reste volontairement désactivé si Twitch/OBS sont inconnus. Aucune publication, installation ou signature de production.

## Gates et suivi

F03/F00 restent PARTIAL ; G2 `in_progress` ; G3–G5 `open`. G0/G1 historiquement qualifiés. `feature-matrix.json` ne doit pas être promue pour ce traitement.

L'entrée CONTINUITY devra référencer ce document lorsque la modification F05 de l'autre propriétaire aura été commise, afin de ne pas indexer ni écraser son travail. Prochaine action rentable : réception opérateur de la cause exacte affichée quand le démarrage est désactivé, et qualification F05 par son propriétaire (route GET en vol à travers une coupure), sans lancement automatique d'un live.
