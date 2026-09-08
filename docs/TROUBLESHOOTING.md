# Dépannage

- **Une ligne `ECHEC` dans le résumé** : le délai borné de 25 secondes a expiré ou le processus n'a pas démarré. Les autres composants continuent volontairement. Relancer le launcher ne crée pas de doublon : les endpoints actifs et le processus OBS sont détectés.
- **OBS introuvable** : définir `OBS_EXE_PATH=C:\chemin\vers\obs64.exe` dans `.env`. Le launcher essaie aussi automatiquement les installations Program Files 64 et 32 bits.
- **Repo annexe introuvable** : définir `STREAMTOOL_PATH` ou `DAMPLANNER_PATH`; vérifier Git si le clone de secours dans `.dependencies` échoue. Le repo frère et le dossier du profil utilisateur sont également reconnus.
- **Timeout au premier démarrage** : l'installation ou la compilation peut dépasser 25 secondes; laisser le processus finir puis relancer le launcher, qui détectera le service déjà actif.
- **Planning vide** : vérifier `curl http://127.0.0.1:47831/api/calendar`, puis Diagnostics et `DAMPLANNER_URL`.
- **Commande 401** : refaire le pairing; le token a pu être révoqué.
- **StreamTool hors ligne** : contrôler son port, son token Bearer et `GET /api/state`.
- **OBS hors ligne** : activer obs-websocket, contrôler le port 4455 et le mot de passe. La reconnexion est automatique avec backoff.
- **Mobile inaccessible** : autoriser le port 47832 dans le pare-feu et définir `PUBLIC_URL` avec l'adresse LAN du PC.
- **Smoke échoue** : démarrer d'abord le serveur; le smoke est volontairement un contrôle runtime réel.
