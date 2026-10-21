# StreamDashboard Next 2.1 — réalisation transversale

Version de travail : **2.1.0-alpha.1**, non installée sur les postes stables.
Branche : `work/streamdashboard-next21-universal`, créée sur `28c1b7e`.
Les exigences P0 de [NEXT_2_1_REQUIREMENTS.md](NEXT_2_1_REQUIREMENTS.md) font autorité.

## Code intégré

- Contrat commun Windows, Android et navigateur : appareils, capacités, rôles, destinations, disponibilité observée et six presets. Aucune sélection de preset ne fabrique un appareil distant.
- Éditeur commun de l’installation : prévisualisation, validation par révision, sauvegarde, restauration, retrait réversible, réactivation et choix d’un exécuteur connu. Un changement de rôle Windows vérifie la sécurité du redémarrage.
- Migration RC11.7 : identité locale persistante, répertoire et origine historiques conservés. Les comptes, contenus, sessions web et espaces de travail ne sont pas déplacés par un changement de rôle.
- Découverte authentifiée `GET /api/v2/device` : identité physique stable et champs publics explicitement sélectionnés. Un changement d’adresse conserve l’identité d’un agent 2.1. Une association RC11.7 garde un descripteur de compatibilité jusqu’à sa mise à niveau.
- Associations chiffrées par origine dans Windows et Android. Une adresse inconnue ne reçoit jamais le jeton du dernier appareil utilisé. Les écritures Windows des comptes et du contrôleur sont sérialisées entre instances du même coffre.
- Agent Windows `--agent`, sans fenêtre, avec ouverture depuis la zone de notification. L’option d’arrière-plan maintient le runtime et les macros après fermeture de la fenêtre. Au redémarrage, seules les associations macro encore confirmées par l’exécuteur sont réarmées ; aucune commande interrompue n’est rejouée.
- Module de visionneuse commun : cibles Twitch et YouTube propres à l’appareil, deux chats présents, utilisation Android autonome, ouverture externe et diagnostic explicite quand la session web intégrée ne peut pas être vérifiée. Le chat API Twitch Windows utilise le runtime local indépendamment de l’agent OBS distant.
- Cache hors réseau mis à jour pour inclure tous les nouveaux modules.

## Modules transversaux ajoutés

- **Destinations par action** : chaque bouton ou macro peut viser un exécuteur associé distinct. L’identité physique, la permission et la définition d’action sont vérifiées avant l’effet. Le retrait, le changement de définition ou la perte d’un exécuteur n’entraîne ni repli vers un autre appareil ni répétition automatique. Les autres destinations restent utilisables.
- **Macros sans fenêtre** : les destinations et définitions sont conservées dans le coffre Windows, vérifiées séparément au redémarrage et réarmées après reconnexion sans rejouer les commandes. Les raccourcis de la fenêtre et les touches globales utilisent les mêmes définitions.
- **Permissions par appareil** : observation, OBS, clips, audio, chat, cloud, planning et administration ; choix à l’association et modification avec comparaison de la version précédente. Un changement invalide les tickets WebSocket et ferme les sessions existantes. Les commandes en attente revérifient leurs permissions avant exécution.
- **Chat YouTube API commun** : identité de chaîne/broadcast vérifiée, états avant live/ingestion/live/fin, changement de chat, réponses tardives écartées, messages conservés pendant les coupures, coalescence et respect des intervalles/quota. Windows et Android utilisent le même moteur d’état, avec leurs autorisations propres. Calendar reste séparé. Le chat web et Twitch restent visibles indépendamment.
- **Audio local Windows sans OBS** : lecteur isolé appartenant à l’agent, sortie système ou sortie disponible explicitement choisie, volume et arrêt. Une sortie absente ne redirige pas le son vers OBS. La bibliothèque, la synchronisation et l’éditeur conservent cette destination. L’énumération des sorties est actualisée avant lecture et à l’ouverture de l’éditeur.
- **Lecture audio simultanée facultative** : chaque son choisit remplacement ou superposition, avec huit lectures locales au maximum. Windows et Android/navigateur suivent toutes les lectures actives ; l’arrêt les libère ensemble. Une sortie OBS ne permettant pas le mixage le refuse explicitement.
- **Rôles exécutés** : les macros globales, les effets audio, les services et le planning, les chats et les visionneuses suivent les rôles activés. Les effets sont revérifiés avant exécution ; une configuration persistée ne prouve pas que le moteur Windows a redémarré. Android applique les changements locaux sans relancer l’application.
- **Transition récupérable** : le journal de l’installation distingue une écriture validée d’une interruption, préserve la sauvegarde précédente et réconcilie le démarrage Windows au prochain lancement. Une identité étrangère ou un état divergent suspend la récupération.
- **Démarrage Windows facultatif** : entrée de démarrage par utilisateur, agent sans fenêtre et contrôle du résultat renvoyé par Windows. La modification est sérialisée avec la configuration de l’installation ; un échec d’écriture tente de rétablir le réglage précédent.
- **Arrêt de l’agent** : les requêtes HTTP acceptées sont drainées avant sauvegarde ; les connexions TCP spéculatives sans requête sont fermées. Les vingt démarrages/arrêts réels du test Electron passent.

- **Transport TLS commun** : écoute HTTPS distincte de l’accès local, identité d’agent persistante entre rôles et empreinte SHA-256 à vérifier depuis son lien d’association. Windows utilise une session réseau dédiée par agent ; Android utilise un pont natif limité à l’origine locale et à la fenêtre principale. Aucun certificat racine n’est installé. Les transferts audio Android passent par des blocs temporaires bornés ; les requêtes expirées ne sont pas répétées. Un port HTTPS occupé ou une identité indisponible laisse le runtime local accessible. Le renouvellement explicite conserve les données et vérifie la sécurité du redémarrage.

## Frontières actuelles

La continuité des copies locales lors d’un changement d’adresse est décrite dans la [preuve de conservation des espaces](qa/2026-10-21-workspace-identity.md). Les brouillons, modifications en attente, favoris et destinations de boutons retrouvent le même espace après association de sa nouvelle adresse.

Ce code est une version d’essai, pas la version finale universelle. Aucune cellule n’est déclarée entièrement qualifiée.

Restent à implémenter ou à compléter dans **ce même chantier 2.1** :

- Qualification matérielle restante du transport TLS : Android, rotation du certificat, veille/reprise et changement de réseau. L’association Windows dans les deux sens, le refus d’une mauvaise empreinte, la fermeture de fenêtre et le redémarrage des deux PC ont été vérifiés sur FIXE et le laptop. Les anciennes adresses HTTP demandent une nouvelle association HTTPS avant de transmettre un identifiant. La découverte réseau automatique facultative reste absente.
- Qualification matérielle du cycle de vie des rôles et déplacement transactionnel de leurs responsabilités entre appareils. Le contrôle des moteurs locaux est implémenté ; le transfert complet des responsabilités reste à réaliser.
- Android comme exécuteur audio/affichage commandé depuis un autre appareil ; l’audio Android local et le contrôle d’agents Windows existent. La lecture audio multiple locale est implémentée ; les macros natives de tous les contenus locaux restent à compléter.
- Restauration après interruption couvrant l’ensemble des magasins et effets externes, pas seulement le fichier d’installation ; qualification complète des transitions et migration d’une copie réelle RC11.7.
- Qualification matérielle Windows/Android, des sessions web et des comptes séparés ; chat YouTube pendant une diffusion expressément autorisée ; installation extérieure, mise à jour et retour arrière.

Le téléphone n’était pas présent dans la liste ADB lors du contrôle du 21 octobre. Les applications stables de FIXE et du laptop sont restées actives ; aucun OBS n’a été arrêté et aucun live/message de chat n’a été déclenché. L’ouverture externe d’un lecteur ne prouve jamais la connexion de sa session intégrée.

## Qualification et livraison

Les changements audio, rôles et récupération sont détaillés dans le [bilan du 21 octobre](qa/2026-10-21-execution-recovery.md).

La [matrice de qualification](qa/next21-qualification.json) couvre les six setups, onze modules, dix scénarios obligatoires et neuf transitions. Les états partiels sont conservés tant que la preuve complète n’existe pas ; « indisponible » pour OBS/Clips sur Android seul est un comportement à vérifier.

`npm run universal:status` affiche l’avancement. `npm run universal:release-check` refuse une livraison universelle tant que la matrice n’est pas complète, avec preuves automatisées et matérielles. Ce contrôle est intégré à `release:check` et aux publications finales Windows/Android. Les publications intermédiaires Windows sont marquées prerelease. Les commandes de compilation restent disponibles pour les essais intermédiaires.

Les tests utilisent des profils temporaires et des services simulés. Une compilation Android et des tests Electron Linux ne constituent pas une qualification matérielle Windows/Android. Les installations RC11.7 et leurs données restent la référence stable.
