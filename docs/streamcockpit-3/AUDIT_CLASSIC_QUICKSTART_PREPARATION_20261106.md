# SC3 Audit — démarrage rapide classique et statut de préparation

**06/11/2026 — lot ciblé depuis FIXE Windows 11, exclusivement via Remote Desktop Commander.** Branche `streamcockpit/3.0-full-experience`, dépôt `C:\Users\damie\Dev\StreamCockpit-3.0-FullExperience`. QA `f15845b` inchangée.

## Préflight et partage de propriété
- Autorités lues avant édition : `PLAN.md`, `feature-matrix.json`, `CONTINUITY.md`, `MIGRATION_TO_FIXE_20261101.md`. HEAD initial `91c6e8d` en accord avec origin GitHub. Pas de lock Git/owner actif. Manifeste historique : `lotComplete=true`, `missionDelivered=false`, `publicationAuthorized=false`.
- Cinq fichiers F05/mixeur et `CONTINUITY.md` préalablement modifiés par un autre chantier : jamais édités ni inclus dans le stage. Aucun processus de build/test StreamCockpit concurrent observé avant le lot. OBS et EXE QA en cours d'exécution, uniquement constatés ; mémoire libre ~22,8 Go ; pas d'opération OBS/Twitch publique, de profil, secret, installation ou machine distante.
- Propriété de ce lot uniquement : `apps/web/app.js`, `tests/streamcockpit3-audit-classic-quickstart.test.ts` et ce document. Aucun changement serveur, de permissions, de commande, d'APK ou de signature.

## Défaut reproduit AVANT correction (RED)
- L'en-tête classique montrait le bouton rapide `session.start` dès que `preflight.status=ready` et OBS connecté, **malgré** une checklist incomplète, `obs.streamingKnown=false`, Twitch déconnecté ou runtime absent.
- La section Préparer affichait `Tout est prêt` pour une checklist **vide (0/0)** et pour une checklist complète avec préflight en erreur. Le rafraîchissement incrémental utilisait la même mauvaise règle.
- Nouveau test ciblé exécuté sur source initiale avec vrai Edge 320 px : **0 PASS / 4 FAIL / 0 skipped** (échecs sur les comportements attendus, sans requêtes réseau). Commande : `SC3_AUDIT_BROWSER_TEST=1 npx vitest run tests/streamcockpit3-audit-classic-quickstart.test.ts`.

## Correction minimale
- Le raccourci `Démarrer` de l'en-tête utilise maintenant **le même prédicat complet** `classicDashboardReadiness(state).ready` que la bannière précédemment corrigée ; sinon il ouvre `Préparer`.
- Le statut de la page Préparer et son rafraîchissement affichent `Tout est prêt` **uniquement** si ce prédicat est vrai ; sinon `Préparation incomplète` ou `Préparation à vérifier` selon l'état des cases.
- Le bouton de lancement **dans** Préparer demeure disponible selon le contrat préexistant OBS / serveur, avec ses éventuels avertissements et confirmations serveur. Nous **n'avons ni ajouté de force, ni modifié la logique de commande**.
- Aucun nouveau propriétaire OBS/minuteur, aucune lecture de secrets. La bannière, les raccourcis et le statut de préparation ne valent pas autorisation serveur de démarrer un live.

## Qualification sur sources finales
- `SC3_AUDIT_BROWSER_TEST=1 npx vitest run tests/streamcockpit3-audit-classic-quickstart.test.ts tests/streamcockpit3-audit-classic-readiness.test.ts tests/live-control-core.test.ts --maxWorkers=2 --testTimeout=30000` : **14 PASS / 0 FAIL / 0 skipped**, trois suites ; **2 tests réels Microsoft Edge 320 px** sur états successifs, zéro requête.
- `npm run build:types` : **PASS** ; `npm run check:browser-types` : **PASS** ; `node --check apps/web/app.js` : **PASS** ; `npm run security:check` : **PASS, 6 772 fichiers** (arbre contenant aussi les travaux F05 préexistants) ; `git diff --check` : **PASS**, avertissements LF/CRLF dans les fichiers d'autres propriétaires, sans échec.
- Aucun test matériel, diffusion, OBS réel, Twitch public, package, installation, ou validation de G3–G5. Le statut UI d'un snapshot encore présent après perte silencieuse de transport n'est **pas** résolu dans ce lot.

## Suite et état des gates
- **Prochain petit lot prioritaire et indépendant :** observer la perte de socket/rafraîchissement du dashboard classique et retirer l'accès rapide `Démarrer` si le snapshot n'est plus prouvé récent ; rejouer l'état via tests réseau/browser isolés. Ne pas inventer de heartbeat ni changer le serveur sans audit du contrat.
- Restent les sujets distincts d'audit Settings/comptes, signature/versionCode Android QA et suppression historique établie par preuves.
- **F00–F10 partial, G0/G1 historiquement qualifiés, G2 in_progress, G3/G4/G5 open.** QA f15845b préservée, aucun déploiement ni publication.
