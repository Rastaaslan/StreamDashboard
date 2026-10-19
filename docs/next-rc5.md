# StreamDashboard Next 2.0.0-rc.5 — clips et WizeBot

## M5 : garder un moment de jeu

M5 (Ctrl + Alt + Maj + F5, Synapse sur laptop-damien) sauvegarde le tampon de replay OBS sur FIXE. Le bouton « Sauvegarder un clip » du Deck utilise exactement la même action et le même journal. Le résultat donne le chemin du fichier confirmé par OBS. Ce clip local peut ensuite être monté ou importé dans ClipForge ; cette action ne publie pas de clip Twitch.

Dans Mon Deck, « Préparer les clips » démarre le tampon ; son état et sa durée sont lus dans OBS. Préparez-le **avant** le moment à conserver : un tampon arrêté ne contient pas les secondes passées. Sur FIXE, le réglage trouvé est de **20 secondes** et le dossier `C:\Users\damie\Videos`. La durée se règle dans OBS → Paramètres → Sortie → Tampon de replay. L’option cochée dans le Deck prépare automatiquement le tampon quand OBS commence à diffuser, y compris un lancement depuis OBS. Un arrêt manuel du tampon reste respecté jusqu’au prochain démarrage de diffusion ou reconnexion OBS.

La commande attend l’événement de sauvegarde ou un nouveau chemin de fichier. Un ancien clip ne suffit pas pour afficher une réussite. En cas de perte de confirmation : résultat « À vérifier », sans nouvel envoi automatique. Une demande déjà traitée est dédupliquée, y compris après redémarrage.

Associations personnelles conservées sur l’installation de Damien :

| Touche | Combinaison | Action |
| --- | --- | --- |
| M1 | Ctrl + Alt + Maj + F1 | Fin |
| M2 | Ctrl + Alt + Maj + F2 | Pause |
| M3 | Ctrl + Alt + Maj + F3 | Discussion |
| M4 | Ctrl + Alt + Maj + F4 | Jeu |
| M5 | Ctrl + Alt + Maj + F5 | Sauvegarder un clip OBS |
| M6 | Ctrl + Alt + Maj + F6 | Micro |

Les boutons de lecture et d’arrêt audio restent dans la soundboard du téléphone.

## Téléphone : Mon Deck → WizeBot

Quatre commandes globales documentées sont proposées : `!uptime`, `!game`, `!infogame` et `!commands`. Chaque bouton envoie exactement son texte dans le chat Twitch de la chaîne connectée sur FIXE, sous le compte du streamer. Aucune clé API WizeBot n’est nécessaire pour cette méthode.

- **+ Ajouter** : nom du bouton, commande complète avec `!`, paramètres éventuels, couleur.
- **Modifier mes boutons** : modifier ou supprimer une commande ; les changements sont partagés entre les appareils et conservés après redémarrage.
- Pour une commande personnalisée comme `!discord`, elle doit déjà exister dans WizeBot. Créer le bouton ne crée pas la commande dans le bot.
- Twitch doit être connecté avec l’autorisation d’envoi au chat. Le Deck désactive les boutons lorsqu’une reconnexion est nécessaire.
- « Envoyé » signifie que Twitch a accepté le message et renvoyé son identifiant. Cela ne confirme pas une réponse de WizeBot : le bot doit être actif et ses permissions/cooldowns peuvent empêcher une réponse.

Documentation officielle : https://support.wizebot.tv/docs/commands et https://dev.twitch.tv/docs/api/reference/#send-chat-message.

## Installation et conservation

RC5 remplace RC4 sur les deux PC dans leur dossier Next, hors diffusion et après fermeture normale. Sauvegarder le paquet et `%APPDATA%\StreamDashboard-Next` avant mise à jour. Les données historiques `%APPDATA%\StreamDashboard` restent indépendantes.

Installer l’APK RC5 **par-dessus StreamDashboard Next, sans désinstallation** pour conserver l’association sur le S24. L’hôte est FIXE (`http://192.168.1.158:48133` sur le réseau actuel). Aucun nouveau pairing n’est nécessaire si l’association existe déjà.

La migration sauvegarde `control-v2.json.pre-rc5` et remplace uniquement l’ancien M5 standard « Arrêter le son » ou « + 5 minutes ». Les macros personnalisées ne sont pas remplacées. Les quatre boutons WizeBot sont ajoutés une seule fois sans écraser les boutons existants ; leur suppression reste respectée.

Pour revenir à RC4, fermer Next, conserver les données RC5, restaurer le paquet RC4 et la copie complète de ses données. Une restauration abandonne les modifications faites depuis cette copie. Le fichier `control-v2.json.pre-rc5` conserve l’ancien Deck, incompatible avec les nouveaux types d’actions si on ne le restaure pas.

## Vérifications

Tests ciblés : migration/sauvegarde et personnalisation, journal/déduplication, validation WizeBot, réponses Twitch, tampon inactif, confirmation de fichier, ancien clip, concurrence et déconnexion OBS. Le parcours navigateur isolé utilise de vrais clients associés en LAN, le vrai serveur, OBS simulé et une API Twitch simulée : aucun message public de test.

Les essais publics Twitch + YouTube ne font pas partie de cette révision. L’appui physique dans Synapse, l’installation sur le S24 et les réponses réelles de WizeBot restent des vérifications utilisateur.
