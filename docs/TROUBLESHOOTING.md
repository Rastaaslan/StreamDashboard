# Dépannage

- **Cockpit inaccessible** : vérifier Node.js 20+, exécuter `npm install`, puis `npm start` dans le dépôt.
- **OBS hors ligne** : activer le serveur WebSocket dans OBS, vérifier `OBS_URL`/`OBS_PASSWORD`, puis relancer. Les fonctions autonomes restent disponibles.
- **Une commande OBS échoue** : consulter Diagnostics; la réponse API affiche également le message OBS.
- **Planning ou préférences perdus** : vérifier les droits d'écriture du fichier `data/dashboard.json` (ou de `DATA_FILE`).
- **Port occupé** : modifier `PORT` et `PUBLIC_URL` ensemble dans `.env`.
