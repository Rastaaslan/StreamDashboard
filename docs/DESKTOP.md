# Hôte desktop Windows

Electron est uniquement l'hôte de l'API StreamDashboard. `main.ts` prend le verrou d'instance unique, `lifecycle.ts` prépare `userData`, démarre le serveur en processus interne et attend sa Promise de readiness avant de créer la fenêtre. Aucun processus `npm`, `tsx`, PowerShell ou serveur enfant n'est lancé.

## Répertoires utilisateur

- `%APPDATA%/StreamDashboard/config/dashboard.json` : préférences, planning, identité Twitch publique et `schemaVersion` ;
- `%APPDATA%/StreamDashboard/secure/credentials.dat` : tokens Twitch et mot de passe OBS chiffrés par Electron `safeStorage`/DPAPI ;
- `%APPDATA%/StreamDashboard/logs/streamdashboard.log` : logs rotatifs et expurgés.

Le launcher `.cmd` reste uniquement un raccourci legacy de développement. Le produit final se lance depuis le raccourci Squirrel du menu Démarrer ou du bureau.

## Cycle de vie

Le serveur signale sa disponibilité par la résolution de `startDashboardServer`. À la fermeture, Electron arrête l'updater, les validateurs/pollers, les WebSockets, OBS, le serveur HTTP, puis persiste atomiquement. Une seconde instance restaure la fenêtre existante.

## Sécurité

Le renderer utilise `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true` et une CSP. Le preload expose seulement version, ouverture contrôlée Twitch, dossier logs, minimisation et fermeture. Les navigations sont bloquées ; seules les URL `https` appartenant à `twitch.tv` sont ouvertes dans le navigateur système.
