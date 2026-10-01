# Installation Windows

1. Téléchargez `StreamDashboardSetup.exe` depuis la dernière GitHub Release.
2. Exécutez l'installateur Squirrel ; aucun droit administrateur, Node.js ou npm n'est requis.
3. Lancez **StreamDashboard** depuis le menu Démarrer ou le raccourci bureau.
4. Activez OBS WebSocket, puis configurez OBS dans les réglages du cockpit.
5. Connectez Twitch avec le code appareil proposé.

Les préférences sont dans `%APPDATA%/StreamDashboard/config`, les secrets chiffrés dans `secure` et les logs dans `logs`. La désinstallation passe par **Paramètres → Applications installées**.

`Lancer_StreamDashboard.cmd` et `.env` sont conservés uniquement pour les développeurs et les installations legacy depuis les sources. Ils ne font pas partie du parcours utilisateur normal.
