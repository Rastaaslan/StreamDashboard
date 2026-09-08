# Rapport d'implémentation

Implémentés : adapter HTTP damPlanner read-only et refresh; totalité des commandes StreamTool observées; adapter obs-websocket (connexion/reconnexion, scènes, stream, mute, volume); agrégation tolérante aux pannes; prochain live/live non programmé; desktop six sections; mobile cinq sections; deck tactile stateful; pairing QR/code/token hashé/révocation; WebSocket avec reconnexion; diagnostics; bootstrap multi-package-manager; launcher Windows; tests et smoke.

Limites runtime : la persistance des devices est actuellement en mémoire et est réinitialisée au redémarrage; placer StreamDashboard derrière TLS pour un accès autre que LAN. Les actions Discord/Spotify/Jeu supposent que ces noms correspondent aux inputs OBS. L'édition planning attend volontairement l'API upstream documentée séparément.
