# StreamDashboard Next 2.1 — réalisation transversale

Version de travail : **2.1.0-alpha.1**, non installée sur les postes stables.
Branche : `work/streamdashboard-next21-universal`, créée sur `28c1b7e`.
Les exigences P0 de [NEXT_2_1_REQUIREMENTS.md](NEXT_2_1_REQUIREMENTS.md) font autorité.

## Code intégré

- Contrat commun Windows, Android et navigateur : appareils, capacités, rôles, destinations, disponibilité observée et six presets. Aucune sélection de preset ne fabrique un appareil distant.
- Éditeur commun de l’installation : prévisualisation, validation par révision, sauvegarde, restauration, retrait réversible, réactivation et choix d’un exécuteur connu. Un changement du rôle OBS vérifie la sécurité du redémarrage.
- Migration RC11.7 : identité locale persistante, répertoire et origine historiques conservés. Les comptes, contenus, sessions web et espaces de travail ne sont pas déplacés par un changement de rôle.
- Découverte authentifiée `GET /api/v2/device` : identité physique stable et champs publics explicitement sélectionnés. Un changement d’adresse conserve l’identité d’un agent 2.1. Une association RC11.7 garde un descripteur de compatibilité jusqu’à sa mise à niveau.
- Associations chiffrées par origine dans Windows et Android. Une adresse inconnue ne reçoit jamais le jeton du dernier appareil utilisé. Les écritures Windows des comptes et du contrôleur sont sérialisées entre instances du même coffre.
- Agent Windows `--agent`, sans fenêtre, avec ouverture depuis la zone de notification. L’option d’arrière-plan maintient le runtime et les macros après fermeture de la fenêtre. Au redémarrage, seules les associations macro encore confirmées par l’exécuteur sont réarmées ; aucune commande interrompue n’est rejouée.
- Module de visionneuse commun : cibles Twitch et YouTube propres à l’appareil, deux chats présents, utilisation Android autonome, ouverture externe et diagnostic explicite quand la session web intégrée ne peut pas être vérifiée. Le chat API Twitch Windows utilise le runtime local indépendamment de l’agent OBS distant.
- Cache hors réseau mis à jour pour inclure tous les nouveaux modules.

## Frontières actuelles

Ce jalon livre le socle et une première intégration. Il ne qualifie aucun module comme universellement terminé.

La destination OBS est désormais explicite. Le routage simultané de chaque action vers plusieurs exécuteurs, le déplacement complet des responsabilités audio/services/affichage, la découverte automatique sur le réseau et les permissions granulaires restent à compléter. Les rôles autres qu’OBS décrivent la configuration mais ne pilotent pas encore tous les cycles de vie des modules.

Les services autonomes existants restent utilisables. La récupération et le suivi du chat YouTube par identité API, ses changements de diffusion et états avant/après live, ainsi que les diagnostics de session sur les appareils réels doivent encore être qualifiés. Le navigateur externe possède sa propre session ; son ouverture ne prouve jamais une connexion du lecteur intégré.

Le démarrage automatique de l’agent à l’ouverture de session Windows reste à réaliser. `--agent` démarre actuellement l’agent explicitement. Les essais matériels croisés Windows/Android et la migration d’une copie des données réelles RC11.7 restent ouverts.

## Qualification et livraison

La [matrice de qualification](qa/next21-qualification.json) couvre les six setups, onze modules, dix scénarios obligatoires et neuf transitions. Les états partiels sont conservés tant que la preuve complète n’existe pas ; « indisponible » pour OBS/Clips sur Android seul est un comportement à vérifier.

`npm run universal:status` affiche l’avancement. `npm run universal:release-check` refuse une livraison universelle tant que la matrice n’est pas complète, avec preuves automatisées et matérielles. Ce contrôle est intégré à `release:check` et aux publications finales Windows/Android. Les publications intermédiaires Windows sont marquées prerelease. Les commandes de compilation restent disponibles pour les essais intermédiaires.

Les tests utilisent des profils temporaires et des services simulés. Une compilation Android et des tests Electron Linux ne constituent pas une qualification matérielle Windows/Android. Les installations RC11.7 et leurs données restent la référence stable.
