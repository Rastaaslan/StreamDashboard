# Dépannage

- **Planning vide** : vérifier `curl http://127.0.0.1:47831/api/calendar`, puis Diagnostics et `DAMPLANNER_URL`.
- **Commande 401** : refaire le pairing; le token a pu être révoqué.
- **StreamTool hors ligne** : contrôler son port, son token Bearer et `GET /api/state`.
- **OBS hors ligne** : activer obs-websocket, contrôler le port 4455 et le mot de passe. La reconnexion est automatique avec backoff.
- **Mobile inaccessible** : autoriser le port 47832 dans le pare-feu et définir `PUBLIC_URL` avec l'adresse LAN du PC.
- **Smoke échoue** : démarrer d'abord le serveur; le smoke est volontairement un contrôle runtime réel.
