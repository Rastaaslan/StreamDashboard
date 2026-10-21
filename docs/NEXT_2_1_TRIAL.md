# Essais de StreamDashboard Next 2.1

Cette version alpha est destinée aux essais. Lire [l’état de réalisation](NEXT_2_1_IMPLEMENTATION.md) avant de remplacer une installation. La qualification universelle n’est pas terminée ; conserver la RC11.7 et une sauvegarde de ses données.

## Configuration commune

1. Ouvrir **Paramètres → Mon installation** et choisir l’un des six setups. Le preset ne crée pas d’appareil distant fictif.
2. Nommer l’appareil et lui attribuer ses responsabilités. OBS et les clips OBS nécessitent un exécuteur Windows compatible ; les comptes, chats et plannings restent propres à chaque appareil.
3. Prévisualiser puis appliquer. Un changement d’exécution OBS peut demander un redémarrage, refusé si la sécurité du live ou de l’enregistrement ne peut pas être établie.
4. Associer les appareils depuis **Connexions**, en choisissant leurs permissions. Conserver une autorisation distincte sur chaque appareil.
5. Dans **Boutons & macros**, utiliser **Destination** pour lier une action à la définition d’un exécuteur associé. L’appareil ciblé apparaît sur le bouton. Une définition modifiée demande une nouvelle association ; une commande interrompue n’est pas automatiquement répétée.

## Agent et sons

L’option d’arrière-plan maintient l’agent et les macros lorsque la fenêtre est fermée. **Quitter l’agent et les macros**, dans la zone de notification, arrête l’exécution. Le démarrage à l’ouverture de session est facultatif et nécessite l’application Windows empaquetée.

Pour jouer un son sans OBS sur Windows, ouvrir le catalogue de cet appareil et sélectionner **Cet appareil · sortie système**, ou une sortie explicitement disponible. **Mix OBS** reste une destination différente. Une sortie absente est signalée et conservée ; aucun changement automatique n’est effectué. Le volume du son et l’arrêt concernent l’exécuteur choisi.

## Lecteurs et chats

L’identité API, la session web du lecteur et l’identité de chat sont distinctes. Le diagnostic « session non vérifiable » ne signifie pas que la connexion API a échoué. L’ouverture externe utilise la session du navigateur externe.

Le chat YouTube API suit la diffusion sélectionnée du compte autorisé. Il indique les états de préparation, ingestion, connexion, fin, quota ou autorisation insuffisante et conserve les messages déjà reçus pendant une coupure. Google Calendar conserve son propre compte. Twitch et YouTube peuvent rester visibles simultanément.

## Sauvegarde et retour arrière

L’éditeur d’installation conserve une configuration précédente et compare les révisions avant d’appliquer un changement. **Restaurer la configuration précédente** rétablit les rôles et destinations ; les contenus et comptes sont conservés. Cette sauvegarde de configuration ne remplace pas une sauvegarde complète du profil et des bibliothèques.

Les exports et imports doivent être contrôlés sur une copie des données avant une migration réelle. Les secrets et cookies ne sont pas copiés entre appareils ; une authentification propre à l’appareil reste nécessaire.

## Limites de cette version d’essai

Le transport LAN historique utilise encore HTTP. Le transport chiffré, certains déplacements de responsabilités, Android comme exécuteur distant et la lecture audio multiple restent à compléter dans le chantier 2.1. Les paquets compilés ne constituent pas une qualification matérielle. Voir le [rapport de vérification](qa/2026-10-21-transversal-modules.md) et la [matrice](qa/next21-qualification.json).
