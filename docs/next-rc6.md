# StreamDashboard Next 2.0.0-rc.6 — commandes WizeBot synchronisées

## Utilisation

Dans **Mon Deck → WizeBot → Importer / gérer mes commandes WizeBot** :

1. **Actualiser depuis WizeBot** récupère la liste publique de la chaîne Twitch connectée sur FIXE.
2. Sélectionner les commandes et **Ajouter / actualiser les boutons sélectionnés**. Un nouvel import ne crée pas de doublons ; les libellés, couleurs et macros personnalisés sont conservés. Un alias disparu est remplacé par le premier alias publié du même ID. Les boutons absents de la nouvelle liste ne sont jamais supprimés automatiquement.
3. **Modifier la réponse chez WizeBot** ouvre l’aperçu publié et une nouvelle réponse complète. La modification passe par `!cmd edit ID texte`, envoyée dans le chat Twitch sous le compte du streamer.
4. Activer au préalable la gestion des commandes depuis le chat dans le panneau WizeBot. Cette fonction est désactivée par défaut chez WizeBot. Twitch doit être connecté sur FIXE avec l’autorisation d’envoi de messages.

Le téléphone et le client PC utilisent le même catalogue, les mêmes boutons et le même historique conservés sur FIXE. Les six commandes publiées de la chaîne peuvent être importées : `!commandes`, `!discord`, `!lurk`, `!minecraft`, `!planning`, `!serveur`.

## Résultats et limites précises

- **Confirmé** : la nouvelle réponse simple a été relue exactement dans la liste publique WizeBot après modification. Une réponse déjà identique n’est pas renvoyée.
- **À vérifier** : Twitch a accepté l’envoi, mais WizeBot n’a pas confirmé le texte par la liste publique, ou le transport a un résultat incertain. Aucun renvoi automatique. Actualiser peut confirmer une publication retardée. Une nouvelle tentative du même texte exige de cocher la case de renvoi après vérification.
- **Échec** : refus connu avant l’envoi ou par Twitch.
- La liste publique peut masquer les variables par `###` ou remplacer le texte par une description. L’éditeur ne suppose jamais que cet aperçu est la définition complète ; le nouveau texte est saisi séparément. Les textes contenant des variables peuvent rester à vérifier après l’envoi.
- L’import couvre les commandes rendues visibles via **Liste des commandes (Site externe)** dans WizeBot. Il ne lit pas les commandes privées/cachées. Le type texte `SAY` est modifiable ; scripts, sons, réglages avancés et permissions restent dans le panneau WizeBot.
- Le texte total envoyé à Twitch est limité à 500 caractères, commande comprise. Les paramètres `$cmd(...)`, sauts de ligne et marqueurs masqués `###` sont refusés par cet éditeur de réponse.
- La révision publiée est relue avant chaque modification pour détecter les éditions concurrentes. WizeBot ne propose pas de verrou transactionnel via cette commande de chat : une modification extérieure strictement simultanée ne peut pas être verrouillée.
- L’adaptateur lit le site public `https://<chaîne>.streaming.lv/?commands`, avec sa session anonyme temporaire et les ressources exposées par sa page. Aucun endpoint privé du panneau, clé WizeBot ou secret supplémentaire. Si le format public change ou le service échoue, les données précédentes sont conservées et l’erreur est affichée.

Documentation officielle : https://support.wizebot.tv/docs/commands_create_chat et https://support.wizebot.tv/docs/commands. Le format public a été observé sur la chaîne le 19 octobre 2026.

## Installation et migration

Installer l’APK RC6 par-dessus RC5, sans désinstaller ; l’association au PC de stream est conservée. Sur Windows, remplacer seulement la candidate Next, après sauvegarde ; l’installation historique reste disponible. `wizebot-commands.json` est ajouté au dossier de configuration de FIXE ; les secrets Twitch restent dans le stockage chiffré existant. Le planning, les sons et les raccourcis restent conservés. Le bouton M5 continue de sauvegarder les clips OBS.

## Vérification

Tests unitaires ciblés : session anonyme, décodage HTML, format invalide, import idempotent, personnalisation, changements de chaîne/révision, double envoi, confirmation exacte, réponse incertaine, reprise explicite et persistance. Parcours navigateur avec hôte réel et téléphone associé en LAN, WizeBot/Twitch simulés : import, édition, lecture de confirmation, absence de confirmation, synchronisation desktop et redémarrage. Aucun message public de test ni modification du texte réel des commandes.
