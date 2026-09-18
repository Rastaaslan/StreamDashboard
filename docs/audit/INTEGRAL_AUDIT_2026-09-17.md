# Audit intégral — 17 septembre 2026

Baseline locale auditée : `678c6561c7ec8a5f50a1839c7ef0f92a94e81f02`. Le remote GitHub n’était pas disponible dans l’environnement ; cette baseline contient le snapshot fourni de la PR.

## Matrice prioritaire

| Finding | État avant | Correctif | Preuve automatisée |
|---|---|---|---|
| Commandes HTTP bloquées par WS | P0 | contrôleur HTTP indépendant | `mobile-command-controller.test.ts` |
| Fermeture WS = faux offline | P0 | dernier état conservé + probe REST | tests contrôleur/mobile |
| Handlers Start concurrents | P0 | propriétaire unique dans `mobile.js`; scripts correctifs retirés du HTML | smoke DOM/source |
| Verrou `busy` global | P0 | locks par ressource | test commandes concurrentes |
| Timeout Start ambigu | P0 | 30 s, commandId et réconciliation GET | test timeout réconcilié |
| Reset checklist mort | P0 | contrôle remote mort retiré avec la couche legacy | smoke mobile |
| Retry de commande | P1 | idempotence serveur par commandId | tests API |
| Snapshot obsolète | P1 | `stateRevision` monotone, snapshots anciens ignorés | tests état mobile |

## Limites restantes

Les phases Android WebViewAssetLoader/PKCE lifecycle, soundboard Windows, providers EventSub, delta realtime, extraction complète du serveur et workflow Windows Authenticode demandent des lots séparés et un environnement Android/Windows réel. Elles ne sont pas déclarées validées par ce correctif.
