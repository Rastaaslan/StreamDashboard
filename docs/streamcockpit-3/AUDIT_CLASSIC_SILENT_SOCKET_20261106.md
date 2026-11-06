# SC3 Audit — Perte silencieuse du temps réel sur l'interface Windows classique

**06/11/2026, passage FIXE uniquement.** Source sur branche canonique `streamcockpit/3.0-full-experience`, HEAD initial `e7656ac`, origin `https://github.com/Rastaaslan/StreamDashboard.git`. Ce correctif de source n'est pas déployé et ne modifie pas la QA `f15845b`.

## Préflight, coordination et limites de propriété

Les quatre documents `PLAN.md`, `feature-matrix.json`, `CONTINUITY.md`, `MIGRATION_TO_FIXE_20261101.md` ont été consultés avant toute écriture. Branche et origin confirmés, aucun index.lock ou merge/rebase relevé, pas de processus Node/Git de développement concurrent. OBS et StreamDashboard QA observés uniquement comme processus, sans requête ni contrôle. Charge CPU système relevée autour de 17 % au préflight.

Les cinq fichiers non commis du lot F05 et le journal `CONTINUITY.md` demeurent la propriété d'un autre chantier : `apps/mobile/control/streamcockpit-mixer-{control,page}.js`, `apps/mobile/control/streamcockpit-mixer.js`, `tests/streamcockpit3-mixer-browser.test.ts`, `docs/streamcockpit-3/CONTINUITY.md`. Aucun de ces fichiers n'a été édité, restauré ni indexé.

## Défaut reproduit et correction unique

Dans `apps/web/app.js`, un WebSocket pouvait conserver `readyState=OPEN` alors que plus aucune trame n'arrivait, par exemple lors d'une interruption TCP silencieuse. Le dernier snapshot signé localement `uiObservationTrusted=true` continuait d'afficher **« TOUT EST PRÊT »** et de proposer le raccourci **« Démarrer »**, sans limite d'âge.

**RED démontré dans Microsoft Edge headless 320 px** : après une avance d'horloge monotone simulée de 46 secondes sans nouvelle observation, la page conservait `✓ TOUT EST PRÊT` alors que le nouveau test exigeait `RÉGIE À VÉRIFIER` (**0 PASS / 1 FAIL**).

**Correction ciblée** dans le canal de l'interface classique, sans modifier API, route serveur ou garde OBS/Twitch :
- Toute vérification d'état (`state.updated` reçu ou GET authentifié) marque son âge via `performance.now()`, non une horloge murale.
- Au-delà de **45 secondes** sans confirmation, le statut UI devient **non vérifié**, les libellés OBS/Twitch/live sont invalidés et le démarrage rapide est retiré, même si la socket prétend toujours être ouverte.
- Au plus **un GET de vérification en vol**, et jamais plus d'un nouveau probe toutes les **20 secondes** ; `/api/v1/state` est demandé avec `cache: 'no-store'`, sans POST, WS ping inventé ni nouvelle autorité OBS. Le contrôle périodique local est de 5 secondes.
- Une réponse GET tardive ne peut pas écraser un `state.updated` plus récent, ni revivifier un ancien canal fermé/remplacé. Le timer de cette connexion est détruit à la fermeture.
- Une réponse GET authentifiée et fraîchement reçue peut restaurer l'indicateur uniquement si le même canal est encore ouvert et si aucune notification WS plus récente n'a été observée. Un échec conserve le statut non vérifié.

## Qualification exacte

- Test nouveau `tests/streamcockpit3-audit-classic-silent-connection.test.ts` : vraie session Edge 320 px ; avance de temps synthétique, GET isolés dans le navigateur, borne anti-doublons, récupération, exclusion d'une réponse obsolète et nettoyage à la fermeture. Un test unitaire distinct exécute le vrai wrapper `request()` et confirme `cache: 'no-store'` pour `/api/v1/state` et `cache: 'default'` pour les autres GET.
- Après correction : **4 suites, 15 PASS / 0 FAIL / 0 skipped**, dont **4 scénarios Microsoft Edge 320 px**. Une passe intermédiaire sur code corrigé avait **13 PASS / 1 FAIL** en raison du test nouveau qui ne vidait pas entièrement les microtâches de `.finally()` ; corrigé dans le test uniquement par une attente d'un tour de boucle événementielle. Après ajout du test de cache, une autre passe intermédiaire avait **14 PASS / 1 FAIL** : le harnais de test omettait sa constante `REQUEST_TIMEOUT_MS` ; corrigé uniquement dans le harnais.
- `npm run build:types` PASS, `npm run check:browser-types` PASS, `node --check apps/web/app.js` et `classic-readiness.js` PASS, `npm run security:check` PASS (**6 775 fichiers**), `git diff --check` PASS (avertissements LF/CRLF non bloquants sur fichiers étrangers).
- Pas de suite intégrale, build de distribution, signature, installation, état réel OBS/Twitch, Android physique ni tests de panne de réseau réelle. Les requêtes et WebSockets des tests Edge sont simulés localement.

## Suite et gates

Il reste à tester en conditions matérielles une perte TCP silencieuse/veille Windows ou Android, le comportement des onglets masqués et de reprise, et à distinguer les snapshots anciens côté serveur si l'observateur amont cesse lui-même de produire des observations. Les boutons des autres vues ne sont pas tous invalidés dès la perte ; les gardes serveur restent indispensables. Aucun changement automatique des comptes, minuteurs ou sessions.

G0/G1 historiquement qualifiés ; **G2 in_progress, G3–G5 open**. Aucune nouvelle candidate de livraison ou bascule utilisateur.
