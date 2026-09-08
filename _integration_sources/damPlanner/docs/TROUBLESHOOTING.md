# Dépannage

- **Stockage sécurisé indisponible** : vérifier que l'application s'exécute dans une session Windows normale ; aucun fallback en clair n'est autorisé.
- **REAUTH_REQUIRED** : reconnecter uniquement le fournisseur concerné.
- **ERROR/offline** : l'événement local est conservé ; rétablir le réseau puis utiliser « Réessayer Google/Twitch ».
- **REMOTE_MISSING** : confirmer la suppression distante ou republier explicitement.
- **Twitch ambigu** : contrôler le Stream Schedule, supprimer les doublons manuellement puis relancer la réconciliation.
- **Google callback bloqué** : pare-feu/proxy doit autoriser le loopback local ; ne pas exposer le port au LAN.
