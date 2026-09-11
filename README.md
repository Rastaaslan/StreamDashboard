# StreamDashboard

Cockpit Windows autonome pour préparer et piloter **OBS, Twitch, Google Calendar, le timer, le planning, le Control Deck et le Fun Deck** depuis une seule application, avec télécommande mobile LAN optionnelle.

> La branche PR #20 est une release candidate. Les automatisations peuvent valider le code et le package Windows, mais le merge reste bloqué tant que le vrai Start/Stop OBS/Twitch, Google OAuth et un téléphone Android réel ne sont pas validés manuellement.

## Installation Windows

Téléchargez **`StreamDashboardSetup.exe`** depuis une GitHub Release officielle, ouvrez-le, puis lancez **StreamDashboard** depuis le menu Démarrer ou le raccourci bureau. L'application embarque son runtime : Node.js, npm, un terminal et le dépôt source ne sont pas nécessaires.

### Premier lancement et OBS

StreamDashboard reste utilisable si OBS est fermé. Dans **Réglages**, indiquez l'adresse et le mot de passe OBS WebSocket, testez la connexion et activez éventuellement **Lancer OBS avec StreamDashboard**. Une fermeture ou un redémarrage d'OBS déclenche la reconnexion bornée du cockpit.

Le bouton **Démarrer le live** sélectionne d'abord la scène de démarrage configurée (`Intro` par défaut ou `Live`), attend la confirmation d'OBS, rafraîchit la Browser Source timer configurée, puis seulement demande `StartStream`.

L'overlay timer StreamDashboard est disponible sur :

`http://127.0.0.1:47832/overlay/timer/`

### Planning et lives non programmés

Le planning orchestre indépendamment les destinations **local**, **Twitch** et **Google Calendar**, avec statuts par provider, retry ciblé, suppression explicite et résolution de conflits.

Si OBS passe réellement en streaming alors qu'aucun live planifié correspondant n'est actif ou imminent, StreamDashboard crée automatiquement un événement **local uniquement** `Live non programmé`. Il ne publie rien par surprise sur Twitch ou Google. À l'arrêt réel d'OBS, l'heure de fin est enregistrée dans le planning.

La page **Planning** peut aussi générer localement une image PNG verticale **1080 × 1350** des prochains lives via **Image réseaux**. Les événements personnels ne sont jamais inclus dans cet export.

### Connexion Twitch

Le package officiel contient uniquement le Client ID public de StreamDashboard, sans Client Secret. Dans **Réglages**, cliquez sur **Connecter Twitch**, ouvrez la page Twitch proposée et saisissez le code affiché. Le Device Code Grant détecte la validation automatiquement.

Les nouvelles connexions demandent `channel:manage:schedule` pour le planning et `channel:manage:broadcast` pour préparer le titre/la catégorie avant le live. Les jetons sont chiffrés via le stockage sécurisé Electron et ne sont jamais exposés à la télécommande mobile.

### Google Calendar

Si la distribution contient un `GOOGLE_CLIENT_ID`, **Réglages > Google Calendar** permet de connecter Google via Authorization Code + PKCE, choisir un calendrier modifiable et synchroniser événements horaires et journées entières. Les créations, modifications, suppressions, retries et conflits sont gérés indépendamment de Twitch.

Les scopes sont limités à la gestion des événements et à la lecture de la liste des calendriers. Aucun Client Secret Google n'est embarqué.

### Télécommande Android / LAN

Le mode LAN est **désactivé par défaut**. Une fois activé dans Réglages et StreamDashboard redémarré, le PC peut générer un code de pairing éphémère. Le téléphone reçoit sa propre credential ; Twitch, Google, le mot de passe OBS, les chemins locaux et les diagnostics desktop ne lui sont jamais envoyés.

La télécommande web fonctionne sur un LAN privé en HTTP. L'installation PWA nécessite un contexte HTTPS sécurisé ; en HTTP LAN, elle reste volontairement une télécommande web.

### Mises à jour et désinstallation

Les mises à jour proviennent des GitHub Releases. Une release officielle taguée exige les secrets de signature Windows ; la CI refuse de publier un tag officiel non signé. Si un live est actif, l'installation d'une mise à jour attend son arrêt.

Désinstallez StreamDashboard depuis **Applications installées** dans Windows ; aucun service permanent n'est installé.

### Dépannage

Les diagnostics du cockpit indiquent l'état serveur, OBS, Twitch et Google. Les logs sont placés dans `%APPDATA%/StreamDashboard/logs` et expurgent les secrets connus. Consultez aussi [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## Développement

Node.js 20+ est accepté ; la CI officielle utilise Node.js 22.

```bash
npm install
npm run dev
npm test
npm run build
npm run security:check
npm run mobile:smoke
```

Commandes desktop :

```bash
npm run desktop:dev
TWITCH_CLIENT_ID=<client-id-public> GOOGLE_CLIENT_ID=<google-client-id> npm run desktop:package
npm run desktop:make
```

- `dev` lance le serveur web depuis les sources ;
- `package` produit l'application Windows décompressée ;
- `make` produit l'installateur Squirrel Windows ;
- une release officielle est un tag `vX.Y.Z`, repackage l'application signée, smoke-teste l'exécutable, vérifie Authenticode, génère les checksums puis publie les assets.

## Architecture

- `packages/core` : règles métier indépendantes de toute plateforme, dont orchestration planning et suivi des lives non programmés ;
- `packages/contracts` : protocole JSON officiel version 1 et projection mobile ;
- `integrations/obs` : OBS WebSocket, reconnexion et confirmations ;
- `integrations/twitch` : OAuth Device Code, planning et préflight chaîne ;
- `integrations/google-calendar` : OAuth PKCE et CRUD/synchronisation Calendar ;
- `apps/server` : API HTTP/WebSocket, command/state bus, orchestration et persistance ;
- `apps/web` : cockpit renderer sans accès Node, dont export local de l'image planning ;
- `apps/mobile` : télécommande LAN à privilèges réduits ;
- `apps/desktop` : hôte Electron Windows, cycle de vie et stockage sécurisé.

Les clients utilisent `/api/v1/*` et `/ws/v1`; les anciennes routes restent compatibles pour le desktop local. **StreamTool et damPlanner restent entièrement indépendants** : ils ne sont ni lancés, ni modifiés, ni requis par StreamDashboard.

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/DESKTOP.md`](docs/DESKTOP.md), [`docs/MOBILE_ARCHITECTURE.md`](docs/MOBILE_ARCHITECTURE.md), [`docs/SECURITY.md`](docs/SECURITY.md), [`docs/RELEASE.md`](docs/RELEASE.md) et [`docs/next-foundation.md`](docs/next-foundation.md).
