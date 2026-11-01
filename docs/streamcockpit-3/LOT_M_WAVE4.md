# Lot M — wave4 : santé OBS observée en lecture seule

2026-11-01. Base `b242696`, branche `streamcockpit/3.0-lot-m`, worktree `/home/damien/StreamCockpit-3.0-Lot-M`. PLAN, matrice, CONTINUITY et documentation des vagues précédentes consultés. **F01 reste partiel ; G2 in_progress, G3–G5 open.** Aucune qualification matérielle ni livraison finale.

## Fichiers livrés

- `apps/server/src/index.ts` : quatre lignes ajoutées pour créer un enregistreur local, lui transmettre la notification existante et le fournir à la route santé.
- `apps/server/src/streamcockpit-health/host-adapter.ts` : projection de cette preuve uniquement pour l'identité Windows activée `obs-executor`.
- `apps/server/src/streamcockpit-health/obs-observation.ts` : nouveau cache de réception privé, dates serveur, contrôle d'horloge, copie des seuls champs autorisés.
- `tests/streamcockpit3-health-observation.test.ts` : preuves, identités, expiration et horloges.
- `tests/streamcockpit3-health-observation-hook.test.ts` : vrai `ObsClient` avec transport factice, branchement structurel de l'entrypoint.
- `tests/streamcockpit3-health-observation-http.test.ts` : routeur en mémoire avec `RemoteAuth` réel et variante HTTP loopback.
- Le présent rapport. `LOT_M_TICKET.md` préexistant est exclu du staging.

Aucun changement mobile, agent, autre test, package.json, feature-matrix.json ou CONTINUITY.md.

## Audit et branchement réel

`integrations/obs/src/client.ts` ne fournit pas de date dans `state`. Lire `obs.state.connected` lors d'un GET ne constitue donc pas une mesure datée. Son abonnement `onStateChanged` fournit en revanche un point de réception local fiable :

- `connect` publie connected après connexion et lectures OBS confirmées ; l'état intermédiaire connecting n'est pas une connexion confirmée.
- `doRefresh` notifie seulement si génération et révision sont encore courantes ; le heartbeat **déjà existant** rafraîchit toutes les dix secondes.
- Les handlers scène/stream/record/audio notifient après réception d'événements du socket courant et vérification de disponibilité.
- `invalidate`/`clearLiveState` notifient la perte de disponibilité locale du transport après fermeture, erreur, timeout ou reconfiguration. `offline` signifie ici transport local invalidé, pas preuve d'arrêt de l'application OBS ou du live.
- Les résultats d'une ancienne génération sont rejetés par le client existant. Le cache santé n'ajoute ni reconnexion ni retry.

L'enregistreur est appelé **au début de l'abonnement serveur existant**, avant ses autres consommateurs. Il n'y a aucun nouvel abonnement, socket, polling, commande, autorité de régie ou minuteur. Les autres comportements historiques de cet abonnement (dont autoStartReplay) ne sont ni ajoutés ni modifiés par ce lot. Aucun serveur de production n'a été démarré pendant la mission.

La route existante `/api/v1/streamcockpit-health` consomme le même enregistreur en mémoire. Le garde d'identité/capacité `observe`, GET/HEAD seulement, no-store, whitelist de réponse et erreurs génériques restent ceux du module existant. L'entrypoint conserve ses refus `obsEnabled:false` et `timerAuthority:false`. Aucun endpoint d'ingestion ni champ JSON client ne peut alimenter ce cache. Le test de type runtime refuse notamment une copie sérialisée ou un objet avec provenance/date forgées ; ce n'est pas une attestation cryptographique contre du code malveillant exécuté dans le processus serveur.

## Sémantique et UX

Une réception `connected:true` avec statut `connected` produit connected/healthy. Une réception `connected:false` avec statut `offline` ou `error` produit disconnected/critical. Connecting ou incohérence efface la preuve et reste UNKNOWN. Une lecture n'invente jamais une première réception, ne met pas à jour observedAt et n'efface pas une expiration.

Le moteur santé canonique reste l'unique calcul de fraîcheur : au-delà de 15 000 ms, la preuve devient UNKNOWN/stale tout en conservant dates et provenance. Une déconnexion observée expire elle aussi ; aucun rouge éternel ni ancien vert réhabilité par un simple GET. Une reconnexion nécessite une nouvelle notification confirmée.

Les dates observedAt et receivedAt sont celles de la réception dans l'horloge serveur. Un contrôle par temps monotone détecte recul, valeur non finie, erreur de lecture ou dérive cumulée supérieure à la tolérance existante de 2 s. Un défaut détecté invalide le cache jusqu'au redémarrage du runtime, y compris après un autre événement. Ce contrôle ne crée aucun timer et n'est pas une deuxième horloge de session. Il ne certifie pas l'heure UTC absolue d'un serveur initialement mal réglé. Une horloge globale non exploitable peut aussi provoquer le 503 générique du routeur existant ; elle ne peut justifier un état sain.

Dans le panneau Santé existant, le diagnostic OBS peut désormais afficher connexion confirmée, déconnexion ou preuve périmée avec dates et provenance. Aucun champ streaming/live/scène, erreur brute, URL, token ou mot de passe n'est retenu. Une connexion OBS n'est pas une preuve de diffusion Twitch. Micro/DJI/sync restent UNKNOWN, le diagnostic Twitch existant reste inchangé. Pas de modification visuelle, de nouvelle commande utilisateur ni de validation tactile effectuée.

## Commandes exactes et preuves

Toutes les vérifications ci-dessous utilisent nice 15 / ionice idle, un seul worker Vitest simultané. Aucun npm test global, build Windows/APK, installation ou téléchargement.

| Commande | Code | Résultat |
|---|---:|---|
| `nice -n 15 ionice -c 3 node node_modules/vitest/vitest.mjs run tests/streamcockpit3-health-observation*.test.ts tests/streamcockpit3-health.test.ts tests/streamcockpit3-health-api.test.ts --maxWorkers=1 --configLoader runner --no-cache` | 1 | 29 PASS, 1 FAIL, 1 skipped. Fixture de recul de 1 ms corrigée : elle avançait de 100 ms sans lecture intermédiaire et ne simulait donc pas un recul observable. |
| `nice -n 15 ionice -c 3 node node_modules/vitest/vitest.mjs run tests/streamcockpit3-health-observation*.test.ts tests/streamcockpit3-health.test.ts tests/streamcockpit3-health-api.test.ts tests/mobile-remote-api-policy.test.ts --maxWorkers=1 --configLoader runner --no-cache` | 0 | **99 PASS, 1 skipped, 6 fichiers.** |
| `nice -n 15 ionice -c 3 npm run build:types` | 0 | TypeScript global sans émission PASS. |
| `nice -n 15 ionice -c 3 npm run security:check` | 1 | Lanceur tsx bloqué avant analyse, `listen EPERM /tmp/tsx-1000/30.pipe`. |
| `nice -n 15 ionice -c 3 node --import tsx scripts/security-check.ts` | 0 | Même script sans IPC CLI : PASS, 664 fichiers. |
| `nice -n 15 ionice -c 3 git diff --check` | 0 | Aucun diagnostic whitespace. |

Logs : `/tmp/lot-m-tests.log`, `/tmp/lot-m-tests-final.log`, `/tmp/lot-m-types.log`, `/tmp/lot-m-security.log`, `/tmp/lot-m-security-direct.log`.

La variante HTTP tente réellement `listen(0, '127.0.0.1')` ; EPERM du sandbox déclenche un skip explicite, uniquement pour cette erreur. **Aucune preuve HTTP sur socket n'est revendiquée.** La variante en mémoire exécute le vrai routeur Express, pairing/permissions/révocation via RemoteAuth, refus des mutations, HEAD, no-store, absence de secret, expiration et déconnexion. Les requêtes santé ne font aucun fetch externe. Les permissions de l'allowlist existante sont vérifiées sans les modifier.

Le test du client OBS utilise le vrai code client avec `obs-websocket-js` factice : connexion confirmée, refresh, réception d'événement, perte pendant un résultat en attente, événement de l'ancien socket ignoré, reconnexion. Seules des lectures Get* atteignent le transport factice ; dix lectures santé ne changent ni les appels RPC ni le nombre de timers. Les timers du client sont nettoyés à l'arrêt. Pas de commande OBS/Twitch réelle.

## Limites et suite

Le branchement existe dans le code serveur, pas dans une installation FIXE déployée. Le hook est testé avec transport factice et son placement dans index.ts est contrôlé structurellement ; le serveur complet n'a pas été exercé sur socket dans ce sandbox. Reprendre les tests HTTP puis les parcours FIXE/laptop/Android : association observe, révocation, perte/reconnexion, veille/horloge, expiration visuelle. Une correction d'horloge détectée peut nécessiter le redémarrage du runtime pour rétablir la preuve.

Le descripteur Windows obs-executor reste l'autorité d'identité existante : aucune attestation physique supplémentaire du FIXE n'est inventée. Aucun raccordement à l'Agent autonome ni nouvelle mesure micro/DJI/sync, notification persistante, qualification d'encodage ou confirmation de live public. RC2, installations et données utilisateur non modifiées ; aucun push/deploy.

## Staging/commit bloqué — aucun contournement

Commande exécutée :

```sh
nice -n 15 ionice -c 3 git add apps/server/src/index.ts apps/server/src/streamcockpit-health/host-adapter.ts apps/server/src/streamcockpit-health/obs-observation.ts tests/streamcockpit3-health-observation.test.ts tests/streamcockpit3-health-observation-hook.test.ts tests/streamcockpit3-health-observation-http.test.ts docs/streamcockpit-3/LOT_M_WAVE4.md
```

Code **128**, avant staging :

```text
fatal: Unable to create '/srv/storage/nvme-archives/2026-10-30/dashboard-history/StreamDashboard-Next-work/.git/worktrees/StreamCockpit-3.0-Lot-M/index.lock': Read-only file system
```

**Aucun commit créé.** Aucun contournement du montage, changement de permissions ou autre dépôt utilisé. Les sept fichiers restent disponibles dans le worktree pour revue et intégration ; le ticket reste non suivi et exclu. `git diff --check` final : code 0. Matrice et CONTINUITY inchangées.
