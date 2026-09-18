# Audit intégral — 17 septembre 2026

## Baseline revalidée

L'audit demandé ciblait `f51bfcb43eed42d0d949246546ac5541facb13e2`. Le workspace fourni est à `5534849c6651ee4f056655f68d27cc5bff15eecb`, sans remote Git configuré. Les constats ont donc été revalidés sur ce HEAD, sans reset.

## Verdict

**NO-GO comme cockpit unique de live.** Cette passe corrige le chemin critique « REST disponible, WebSocket indisponible », le verrou global des commandes, la réconciliation de Start/Stop et le contrôle Checklist mort. Elle ne remplace pas le smoke matériel Android/OBS/Windows requis.

## Matrice des constats

| Finding | État avant | Traitement de cette passe | Preuve |
| --- | --- | --- | --- |
| P0.1 commandes liées au WebSocket | Confirmé | Le contrôleur HTTP n'a aucune dépendance WebSocket | test comportemental du contrôleur |
| P0.2 fermeture WS = faux offline | Confirmé | Dernier état conservé; probe REST avant DOWN | revue du gestionnaire `onclose` |
| P0.3 contrôleurs superposés | Confirmé | Propriétaire Start réduit à `mobile.js`; consolidation complète restante | assertions de propriétaire unique |
| P0.4 Start shadowed | Confirmé | Suppression des interceptions Start concurrentes | test source + test one-call du contrôleur |
| P0.5 verrou global | Confirmé | Verrous par ressource (`stream`, `scene`, `audio:*`, `timer`) | test commande lente + micro concurrent |
| P0.6 timeout Start trop court | Confirmé | 30 s pour Start/Stop et réconciliation REST | test de postcondition après timeout |
| P0.7 Reset interdit | Confirmé | Bouton Reset distant retiré; policy inchangée | test de surface/policy |
| P0.8 tests statiques | Confirmé | Tests comportementaux du contrôleur ajoutés | `mobile-command-controller.test.ts` |

## Invariants de sécurité

Aucun changement n'a été apporté à Electron sandbox/context isolation, au stockage des secrets, au pairing, aux tickets WebSocket, à Companion Sync, aux providers ou aux confirmations OBS serveur.

## Dette restante priorisée

1. Finir la consolidation des modules de présentation mobile en un bootstrap sans stores/transports dupliqués.
2. Introduire `commandId`/idempotence serveur backward-compatible et `stateRevision` monotone.
3. Définir `primaryMicInput`; ne plus prendre le premier input actif.
4. Modéliser le streaming OBS `unknown` et ajouter le live-safety latch updater.
5. Durcir deep links/PKCE/WebView Android avec tests lifecycle.
6. Corriger les capacités Soundboard Windows et compléter la vraie page Desktop Sons.
7. Exposer les intégrations non vérifiées comme `NOT_SUPPORTED`.
8. Ajouter soak WS/event storm, packaging Windows signé et smoke matériel.
