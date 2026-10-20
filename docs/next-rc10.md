# StreamDashboard Next — RC10

Le tableau de bord **Live** des deux rôles desktop affiche désormais **Événements Streamlabs**, sous le retour vidéo et les chats. Le flux couvre les dons, follows Twitch / abonnés YouTube, abonnements et réabonnements, cadeaux identifiés par Streamlabs, bits, raids, membres YouTube et Super Chats. Nom, message, montant ou quantité et heure de réception sont visibles. Les filtres plateforme et type restent en place pendant les actualisations.

## Connexion et indépendance

Sur le PC de stream, la source est **Cet appareil**. Sur le PC de jeu associé, choisir **Régie** pour consulter le même historique, ou **Cet appareil · connexion indépendante** pour recevoir directement Streamlabs avec son propre Socket Token. Le bouton **Configurer Streamlabs** enregistre le jeton dans le stockage sécurisé de la source affichée. Les comptes déjà configurés sont réutilisés. Aucun jeton n’est transféré dans le flux ou le cache.

La source ne change jamais automatiquement quand un PC s’éteint. Le statut distingue la connexion Streamlabs de l’accès à la source : une régie inaccessible affiche un historique conservé et une réception non confirmée. Le suivi direct continue si la connexion indépendante du PC restant est configurée.

## Historique et limites

Chaque source conserve les 1 000 derniers événements dans `streamlabs-events.json`, avec écriture atomique et suppression des doublons portant une identité d’événement Streamlabs. Les anciens dons locaux sont repris lors de la première ouverture. Le client garde les 100 derniers événements consultés par source pour les afficher hors connexion. Sans identifiant ni date fournisseur, deux réceptions identiques sont conservées : elles ne sont pas fusionnées arbitrairement.

Ce flux reçoit les événements pendant que sa source est connectée ; il ne reconstitue pas les périodes hors connexion. Les champs de test reçus du fournisseur sont signalés. L’affichage ne relance ni alerte, ni message, ni macro. Le traitement existant des dons reste séparé.

## Installation

Installer la candidate dans un dossier distinct et conserver l’ancienne version. Les raccourcis des deux rôles utilisent le même paquet : `--role=host` sur FIXE, `--role=client` sur Laptop-damien. Fermer l’ancienne candidate avant d’ouvrir la nouvelle. L’application Android RC9.2 reste utilisable ; ce chantier concerne les deux desktops.

Vérifications ciblées : réception de plusieurs types de paquets, non-régression du circuit des dons et des reconnexions, déduplication concurrente, sauvegarde/redémarrage, isolation de deux runtimes, route de lecture autorisée aux appareils associés, filtres et cache hors connexion. Aucun événement public ni donation réelle n’est créé pour ces vérifications. La réception d’un véritable événement sur le compte Streamlabs reste à confirmer.

Format fournisseur : https://dev.streamlabs.com/docs/socket-api
