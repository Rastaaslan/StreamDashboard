# SC3 — Audit UI : bannière « TOUT EST PRÊT » du cockpit classique

**06/11/2026, exécution FIXE uniquement**, source `streamcockpit/3.0-full-experience`. Aucun OBS/Twitch public, installation, profil, secret, Android/laptop, RC2, WorldPrep, Director ni publication.

## Préflight et propriété
- Quatre documents d'autorité lus avant toute modification : `PLAN.md`, `feature-matrix.json`, `CONTINUITY.md`, `MIGRATION_TO_FIXE_20261101.md`.
- HEAD de départ `6a94f36`, branche et origin GitHub attendus, suivi distant synchronisé. Pas de `index.lock`, rebase, merge ou owner actif. OBS et la QA Electron étaient ouverts : simple observation des processus ; aucune commande.
- Cinq modifications préexistantes d'un autre propriétaire sur F05 et `CONTINUITY.md` : **aucune modification, indexation ou réécriture de ces fichiers**. Les vieux PowerShell de diagnostic déjà présents n'étaient pas des écritures de dépôt en cours ; aucun git/npm/tsc/vitest écrivain concurrent détecté avant ce lot. CPU observé ~29 %, RAM libre ~23 Gio.
- Périmètre propre du présent lot : `apps/web/app.js`, `apps/web/classic-readiness.js`, `tests/streamcockpit3-audit-classic-readiness.test.ts` et ce rapport. Le reproducteur indépendant hors worktree est dans `.git/sc3-audit-ready-repro-20261106.cjs`.

## Défaut confirmé AVANT correction
- `overview()` et `updateHeader()` calculaient `TOUT EST PRÊT` à partir de la seule présence du runtime et des connexions OBS/Twitch. Trois cas reproduits dans le rendu réel des fonctions : `preflight.status=action-required`, `error` et `idle` ; **l'entête et l'accueil annonçaient toujours « TOUT EST PRÊT »** malgré une préparation explicitement non validée.
- Les trois contrôles négatifs (runtime/OBS/Twitch manquant) continuaient à cacher le statut « prêt ». Le bouton d'action rapide utilisait déjà `preflight.ready`, et reste inchangé par ce lot : il s'agissait d'un **défaut de qualification visuelle**, pas d'une autorisation directe de démarrer le stream.

## Correctif minimal
- Une projection **purement en lecture** `classicDashboardReadiness(state)` partagée entre l'accueil classique et l'entête ; `ready` exige runtime, connexions OBS+Twitch, état OBS de streaming connu, préflight au statut `ready`, checklist non vide et intégralement cochée, et aucune diffusion OBS active.
- Un préflight incomplet ou une observation inconnue présente désormais « À VÉRIFIER » et « Préparation à vérifier avant le live. » ; le direct déjà actif est annoncé « EN DIRECT / DIRECT EN COURS » sans être présenté comme prêt à démarrer une deuxième fois.
- Aucune API, permission, commande `session.start`, logique de forçage, sécurité serveur ou navigation Android n'a été modifiée. Ces indicateurs n'accordent **aucune** capacité de diffusion.

## Qualification
- Reproducteur des 3 faux positifs **avant changement : 3/3 défauts confirmés**, 3 contrôles négatifs, 1 contrôle préflight ready (exit 0 du diagnostic = défaut observé).
- Après correctif : `SC3_AUDIT_BROWSER_TEST=1 npx vitest run tests/streamcockpit3-audit-classic-readiness.test.ts tests/streamcockpit3-readiness.test.ts --maxWorkers=2 --testTimeout=30000` → **11 PASS, 0 FAIL, 0 skipped**, dont **1 scénario dans le vrai Microsoft Edge à 320 px**, trois états successifs, zéro requête réseau.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `node --check` pour les deux scripts PASS ; `npm run security:check` PASS (**6 770 fichiers**, arbre de travail F05 préexistant inclus) ; `git diff --check` PASS, seulement avertissements CRLF des fichiers F05 d'autrui.
- Pas de suite générale sous charge, pas de paquet QA, pas de test FIXE/laptop/Android réel, pas de lancement live, pas de preuve d'uptime/heartbeat ou des permissions Twitch.

## Limites et suites
- L'indicateur classique est une synthèse visuelle prudente, **pas la validation de tous les prérequis serveur**. La route et les protections serveur de démarrage restent les seules autorités. Dans un prochain lot disjoint, auditer `prepare()` et les conditions du bouton `session.start` ainsi que la fraîcheur des observations, avec des tests Edge et sans changer les commandes réelles.
- Ne pas traiter les chaînes YouTube historiques comme la preuve d'un flux actif ; ne pas supprimer sans preuve d'inaccessibilité.
- **G0/G1 historiquement qualifiés, G2 in_progress, G3–G5 open ; aucune promotion de feature ou de gate.** QA installée `f15845b` intacte, aucune publication ni installation.
