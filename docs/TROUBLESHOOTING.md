# Dépannage

- **L'application ne démarre pas** : utilisez **Ouvrir les logs** dans le dialogue d'erreur et consultez `%APPDATA%/StreamDashboard/logs/streamdashboard.log`.
- **OBS hors ligne** : activez OBS WebSocket, vérifiez l'adresse et le mot de passe dans Réglages, puis utilisez **Tester OBS**. Le cockpit reste disponible sans OBS et se reconnecte après son redémarrage.
- **OBS introuvable au démarrage automatique** : configurez `OBS_EXE_PATH` pour une installation non standard ou lancez OBS manuellement.
- **Twitch déconnecté** : reconnectez le compte avec un nouveau code appareil. Une autorisation révoquée est détectée au démarrage ou lors de la validation périodique.
- **Configuration corrompue après un arrêt brutal** : le fichier est mis en quarantaine avec le suffixe `.corrupt-*` et les valeurs sûres sont restaurées. Les secrets restent dans le stockage Windows séparé.
- **Mise à jour prête pendant un live** : terminez le direct ; StreamDashboard proposera ensuite le redémarrage, sans interrompre OBS.

Pour le mode développement seulement : exécutez `npm ci`, puis `npm run dev`. Le serveur legacy écoute par défaut sur `127.0.0.1:47832`.
