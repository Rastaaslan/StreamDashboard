# F09 — repère manuel authentifié sur FIXE (01/11/2026, 22:19 CET)

## Portée réellement implémentée dans les sources
- Nouveau `POST /api/v1/streamcockpit-moments/manual/add` (router dédié) ; aucune commande OBS/Twitch, pas de diffusion, pas de création de session sur mobile ni nouveau stockage.
- `apps/server/src/index.ts` restreint le routeur au rôle FIXE Windows `obs-executor`, à `obsEnabled` et `timerAuthority` actifs, à une sortie OBS connectée et `streamingKnown===true`, et à la session **de live non programmé** suivie par l'hôte (les lives programmés sans ID sûr restent refusés). Le descriptif matériel doit être valide ; sinon refus.
- Appareils associés : autorisation `observe` + `clips`, recontrôlée avant la lecture de session, avant la transaction et après sa résolution. Les clients ne peuvent fournir ni `sessionId`, ni horodatage, ni provenance. Corps strict `{requestId: UUIDv4, title}`.
- Horodatage issu exclusivement de l'horloge serveur FIXE, `source:manual`, `status:observed`, et corrélation SHA-256 du couple `[acteur authentifié, requestId]`.
- `MomentsPipeline.recordHostManual` écrit par CAS durable via le stockage existant. Le même identifiant retrouve la date originale et le même événement ; conflit de titre/session refusé. Un échec de COMMIT peut avoir enregistré le repère : 503 `MOMENTS_WRITE_UNCERTAIN`, aucun renvoi silencieux.
- API `GET/HEAD` de consultation inchangée. Pas de repère automatique OBS/Twitch/Streamlabs à ce stade.

## Preuves sur FIXE (environnement de développement, non production)
- 22:11 CET : nouveau routeur HTTP et tests de journal, Vitest 35 PASS / 6 POSIX skipped / 0 FAIL (2 fichiers, exit 0).
- 22:15 CET : famille F09 étendue, Edge headless 320px activé, Vitest 66 PASS / 6 POSIX skipped / 0 FAIL (8 fichiers, exit 0). La suite de tests F09 a ensuite été éditée par un autre intervenant : ne pas attribuer ces chiffres à la version finale sans un nouveau run.
- 22:18 CET : suite *distincte* `streamcockpit3-moments-manual-guard.test.ts`, **4/4 PASS**, avec réouverture de SQLite Windows et vérification de rejeu/horodatage/CA-S (exit 0).
- `npm run build:types` exit 0, `npm run check:browser-types` exit 0, `npm run security:check` exit 0 (807 fichiers) pendant le passage. Contrôles à répéter après intégration des fichiers d'interface concurrents.
- Tests matérielles, coupure électrique, APK signé et vraie écriture pendant live non effectués. G0/G1 inchangés, G2 `in_progress`, G3–G5 `open` ; F09 `partial`.

## Frontière des propriétaires
Un autre chantier sur la même branche ajoutait simultanément `apps/mobile/control/streamcockpit-moments-manual.js`, les tests navigateur/UI et des modifications F00 d'horloge maître. Ces fichiers et les sources de build générées ne sont pas revendiqués par ce passage backend ; un seul propriétaire par fichier. Ne jamais utiliser `git add -A` pour intégrer sans revue les travaux concurrents. Aucun accès à dam-server, aucune installation ni RC publiée.
