# StreamDashboard Next 2.0.0-rc.4

Cette candidate poursuit la branche `work/streamdashboard-three-roles` issue de `ci/cb140-final`. Elle conserve l’application historique et les données Next existantes.

## Ce qui change

- Téléphone : ouverture sur **Mon Deck**, grands boutons, onglets Scènes/Alertes/Messages. **Sons** affiche la bibliothèque, ses catégories, ses favoris partagés et le son en cours. **Gestion** donne accès au planning, aux boutons/macros, à l’import audio et à toutes les configurations.
- Planning : filtres à venir/passés/tous, période, type et recherche ; occurrences récurrentes, modification d’une occurrence ou de la série, fin de récurrence, duplication sans publication automatique, catégories Twitch, tags, modèles, export PNG avec note, publication Discord avec aperçu et confirmation, reprise des erreurs/conflits et suppression par période avec aperçu lié aux données exactes.
- Minuteur : démarrage/reprise/pause/remise à 5 minutes, durée personnalisée, compteur fluide et résultat confirmé par la régie. Un second démarrage ne remet plus un compteur en cours au début. Une commande attend désormais un état lu après son résultat, même pendant un rafraîchissement automatique.
- Diagnostic **Le live → Vérifier le minuteur dans OBS**. Il indique la source, l’URL attendue et sa présence dans la scène. **Reconnecter la source à Next** corrige seulement une source navigateur StreamDashboard locale utilisant le port 48132/48133. Les autres overlays sont refusés sans modification.
- M5 : **Arrêter le son en cours**. Le changement automatique concerne uniquement l’ancien bouton par défaut « + 5 minutes » sur F5. Les associations personnalisées restent conservées.
- Le lecteur du live et les deux chats du PC de jeu restent montés pendant les rafraîchissements et commandes.

## Installer et connecter

1. Fermer **StreamDashboard Next** sur FIXE et laptop-damien, hors diffusion. Conserver le dossier actuel pour retour arrière.
2. Extraire le ZIP Windows dans un nouveau dossier. Sur **FIXE (stream)** lancer `Start-Next-Host.cmd`. Sur **laptop-damien (jeu)** lancer `Start-Next-Client.cmd`. Ne pas exécuter à nouveau la migration initiale si Next est déjà utilisé.
3. Next réutilise `%APPDATA%\StreamDashboard-Next`. Les plannings, sons, comptes, boutons et associations existants sont conservés. La version historique utilise un autre dossier de données.
4. Installer l’APK RC4 par-dessus **StreamDashboard Next** sur le S24 Ultra. Il utilise le même identifiant d’application que RC2 ; ne pas désinstaller pour conserver l’association.
5. Si nécessaire, sur FIXE : **Configuration → Appareils → Créer un code de gestion complète**. Sur téléphone ou laptop : **Appareils**, coller le lien complet. Un lien par appareil, valable cinq minutes. Adresse LAN actuellement connue : `http://192.168.1.158:48133` ; téléphone et FIXE sur le même réseau. Un changement d’adresse du PC nécessite d’actualiser cette adresse.
6. Si le minuteur avance dans Next mais pas dans OBS, ouvrir son diagnostic. L’URL attendue sur FIXE est `http://127.0.0.1:48133/overlay/timer/`. L’overlay affiche le compteur en mode Introduction ou Pause ; le mode Fin masque le compteur. Choisir la source exacte dans Configuration → OBS avant de la reconnecter.

## Macros BlackWidow V4 X — Synapse sur laptop-damien

Affecter une pression simple aux combinaisons suivantes. Garder le client Next ouvert sur le PC de jeu ; aucun Synapse n’est nécessaire sur FIXE. Pas de boucle de répétition.

| Touche | Combinaison | Association par défaut |
| --- | --- | --- |
| M1 | Ctrl + Alt + Maj + F1 | Couper / ouvrir le micro OBS |
| M2 | Ctrl + Alt + Maj + F2 | Scène du mode Jeu |
| M3 | Ctrl + Alt + Maj + F3 | Scène du mode Pause |
| M4 | Ctrl + Alt + Maj + F4 | Discussion |
| M5 | Ctrl + Alt + Maj + F5 | Arrêter le son de la soundboard |
| M6 | Ctrl + Alt + Maj + F6 | Introduction |

`mode.set` utilise la scène associée au mode dans les réglages ; `scene.set` sélectionne un nom de scène exact. Le lancement du live conserve sa commande commune Twitch **et** YouTube et ses résultats distincts.

## Vérification et limites

Tests ciblés du journal de commandes, migration de M5, minuteur, soundboard, récurrences, conflits, pagination, export et suppression par période. Parcours navigateur sur serveur isolé : clients desktop/téléphone associés via LAN, micro/scène, minuteur, sons et arrêt par F5, favoris, CRUD partagé, duplication, modification d’une occurrence, PNG, redémarrage et conservation de l’association. OBS est simulé dans ce banc ; aucune diffusion ni publication Discord publique n’a été déclenchée.

À valider sur les appareils réels après installation : minuteur/overlay OBS signalé en panne, retour audio audible dans le mix, touches physiques M1–M6 dans Synapse, mise à jour et association du S24 Ultra. FIXE et laptop-damien étaient hors ligne dans Desktop Commander pendant cette correction. Les autorisations YouTube et les publications réelles restent dépendantes des comptes connectés.
