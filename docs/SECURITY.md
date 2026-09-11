# Sécurité

## Secrets et OAuth

Les Client IDs Twitch et Google sont **publics** et peuvent être injectés dans `resources/distribution.json` pendant le build. Aucun Client Secret OAuth n'est accepté dans le produit.

Les access/refresh tokens Twitch et Google ainsi que le mot de passe OBS sont stockés via `safeStorage` Electron dans `secure/credentials.dat`. Le fichier est écrit de façon sérialisée et atomique. Si le chiffrement OS est indisponible, l'écriture échoue au lieu de persister un secret en clair.

Les secrets ne figurent pas dans `dashboard.json`, dans l'état mobile ni dans les WebSockets distants. Les logs expurgent notamment `Authorization`, access/refresh tokens, device codes, credentials de télécommande, tickets WebSocket, états/codes OAuth et verifiers PKCE.

La migration des anciennes données transfère d'abord les secrets vers le SecretStore puis réécrit le JSON local. Les erreurs d'E/S du fichier de configuration ne sont pas silencieusement remplacées par des valeurs par défaut ; seul un JSON effectivement corrompu est mis en quarantaine.

### Twitch

Twitch utilise Device Code Grant sans redirect URI ni secret. Une session restaurée est validée par `/oauth2/validate`; un 401 déclenche au plus un refresh single-flight et un replay. Une déconnexion concurrente invalide les opérations en cours afin qu'un refresh tardif ne réinjecte pas un token.

Les nouvelles connexions demandent `channel:manage:schedule` et `channel:manage:broadcast`. Une ancienne session ne possédant que le scope planning reste utilisable pour le planning ; le préflight titre/catégorie demande explicitement une reconnexion si le scope broadcast manque.

### Google Calendar

Google utilise Authorization Code + PKCE, `state` aléatoire comparé en temps constant et callback loopback. Les scopes sont limités à `calendar.events` et `calendar.calendarlist.readonly`. Le refresh est single-flight ; un refresh token rejeté efface la session locale. Une déconnexion concurrente ne peut pas être annulée par une écriture de credentials plus lente.

## Electron

La fenêtre Electron utilise `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true` et interdit le contenu mixte. Le menu par défaut est retiré. La navigation du renderer reste sur l'origine locale StreamDashboard.

L'ouverture externe est limitée à des URL HTTPS précises : pages d'activation Twitch et `accounts.google.com` pour OAuth Google. Les URL avec userinfo sont refusées. L'IPC preload expose uniquement les actions explicitement nécessaires ; aucun canal IPC générique n'est fourni.

Le lanceur OBS n'utilise pas de shell, exige un chemin absolu dont le nom est `obs64.exe` et vérifie son existence avant lancement.

## Télécommande LAN

Le serveur reste sur loopback par défaut. Le mode LAN est explicite et demande un redémarrage.

Le modèle de confiance mobile est plus faible que celui du renderer desktop :

- seuls `health` et `capabilities` sont publics sur le LAN ;
- le pairing utilise un code aléatoire, éphémère, à usage unique et limité en tentatives ;
- le téléphone reçoit une credential propre, dont seul le hash SHA-256 est persisté sur le PC ;
- les WebSockets utilisent un ticket court à usage unique au lieu de mettre la credential longue dans l'URL ;
- la révocation invalide les tickets et coupe les sockets déjà ouvertes ;
- l'état distant est une projection minimale sans chemins locaux, comptes Google, devices, configuration OBS ou diagnostics desktop ;
- une allowlist serveur bloque `force:true`, l'enregistrement OBS, les scènes arbitraires, les Browser Sources arbitraires et l'administration de checklist ;
- les sources audio/média doivent exister dans l'état OBS avant d'être pilotées ;
- les endpoints settings, diagnostics, planning CRUD, OAuth et administration devices restent PC-only ;
- les assets desktop et overlays ne sont pas servis aux clients LAN non locaux.

Le LAN actuel est HTTP/WS et doit rester sur un réseau privé de confiance. Aucun port Internet, UPnP ou reverse proxy n'est configuré. Un futur HTTPS/reverse-proxy devra être conçu explicitement : le modèle actuel décide local/distant à partir de la socket et ne fait confiance à aucun `X-Forwarded-For`.

## PWA mobile

Le Service Worker ne s'enregistre qu'en contexte sécurisé. Il ne met en cache qu'une liste fixe d'assets statiques et refuse toute URL avec query string, afin qu'un lien de pairing contenant ID/code ne soit jamais stocké dans le cache applicatif.

## CI et distribution

Le workflow PR utilise des permissions GitHub `contents: read`, des actions épinglées sur SHA, un audit des dépendances runtime, les tests, le build TypeScript, le contrôle statique, le smoke mobile/LAN, le package Windows et un smoke de l'exécutable packagé.

Les releases officielles taguées s'exécutent dans un job séparé avec `contents: write`, exigent les secrets de signature, vérifient Authenticode avant publication et génèrent des checksums. Une release officielle non signée doit échouer.

`npm run security:check` est un garde-fou statique et ne remplace pas les tests d'intégration ni l'acceptation réelle sur Windows/OBS/Twitch/Google/Android.
