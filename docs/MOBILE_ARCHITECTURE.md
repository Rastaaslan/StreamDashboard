# Architecture du futur client mobile

## Principe

Le PC reste le hub maître : Android/iOS → protocole StreamDashboard → API PC → core → OBS/Twitch. Le téléphone ne contacte jamais OBS ou Twitch et ne reçoit jamais leurs credentials. `packages/contracts` reste sérialisable JSON et pourra être partagé en TypeScript ou exporté ultérieurement en JSON Schema/OpenAPI.

## Transport et mode LAN

L'API v1 (`/api/v1/*`, `/ws/v1`) ne contient aucune notion Electron ou localhost. Un client reçoit une `serverUrl` et peut utiliser HTTP(S)/WS(S). Le serveur distingue `desktop-local` de `remote-LAN`; aujourd'hui il écoute exclusivement en loopback par défaut. L'activation LAN future devra être explicite et pourra ajouter TLS avec certificate pinning sans modifier le core.

La découverte pourra utiliser mDNS/Bonjour ou un QR contenant une adresse candidate. L'identité logique du serveur et le pairing ne dépendront pas de l'IP, donc un changement DHCP ne nécessitera pas de réassociation complète.

## Pairing prévu

1. Le desktop crée un challenge court, temporaire et à usage unique.
2. Le QR/code transporte l'adresse, l'identifiant du challenge et une empreinte de confiance, jamais un token Twitch.
3. Le mobile demande l'association ; le PC exige une validation visible.
4. Le PC délivre un credential aléatoire propre à l'appareil.

Un appareil associé comportera `deviceId`, `deviceName`, `pairedAt`, `lastSeenAt`, `permissions` et `revoked`. Chaque credential sera révocable et rotatif indépendamment. Les routes LAN appliqueront authentification, expiration de session, limitation brute force, validation runtime et autorisation par commande. Aucun CORS `*` ne sera utilisé.

## Bus uniques

Desktop et mobile utilisent le même `DashboardCommandService`. OBS, Twitch, timer et planning alimentent un état canonique distribué par `state.updated`; aucun client ne reconstruit l'état depuis une série d'endpoints. Les contrats couvrent déjà scènes, stream, audio, timer, planning et deck et restent indépendants de React Native, Expo, Capacitor, Kotlin ou Swift.

## Preuve actuelle

`scripts/mobile-smoke.ts` joue un client externe loopback : health, capabilities, state, commande et abonnement WebSocket v1, sans importer Electron.
