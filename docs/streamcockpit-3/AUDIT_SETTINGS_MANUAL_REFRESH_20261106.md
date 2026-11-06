# Audit StreamCockpit 3.0 — actualisation manuelle des paramètres FIXE (lot horaire)

**Date :** 2026-11-06 (09:44–09:49 CET). **Machine :** FIXE uniquement via Remote Desktop Commander, dépôt et branche canoniques, origin Rastaaslan/StreamDashboard. **HEAD avant lot :** `8f175c9`.

## Préflight

`PLAN.md`, `feature-matrix.json`, `CONTINUITY.md` et `MIGRATION_TO_FIXE_20261101.md` consultés avant intervention. `git status`, `git log`, origin, verrous Git, processus et charge contrôlés : aucun index.lock, HEAD synchronisé avec origin ; OBS utilisateur et QA `f15845b` présents, seulement observés. Un processus parallèle effectuait une inspection Git **lecture seule** ; aucun propriétaire en écriture identifié sur les deux fichiers Settings de ce lot. Cinq fichiers F05/CONTINUITY étaient déjà modifiés par un autre propriétaire, préservés sans staging ni retouche.

## Défaut reproduit

Lorsque le snapshot FIXE était expiré ou que le réseau était indisponible, l'interface Connexions indiquait « actualisez la régie » tout en désactivant correctement Discord/WizeBot, **mais sans bouton d'actualisation** à cet endroit. RED ciblé : **0 PASS / 1 FAIL / 13 skipped** par filtre de test (bouton absent).

## Correction étroite

`apps/mobile/control/settings-view.js` : afficher un seul bouton **« Actualiser l’état de FIXE »** quand un endpoint de régie est sélectionné, mais que son observation est indisponible ou périmée. Pas de bouton lorsque l'état est récent ou lorsqu'aucune régie n'a été associée. Le bouton réutilise le gestionnaire **déjà existant** `refresh-live` dans `control.js` (`refresh(true)`), sans ajouter de flux OAuth ni de nouvelle route. Attention : le gestionnaire existant déclenche la **synchronisation de l'espace** (`autonomy.sync()`), et non un GET purement lecture seule ; ne pas prétendre à l'absence de transfert de brouillons en attente lorsque l'utilisateur appuie dessus. Aucune commande OBS/Twitch directe ajoutée. Les contrôles sensibles restent désactivés jusqu'à une observation fraîche, sans affirmer qu'une connexion OAuth est prête.

`tests/streamcockpit3-settings-integrations-scope.test.ts` : couverture des états périmé/hors ligne/frais/non associé et vérification réelle d'Edge à 320 px, sans lancer de commande ni requête réseau pendant le rendu.

## Qualification finale

- Vitest ciblé (intégrations, navigation et topologie) avec navigateur Edge activé : **31 PASS / 0 FAIL / 0 skipped**, 3 suites, **9 scénarios Edge réels** (synthetic DOM/observations). Aucun test réseau de bout en bout de l'action d'actualisation.
- `npm run build:types` : **PASS**.
- `npm run check:browser-types` : **PASS**.
- `node --check apps/mobile/control/settings-view.js` : **PASS**.
- `npm run security:check` : **PASS**, 6778 fichiers au passage avant ajout de ce rapport.
- `git diff --check` : **PASS**, avertissements de conversion LF/CRLF sans défaut bloquant.

## Limites et suite

Tests logiciels sur FIXE uniquement, sans action réelle sur comptes/profils/services, OBS/Twitch public, appareils physiques, build EXE/APK ni modification de la QA `f15845b`. Revoir lors d'un lot distinct la possibilité d'une récupération d'état FIXE **strictement en lecture seule** sans synchronisation des brouillons, puis tester reprise réseau physique avec réception opérateur. Ce lot ne qualifie aucune livraison : **G0/G1 qualified, G2 in_progress, G3–G5 open**.
