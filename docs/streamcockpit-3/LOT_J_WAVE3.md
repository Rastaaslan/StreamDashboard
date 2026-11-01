# Lot J — vague 3, capacités Twitch serveur

Base `81b8878`, branche `streamcockpit/3.0-lot-j`, worktree Lot J seulement. F00–F10 restent PARTIAL ; G2 en cours, G3–G5 OPEN. Incrément de lecture implémenté, validation HTTP bloquée par le sandbox, aucune qualification matérielle.

## Fichiers

- `apps/server/src/index.ts` : instance avancée alimentée par la session en mémoire du client Twitch existant, transport lié à l’arrêt serveur, route montée après les gardes remote et rôle, avant l’initialisation Twitch historique.
- `apps/server/src/remote-api-policy.ts` : GET/HEAD `/v1/twitch/advanced/capabilities`, permission `chat`. Aucune nouvelle mutation dans les allowlists.
- `apps/server/src/streamcockpit-twitch-router.ts` : identité issue de RemoteAuth ou du transport local de confiance ; lecture Shield/AutoMod ; nouvelle vérification identité/permission/rôle avant réponse ; no-store, erreurs génériques et état unknown. Aucun token ni message brut Twitch dans les erreurs.
- `tests/streamcockpit3-twitch-integration.test.ts` : routeur Express en mémoire avec véritable RemoteAuth et module avancé, transport Twitch simulé.
- `tests/streamcockpit3-twitch-integration-http.test.ts` : mêmes scénarios sur socket et test du point d’entrée serveur réel sur données temporaires ; à rejouer dans un environnement autorisant loopback.
- Le présent rapport. Ticket préexistant exclu ; matrice et CONTINUITY inchangées.

## Audit et choix de périmètre

Lecture préalable de PLAN, CONTINUITY, matrice et rapports A–H. RemoteAuth stocke les empreintes des credentials Device, associe les permissions via pairing serveur et vérifie révocation. Le middleware remote vérifie identité, permission et allowlist ; le middleware rôle consulte le descripteur hôte. La nouvelle route réutilise ces gardes et relit la permission chat après les appels asynchrones. Aucun droit issu du JSON mobile. Le transport local existant fait confiance au loopback non TLS : `local-host` décrit cette autorité locale, pas une identité personnelle nouvellement authentifiée.

Le garde Origin existant accepte l’absence d’Origin, les origines Android natives et le host courant. Il ne fournit pas à lui seul un protocole de confirmation CSRF complet lié à un utilisateur local. Il est conservé sans élargissement. Les POST poll preview/confirm ne sont donc PAS exposés. Le lot B conserve son protocole interne et ses tests, avec confirmation explicite, identité du diffuseur, scope de gestion, consommation avant await et refus de rejeu du confirmationId, mais confirmations en mémoire seulement, sans journal durable/réconciliation. Ces limites et l’absence de preuve HTTP complète empêchent leur branchement dans cette passe.

`TwitchClient.api` renouvelle et rejoue après 401, y compris une mutation. La nouvelle route utilise directement AdvancedTwitch avec runtimeFetch, sans retry/refresh. Elle ne passe pas par ce transport historique. La session courante est relue, les scopes sont validés à la demande, le rôle modérateur est éprouvé par GET Shield/AutoMod. Changement de token/chaîne, déconnexion ou expiration invalide la réponse. Aucun cache de succès conservé par le routeur. Les statuts partiels forbidden/rate-limited/unavailable restent visibles dans chaque capacité ; une erreur globale donne unknown avec HTTP 401/403/429/503.

Le consentement OAuth historique REQUESTED_SCOPES ne demande pas les scopes Shield/AutoMod/polls. Il reste inchangé (client hors propriété du lot). Un jeton sans ces scopes affiche missing-scope ; aucun scope n’est inventé ni demandé automatiquement. Un consentement explicite futur est nécessaire. Aucun accès opérateur aux secrets en clair ; le code utilise seulement l’interface de session existante à l’exécution, jamais un secret dans un retour HTTP.

## Commandes et preuves

Toutes exécutées sous nice 15 / ionice idle hérités, un worker Vitest, aucun npm install ni build Windows/APK. Logs sous `/tmp/lot-j-*`.

| Commande | Sortie / résultat |
|---|---|
| `node node_modules/vitest/vitest.mjs run tests/streamcockpit3-twitch-integration.test.ts tests/streamcockpit3-twitch.test.ts tests/mobile-remote-api-policy.test.ts --maxWorkers=1 --configLoader runner --no-cache` | Interrompue, 130 ; pool forks sans résultat exploitable. |
| Même lancement avec `tests/twitch-chat-routes.test.ts` et `--pool=threads`, avant séparation des tests HTTP | Interrompu, 130 ; EPERM des tests HTTP constaté, aucune réussite globale revendiquée. |
| `node node_modules/vitest/vitest.mjs run tests/streamcockpit3-twitch-integration.test.ts tests/streamcockpit3-twitch.test.ts tests/mobile-remote-api-policy.test.ts --maxWorkers=1 --configLoader runner --no-cache --pool=threads` | **0 ; 117/117 PASS**, trois fichiers. `/tmp/lot-j-memory.log`. |
| `node node_modules/vitest/vitest.mjs run tests/streamcockpit3-twitch-integration-http.test.ts --maxWorkers=1 --configLoader runner --no-cache --pool=threads` | **1 ; 12 échecs, 1 PASS**. Tous les échecs : `listen EPERM: operation not permitted 127.0.0.1`. `/tmp/lot-j-http.log`. Ce ne sont pas des preuves e2e réussies. |
| `npm run build:types` (initial puis final) | **0**, typage global sans émission. |
| `npm run security:check` | **1**, IPC CLI tsx interdit : `listen EPERM /tmp/tsx-1000/28.pipe`. |
| `node --import tsx scripts/security-check.ts` | **0**, même contrôle sans IPC CLI, 646 fichiers. |
| `git diff --check` | **0**. |

Tests en mémoire : absence d’identité, permissions insuffisantes malgré JSON forgé, refus mutations, HEAD/GET, no-store, absence de secret et de déclaration live, révocation pendant lecture, déconnexion session, scopes absents, 401 sans retry, 403/429/503, réponse malformée, panne réseau. Les tests du lot B couvrent également les confirmations concurrentes et résultats incertains du protocole interne. La non-régression HTTP modération existante reste non validée ici ; aucun handler historique modifié.

## Branchages non faits

Pas d’UI mobile branchée, de nouveau consentement OAuth, de POST poll preview/confirm, de journal durable, de réconciliation ni de mutations Shield/AutoMod. Prédictions, raids, shoutouts, historique viewer et traitement des messages retenus AutoMod restent absents. Une capacité verified décrit une lecture autorisée, jamais une preuve de diffusion publique ; aucune interprétation de output active comme live.

Aucun appel Twitch/OBS réel dans les tests, aucun appareil utilisateur modifié, aucune deuxième régie ni minuteur. Tests HTTP/auth/Origin sur socket à reprendre, puis parcours FIXE/laptop/Android et revocation/reconnexion réels. Aucun push ou déploiement. Ce lot ne prétend pas satisfaire l’intégralité F02/F08.

## Commit bloqué

`git add apps/server/src/index.ts apps/server/src/remote-api-policy.ts apps/server/src/streamcockpit-twitch-router.ts tests/streamcockpit3-twitch-integration.test.ts tests/streamcockpit3-twitch-integration-http.test.ts docs/streamcockpit-3/LOT_J_WAVE3.md` : **code 128**. Git ne peut créer `/srv/storage/nvme-archives/2026-10-30/dashboard-history/StreamDashboard-Next-work/.git/worktrees/StreamCockpit-3.0-Lot-J/index.lock` : `Read-only file system`. Les métadonnées Git du worktree sont hors racine inscriptible, les approbations sont interdites dans cette session. Aucun contournement ni modification hors worktree tenté. **Aucun commit créé** ; changements disponibles dans le worktree pour l’intégrateur, ticket toujours hors staging.
