# Configuration Twitch

1. Enregistrer une application sur la Developer Console Twitch.
2. Copier uniquement le **Client ID public** dans Réglages et cliquer **Enregistrer le Client ID** ; aucun client secret n'est embarqué.
3. Démarrer le Device Code Flow, ouvrir l'URL affichée et autoriser `channel:manage:schedule`.
4. DamPlanner récupère l'utilisateur/broadcaster Helix puis permet la recherche de catégorie (debounce 300 ms), la lecture et la mutation du planning.

Le navigateur n'est ouvert qu'après validation de l'origine Twitch par le main process. Les jetons d'accès et de refresh rotatifs restent dans `safeStorage`. Les segments sont non récurrents. Après timeout de création, la réconciliation cherche une correspondance unique ; une ambiguïté reste en erreur pour décision humaine.

## Segments externes

Les segments du planning qui ne correspondent à aucune publication DamPlanner sont affichés
en lecture seule et ne sont jamais supprimés. La récurrence distante n'est pas simulée :
DamPlanner respecte les capacités réelles de l'API Twitch.
