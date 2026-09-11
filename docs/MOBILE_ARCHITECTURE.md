# Architecture de la télécommande mobile

## Principe

Le PC reste le hub maître : **Android/iOS → protocole StreamDashboard → API PC → core → OBS/Twitch/Google**. Le téléphone ne contacte jamais OBS, Twitch ou Google et ne reçoit jamais leurs credentials.

`packages/contracts` reste la source des structures partagées. Le mobile reçoit toutefois une **projection réduite** (`RemoteDashboardState`) : il n'a pas besoin de connaître les chemins Windows, la configuration OAuth, les calendriers Google, les appareils appairés ou les diagnostics internes.

## Transport et mode LAN

Le serveur reste lié au loopback par défaut. L'activation **Télécommande LAN** est explicite et nécessite un redémarrage afin que le bind réseau soit clair et auditable.

Le mode actuel utilise HTTP/WS sur réseau local privé. Il ne configure ni UPnP, ni port Internet, ni reverse proxy. Un futur HTTPS devra être conçu explicitement avant support, notamment parce que la distinction local/distant repose actuellement sur l'adresse de la socket et ne fait confiance à aucun header proxy.

La télécommande web est servie sous `/mobile/`. En HTTP LAN elle fonctionne comme application web. L'installation PWA et le Service Worker ne sont activés qu'en contexte sécurisé HTTPS.

## Pairing implémenté

1. Le desktop crée un challenge aléatoire court, temporaire et à usage unique.
2. Le PC affiche ID/code et les URL LAN candidates.
3. Le téléphone échange le challenge contre une credential aléatoire propre à l'appareil.
4. Seul le hash SHA-256 de cette credential est persisté sur le PC.
5. Pour ouvrir un WebSocket, le téléphone échange d'abord sa credential contre un ticket court à usage unique.
6. La révocation d'un appareil invalide ses tickets et ferme immédiatement ses sockets existantes.

Les tentatives de pairing sont limitées ; les compteurs expirés sont nettoyés pour ne pas croître indéfiniment.

## Autorisation par commande

Le mobile ne bénéficie pas des mêmes privilèges que le renderer desktop. L'allowlist serveur autorise uniquement les usages nécessaires :

- Préparer ;
- Start sans `force:true` ;
- Stop ;
- modes Intro/Live/Pause/End configurés ;
- timer start/pause/reset/+temps ;
- mute et volume dB de sources OBS réellement détectées ;
- redémarrage de médias OBS réellement détectés.

Sont notamment refusés : scène arbitraire, enregistrement OBS, Browser Source arbitraire, bypass de checklist et administration de la checklist.

## État temps réel

Le desktop et le mobile utilisent le même `DashboardCommandService`, mais pas le même niveau d'information. Les sockets distantes reçoivent uniquement :

- état connexion/stream/scène OBS ;
- inputs audio utiles et médias ;
- timer ;
- modes ;
- prochain live + planning minimal ;
- confirmation Stop ;
- préflight utile.

Les chemins locaux, secrets, comptes OAuth, providers détaillés, devices et runtime ne sont pas sérialisés dans la projection mobile.

## Cache/PWA

Le Service Worker, lorsqu'il est autorisé par un contexte sécurisé, ne met en cache qu'une allowlist fixe d'assets statiques. Les URL avec query string ne sont jamais interceptées afin qu'un lien de pairing contenant un ID/code ne soit pas conservé dans le cache.

Le manifest fournit les icônes 192/512, le scope `/mobile/` relatif et le mode `standalone`.

## Validation

`scripts/mobile-smoke.ts` exerce réellement le serveur sur `0.0.0.0` et vérifie : auth, pairing, redaction de state, allowlist de commandes, refus des settings distants, ticket WS à usage unique et refus du replay.

Ce smoke ne remplace pas le test réel sur Android : pairing, Wi-Fi coupé/rétabli, reconnexion, commandes OBS et révocation doivent encore être validés sur un téléphone avant merge.
