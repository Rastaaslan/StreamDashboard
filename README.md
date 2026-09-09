# StreamDashboard

Cockpit Windows autonome pour préparer et piloter OBS, Twitch, le timer, le planning, le Control Deck et le Fun Deck depuis une seule application.

## Installation Windows

Téléchargez **`StreamDashboardSetup.exe`** depuis la dernière GitHub Release, ouvrez-le, puis lancez **StreamDashboard** depuis le menu Démarrer ou le raccourci bureau. L'application embarque son runtime : Node.js, npm, un terminal et le dépôt source ne sont pas nécessaires.

### Premier lancement et OBS

StreamDashboard reste utilisable si OBS est fermé. Dans **Réglages**, indiquez l'adresse et le mot de passe OBS WebSocket, testez la connexion et activez éventuellement **Lancer OBS avec StreamDashboard**. Une fermeture ou un redémarrage d'OBS déclenche la reconnexion bornée du cockpit.

### Connexion Twitch

Le package officiel contient le Client ID public de StreamDashboard, sans Client Secret. Dans **Réglages**, cliquez sur **Connecter Twitch**, ouvrez la page Twitch proposée et saisissez le code affiché. Le Device Code Grant détecte la validation automatiquement. Chaque utilisateur obtient ses propres jetons, chiffrés par Windows et jamais exposés par l'API.

### Mises à jour et désinstallation

Les mises à jour GitHub Releases sont téléchargées en arrière-plan. Si un live est actif, l'installation attend son arrêt. Désinstallez StreamDashboard depuis **Applications installées** dans Windows ; aucun service ou processus permanent n'est installé.

### Dépannage

Les diagnostics du cockpit indiquent l'état serveur, OBS et Twitch. Les logs sont placés dans `%APPDATA%/StreamDashboard/logs`. Consultez aussi [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## Développement

Node.js 20+ est nécessaire uniquement pour contribuer :

```bash
npm install
npm run dev
npm test
npm run build
```

Commandes desktop :

```bash
npm run desktop:dev
TWITCH_CLIENT_ID=<client-id-public> npm run desktop:package
TWITCH_CLIENT_ID=<client-id-public> npm run desktop:make
```

- `dev` lance le serveur web depuis les sources ;
- `package` produit l'application décompressée ;
- `make` produit l'installateur Squirrel Windows ;
- une `release` est un tag `vX.Y.Z` construit, signé si les credentials existent, vérifié et publié par GitHub Actions.

## Architecture

- `packages/core` : règles métier indépendantes de toute plateforme ;
- `packages/contracts` : protocole JSON officiel version 1 ;
- `integrations` : adaptateurs OBS et Twitch ;
- `apps/server` : API HTTP/WebSocket, command/state buses et persistance ;
- `apps/web` : cockpit renderer sans accès Node ;
- `apps/desktop` : hôte Electron Windows, cycle de vie et stockage sécurisé.

Les clients utilisent `/api/v1/*` et `/ws/v1`; les anciennes routes restent compatibles. Le mode LAN est désactivé par défaut. StreamTool et damPlanner restent entièrement indépendants et ne sont ni lancés, ni modifiés, ni requis. Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/DESKTOP.md`](docs/DESKTOP.md), [`docs/MOBILE_ARCHITECTURE.md`](docs/MOBILE_ARCHITECTURE.md), [`docs/SECURITY.md`](docs/SECURITY.md) et [`docs/RELEASE.md`](docs/RELEASE.md).
