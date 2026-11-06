# SC3 AUDIT — Dashboard classique : état de diffusion après perte WebSocket

**Lot ciblé du 06/11/2026 — FIXE uniquement.** Aucun déploiement, installation, action OBS ou Twitch.

## Préflight et propriété

- Quatre documents consultés avant toute édition : `PLAN.md`, `feature-matrix.json`, `CONTINUITY.md`, `MIGRATION_TO_FIXE_20261101.md`.
- Source canonique : `C:\Users\damie\Dev\StreamCockpit-3.0-FullExperience`, branche `streamcockpit/3.0-full-experience`, origin `https://github.com/Rastaaslan/StreamDashboard.git`. HEAD initial `f42f4c4`, identique à origin avant édition ; aucun lock Git/merge/rebase/staging étranger.
- OBS et plusieurs processus StreamDashboard **constatés uniquement au niveau processus** ; aucune inspection/commande OBS/Twitch. Des processus PowerShell historiques étaient présents, mais aucun Node/Git producteur StreamCockpit concurrent identifié au contrôle.
- Cinq fichiers F05/CONTINUITY déjà modifiés par un autre propriétaire, strictement hors périmètre : `apps/mobile/control/streamcockpit-mixer-{control,page}.js`, `apps/mobile/control/streamcockpit-mixer.js`, `tests/streamcockpit3-mixer-browser.test.ts`, `docs/streamcockpit-3/CONTINUITY.md`. Aucune modification, indexation ou restauration.
- QA `f15845b` de l'utilisateur et installations/profils/secrets préservés ; pas de travaux sur laptop, dam-server, Android physique, autres dépôts, RC2 ou release.

## Défaillance et correction

L'interface Windows classique gardait le dernier état serveur et ses boutons « Démarrer », « Pause » et les libellés « TOUT EST PRÊT » / « EN DIRECT » après la fermeture du canal WebSocket. Elle ne recalculait pas la confiance dans ce snapshot lors de la déconnexion, et le simple événement `open` ne démontrait pas qu'OBS/Twitch avaient été observés de nouveau.

**Correction étroite** : `apps/web/classic-readiness.js` refuse de qualifier « prêt » ou « en direct » si le marqueur de vérification **local à l'UI** est `false`, ou si l'état OBS est inconnu. `apps/web/app.js` garde la confiance à `false` avant la réception d'un véritable `state.updated` ou d'un GET lecture seule `/api/v1/state` revenu avec succès sur **la socket active**. La fermeture révoque immédiatement la confiance, met à jour les libellés « RÉGIE À VÉRIFIER », « OBS NON VÉRIFIÉ », « TWITCH NON VÉRIFIÉ », « ÉTAT INCONNU » et supprime les actions rapides de diffusion. Sur Préparation, « Démarrer le live » est désactivé tant que le snapshot n'est pas revérifié, même si son ancien `obs.connected` était `true`. Le statut affiché ne devient pas arbitrairement « hors ligne » pour OBS/Twitch.

Sur reconnexion, le handshake WebSocket seul ne rétablit rien ; le GET de confirmation ne compte que tant que **cette connexion** est ouverte et qu'aucun `state.updated` plus récent ne l'a précédé. Une réponse retardée après fermeture est ignorée. La propriété `uiObservationTrusted` est toujours réécrite localement et ne peut pas être fournie par le serveur. Aucun changement des gardes de commande côté serveur ni de l'autorité OBS.

## Preuves exactes

- `tests/streamcockpit3-audit-classic-ws-loss.test.ts` (nouveau) + régressions classiques `streamcockpit3-audit-classic-{readiness,quickstart}.test.ts`.
- **3 suites, 13 PASS / 0 FAIL / 0 skipped** ; dont **3 vrais lancements Microsoft Edge headless à 320 px**, les WebSockets/GET du nouveau scénario sont simulés **dans Edge**, aucune requête publique ni commande OBS. Cas couverts : rendu prêt → perte → UNKNOWN, GET tardif ignoré, reconnexion OPEN non suffisante, nouveau GET rétablissant le statut, préparation désactivée pendant la perte.
- Première passe de typage après écriture : **FAIL** (`TS6133`, variable locale inutilisée dans le test nouveau). Corrigé **dans ce test uniquement**. Passe finale : `npm run build:types` PASS, `npm run check:browser-types` PASS, `node --check` des deux scripts PASS, `npm run security:check` **PASS (6 774 fichiers)**, `git diff --check` PASS (avertissements LF/CRLF sans erreur). La suite intégrale n'a pas été lancée en présence des travaux F05.
- Les résultats des tests sont des preuves logicielles, pas une réception réelle du transport réseau, d'OBS, de Twitch ou d'un Android physique.

## Limites et suite

- Le lot couvre **la perte WebSocket détectée**, pas encore la péremption d'une connexion TCP silencieusement bloquée alors que `readyState` demeure `OPEN`. Ajouter ultérieurement une date de fraîcheur et un mécanisme read-only borné de revalidation sans inventer de heartbeat ni multiplier les GET.
- Les boutons des autres pages restent protégés essentiellement par leurs commandes et gardes serveur existants ; leur désactivation complète hors ligne exige un lot d'audit distinct. Aucun déploiement et aucune installation de la QA utilisateur.
- G0/G1 historiques qualifiés ; **G2 in_progress ; G3/G4/G5 open**. Aucun passage de gate par la seule réussite des tests synthétiques.
