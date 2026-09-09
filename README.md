# StreamDashboard V1 Desktop

Cockpit local et autonome pour piloter une session de streaming depuis une seule interface : préparation, OBS, diffusion, timer, planning synchronisé Twitch, Control Deck, Fun Deck, réglages et diagnostics.

## Démarrage quotidien (Windows)

Double-cliquez sur **`Lancer_StreamDashboard.cmd`**. Le launcher démarre OBS s'il le trouve, lance StreamDashboard puis ouvre le cockpit. StreamTool et damPlanner restent entièrement indépendants et ne sont ni lancés, ni modifiés, ni requis.

## Développement

Node.js 20+ :

```bash
npm install
npm run dev
```

Ouvrez <http://127.0.0.1:47832>. Utilisez `npm run build`, `npm test` et `npm run smoke` pour les vérifications.

## Architecture

- `apps/server` : API locale, commandes partagées, événements WebSocket et stockage autonome dans `data/dashboard.json`.
- `apps/web` : cockpit desktop (aucune navigation, PWA ou association mobile en V1).
- `integrations/obs` : adaptateur OBS WebSocket avec reconnexion et état temps réel.
- `packages/contracts` : contrats stables et réutilisables par de futurs clients, sans coupler le serveur à une interface.

Les commandes passent toutes par `POST /api/commands`; les changements d'état sont publiés via l'événement `state.updated` sur `/ws`.

## Connecter Twitch

1. Créez une application dans la console développeur Twitch et ajoutez comme URL de redirection OAuth
   `http://127.0.0.1:47832/api/twitch/callback` (adaptez le port si `PORT` est modifié).
2. Dans **Réglages → Connexion Twitch**, collez le Client ID, puis cliquez sur **Connecter Twitch**.
3. Autorisez l'accès au planning. StreamDashboard utilise OAuth Authorization Code avec PKCE : aucun secret client n'est demandé.
4. Dans **Planning**, cliquez sur **Synchroniser Twitch** pour importer les segments Twitch et publier les lives locaux.

Les jetons restent dans le fichier local `data/dashboard.json` et ne sont jamais exposés par `/api/state`. Twitch est optionnel : le planning local et OBS continuent de fonctionner hors connexion. StreamTool et damPlanner ne sont pas requis.

## Fun Deck OBS

Le Fun Deck n'affiche plus de boutons de démonstration : il détecte les sources **Média**, **VLC** et **Diaporama** configurées dans OBS. Chaque bouton relance réellement la source correspondante via OBS WebSocket. Ajoutez ou renommez ces sources dans OBS puis rechargez l'état du cockpit pour adapter automatiquement le deck.
