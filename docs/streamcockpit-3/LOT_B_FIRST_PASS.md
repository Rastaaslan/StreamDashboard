# Lot B — première passe F02/F08

Base : `79c7de3`. Branche exclusive : `streamcockpit/3.0-lot-b`.
État : incrément isolé implémenté, non intégré et non qualifié. Aucun test réel FIXE/laptop/Android, aucun build, aucun appel Twitch authentifié ou action publique.

## Fichiers créés par cette passe

- `integrations/twitch/src/streamcockpit-advanced.ts` : contrats, validation à la demande, sondes GET Shield Mode/AutoMod, préconditions et création de sondage.
- `apps/server/src/streamcockpit-twitch-service.ts` : contrôle d’acteur et protocole preview/confirm.
- `apps/mobile/control/streamcockpit-twitch-capabilities.js` : rendu Android autonome en lecture seule, échappement HTML, expiration des observations.
- `tests/streamcockpit3-twitch.test.ts` : 36 tests avec transport entièrement simulé.
- `docs/streamcockpit-3/LOT_B_FIRST_PASS.md` : présent rapport.

`LOT_B_TICKET.md` était déjà présent et non suivi à l’arrivée ; il reste hors commit. Aucun fichier existant modifié, matrice partagée inchangée. Ces nouveaux fichiers sont propriété exclusive du lot B ; les autres lots doivent utiliser leurs exports sans les modifier.

## Existant et choix

`integrations/twitch/src/client.ts` possède déjà injection fetch, validation de session, capabilities et modération de base. Sa liste OAuth ne contient pas les nouveaux scopes. Son transport peut renouveler et rejouer une requête après 401 ; le transport avancé séparé ne rejoue jamais les mutations. `apps/server/src/index.ts` possède l’initialisation et la validation horaire Twitch, ainsi que les routes existantes. Aucun de ces fichiers n’a été modifié.

Les scopes de lecture ou de gestion permettent la sonde GET correspondante. Le scope seul ne prouve pas le rôle modérateur : `verified` exige également une réponse GET valide de Twitch pour la chaîne et l’identité du jeton. Les scopes de gestion sont visibles, mais `mutationAvailable` reste false pour Shield/AutoMod : leurs écritures sont hors de cet incrément. Aucun historique viewer ni traitement des messages retenus AutoMod implémenté.

Sondage retenu : titre/choix/durée bornés, jeton utilisateur du diffuseur, scope `channel:manage:polls`, compte affiliate/partner, absence de sondage actif. Twitch reste l’arbitre des courses entre préflight et POST. Votes payants désactivés. Succès seulement avec réponse ACTIVE portant l’identifiant et les paramètres attendus.

Références officielles consultées le 2026-11-01 :
- https://dev.twitch.tv/docs/authentication/validate-tokens/
- https://dev.twitch.tv/docs/api/reference/#get-shield-mode-status
- https://dev.twitch.tv/docs/api/reference/#get-automod-settings
- https://dev.twitch.tv/docs/api/reference/#create-poll

## Contrat de branchement pour l’intégrateur

1. Instancier côté serveur `AdvancedTwitch(credentialsProvider, fetchApi, clock?)`. Le provider retourne clientId/accessToken/broadcasterId depuis la session existante. Aucun accès au stockage de secrets dans le module. Ne jamais exposer cet objet ou le résultat interne de `pollPreflight()` aux clients : ils contiennent le contexte de session.
2. Instancier une seule `StreamcockpitTwitchService` pour cette autorité de commandes. Les routes futures appellent uniquement `capabilities`, `previewPoll`, `confirmPoll`. L’acteur `{id, canRead, canInteract}` doit être dérivé de l’authentification et des permissions serveur, jamais du JSON client. Les protections existantes de transport, origine/CSRF et identité doivent envelopper ces futurs handlers. Aucune route n’est enregistrée par ce lot.
3. `capabilities(actor)` renvoie broadcasterId, checkedAt, validUntil, shield et automod. Les états sont verified/missing-scope/unauthorized/forbidden/rate-limited/unavailable ; une validation globale en erreur lève `AdvancedTwitchError`. Remplacer immédiatement toute ancienne observation par un état absent/erreur ; ne pas conserver un ancien vert après échec. Ne pas renvoyer de jeton au mobile.
4. `previewPoll(actor, {title, choices: string[], duration})` vérifie les préconditions sans mutation et renvoie confirmationId, expiresAt, broadcasterId, draft et avertissement de démarrage immédiat. Afficher la chaîne, la question, tous les choix et la durée avant confirmation explicite. `confirmPoll(actor, confirmationId, true)` utilise exclusivement le draft conservé côté serveur. Il revalide OAuth et les préconditions, consomme l’identifiant avant tout await et retourne `{status:'confirmed', pollId, broadcasterId}` si Twitch confirme.
5. Mapper les erreurs structurées sans faux succès : unauthorized (401), forbidden (403), rate-limited (429 avec retryAfter si fourni), unavailable, precondition, invalid et uncertain. Un POST interrompu, une réponse 5xx ou un succès malformé signifie uncertain : vérifier dans Twitch avant toute nouvelle tentative. Aucun retry automatique ni renouvellement OAuth dans ce module.
6. Charger le module UI puis appeler `renderTwitchCapabilities(container, snapshot)` ; rappeler le rendu lors des mises à jour, des erreurs et au plus tard à validUntil (60 s maximum). Le composant n’installe aucun minuteur, listener ou fetch. Il ne lance aucune action ; aucun écran de confirmation sondage n’est encore branché. Ajouter l’asset au packaging par l’intégrateur, sans modifier les fichiers de ce lot.
7. Étendre ultérieurement le consentement OAuth existant avec les scopes nécessaires seulement. Conserver la validation au démarrage/horaire existante en plus des validations à la demande.

## Vérifications réellement exécutées

- `node_modules/.bin/vitest run tests/streamcockpit3-twitch.test.ts --maxWorkers=1` : échec avant tests, EROFS dans node_modules/.vite-temp (dépendances partagées en lecture seule).
- `node_modules/.bin/vitest run tests/streamcockpit3-twitch.test.ts --maxWorkers=1 --configLoader runner` : 36/36 PASS, un fichier, environ 187 ms sur la dernière exécution (34 tests lors de la première exécution réussie, puis deux scénarios supplémentaires).
- `node_modules/.bin/tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck integrations/twitch/src/streamcockpit-advanced.ts apps/server/src/streamcockpit-twitch-service.ts tests/streamcockpit3-twitch.test.ts` : PASS.
- `node --check apps/mobile/control/streamcockpit-twitch-capabilities.js` : PASS.
- `git diff --check` : PASS.

Couverture : scopes absents/read/manage, identité de modérateur, mauvais client/token expiré, 401/403/429/503, réseau absent, réponses malformées, paramètres invalides, non-éligibilité, sondage actif, permission locale, refus sans confirmation, acteur différent, draft altéré, expiration, double confirmation concurrente, scopes révoqués entre preview/confirm, changement de compte pendant POST, rendu échappé et périmé. Tous les transports sont des mocks ; aucune preuve de parcours réel.

## Limites et gates restantes

Confirmations en mémoire (maximum 100, expiration 60 s ou expiration du jeton) : invalidées au redémarrage. Anti-rejeu limité à cette instance et à ce confirmationId ; pas de journal durable ni réconciliation automatique des résultats incertains. Un nouveau preview constitue une nouvelle intention, pas un retry idempotent. Ne pas déployer plusieurs instances de commande. L’intégration devra fournir journal/receipts durables et procédure de réconciliation avant qualification.

L’UI ne prouve pas la mise en page/tactile sur Android ; seuls les exports de rendu sont testés. Pas de test HTTP monté, de packaging ou de déconnexion matérielle. F02/F08 restent partiels ; G1 n’est pas déclaré clos et G2–G5 restent à démontrer. La consultation de documentation publique est le seul réseau externe utilisé dans cette passe ; ni installation utilisateur ni OBS/Twitch réel ni secrets manipulés.
