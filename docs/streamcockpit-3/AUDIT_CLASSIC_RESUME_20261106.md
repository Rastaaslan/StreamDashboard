# StreamCockpit 3.0 — reprise d'un onglet Windows classique sans statut périmé

**Lot de maintenance du 06/11/2026, FIXE uniquement ; aucune livraison.** Source canonique branche `streamcockpit/3.0-full-experience`, préflight PLAN.md, feature-matrix.json, CONTINUITY.md et MIGRATION_TO_FIXE_20261101.md effectué. HEAD initial `9613244`, origin `Rastaaslan/StreamDashboard`, aucun `index.lock`/merge/rebase. OBS et StreamDashboard QA observés comme processus sans interaction. Aucun autre écrivain actif identifié au préflight.

## Défaut reproduit

Le dashboard classique utilisait un intervalle de cinq secondes pour expirer une observation de plus de 45 secondes. Les navigateurs peuvent suspendre cet intervalle quand l'onglet est masqué : au retour à l'écran, la bannière affichait encore `✓ TOUT EST PRÊT` et le raccourci de démarrage avant le prochain tick. RED reproduit avec un vrai Microsoft Edge 320 px, une reprise et 46 secondes de temps monotone simulé : **0 PASS / 1 FAIL**.

## Correction bornée

Dans `apps/web/app.js` uniquement : extraction du contrôle existant en `checkObservation()` ; invocation immédiate au retour visible (`visibilitychange`) ou `pageshow` après BFCache, sans attente d'un timer. Les observations expirées désactivent l'état « prêt » et le raccourci de démarrage avant nouvelle preuve. L'expiration incrémente la révision des observations afin qu'un GET lancé avant suspension ne puisse réactiver un état ancien. Les abonnements sont retirés au close ; fréquence anti-doublon 20 secondes, un GET en vol, timeout et une seule autorité OBS inchangés. Aucun POST ou commande Twitch/OBS.

## Qualification exacte

- Test nouveau `tests/streamcockpit3-audit-classic-resume.test.ts` sur **Microsoft Edge réel headless 320 px**, horloge/reprise simulées et sans réseau : vérifie « READY » initial, expiration immédiate sans exécution de l'intervalle, GET unique après reprise, récupération après GET récent, refus d'un GET lancé avant suspension, `pageshow` et nettoyage des listeners à la fermeture.
- Campagne finale ciblée cinq suites : **16 PASS / 0 FAIL / 0 skipped**, dont cinq parcours Edge ; RED initial bien enregistré avant correction.
- Première passe de compilation après tests : **FAIL** sur variable de harnais `nextId` inutilisée ; supprimée sans toucher au comportement. Reprise complète finale : `npm run build:types` **PASS**, `npm run check:browser-types` **PASS**, `node --check apps/web/app.js` **PASS**, `npm run security:check` **PASS (6 776 fichiers)**, `git diff --check` **PASS** (warnings LF/CRLF non bloquants sur fichiers étrangers).
- F05/CONTINUITY, ses trois modules du mixeur et son test Edge : **aucune édition ou inclusion dans le commit**. Aucun build d'installation, signature, migration ni modification de QA `f15845b` ou profils utilisateur.

## Limites et suite

La suspension et le temps sont simulés dans Edge. Pas de vraie veille Windows/Android, coupure TCP physique, certification des snapshots serveur, observation OBS/Twitch publique ou validation trio matériel. Une requête réseau en vol peut retarder un nouveau GET ; le statut demeure non vérifié jusqu'à une observation acceptée. Poursuivre l'audit du statut côté serveur et des commandes des autres vues, puis réception G3 sur matériel autorisé. **G2 in_progress, G3–G5 open.**
