STREAMDASHBOARD NEXT — 2.0.0-rc.11.1
Paquet portable Windows x64

MISE EN ROUTE
1. Après la fin du live, fermez l’ancienne application StreamDashboard si elle
   est ouverte.
2. Extrayez entièrement le ZIP dans un nouveau dossier local, par exemple
   C:\Users\VotreNom\Applications\StreamDashboard-Next-RC11.1
3. Sur le PC de stream avec OBS, ouvrez Lancer_Regie.cmd.
   Sur le PC de jeu / de pilotage, ouvrez Lancer_PC_Jeu.cmd.

Le dossier complet est nécessaire : StreamDashboard.exe, resources\app.asar,
les DLL, les fichiers Electron et les sous-dossiers doivent rester ensemble.
Ne lancez pas l’EXE directement à l’intérieur du ZIP. Une mise à jour doit
remplacer le dossier de l’application complet ; l’EXE et son ASAR sont associés.
Les lanceurs n’arrêtent aucun processus et ne modifient aucune configuration.

COMMANDES ÉQUIVALENTES DEPUIS LE DOSSIER EXTRAIT
Régie :        StreamDashboard.exe --role=host
PC de jeu :    StreamDashboard.exe --role=client

DONNÉES ET CONNEXIONS
Les réglages et comptes existants restent dans le profil Windows de
StreamDashboard Next. Le dossier portable ne contient aucun compte préconnecté.
Choisissez le lanceur correspondant au rôle de chaque PC ; utilisez un seul
rôle à la fois sur un même PC. Associez le PC de jeu à la régie dans l’application
si cette association n’a pas encore été faite.

REPÈRES RC11.1
- Le choix YouTube affiche la chaîne, la date et l’état de la diffusion.
  « Choisir et enregistrer » sauvegarde la cible. Un live créé dans Calendar
  ne crée pas automatiquement une diffusion YouTube : créez-la dans YouTube
  Studio, puis choisissez cette diffusion dans StreamDashboard.
- Le signal envoyé par OBS est distingué du direct confirmé par la plateforme.
  Les commandes séparées permettent de compléter une destination manquante.
- La catégorie Twitch se recherche par son nom.
- Le bouton Clips OBS permet de voir et de préparer le tampon de relecture.
- Le chat Twitch intégré utilise le compte OAuth confirmé de la source choisie.
  L’envoi affiche le compte utilisé ; si le résultat est incertain, le brouillon
  reste en place. Vérifiez le chat avant de réessayer un envoi non confirmé.
- Les lecteurs Twitch et YouTube sont des retours de la plateforme, avec son
  délai et ses publicités éventuelles. Les liens Régie Twitch et YouTube Studio
  ouvrent les outils créateurs dans le navigateur habituel.
- Le flux Streamlabs affiche la source choisie : régie ou connexion indépendante
  de cet appareil. Chaque source garde son propre historique ; le choix est
  mémorisé pour l’espace utilisé et le rafraîchissement continue pendant la saisie.

APK ANDROID ASSOCIÉE
L’APK StreamDashboard-Next-2.0.0-rc.11.1.apk est fournie séparément. Elle utilise
le même identifiant d’application que RC11 et un versionCode plus élevé.
L’installation n’est pas exécutée par ce paquet Windows.

VALIDATION DU PAQUET
Le contrôle de construction compare les nouveaux assets au code compilé et
vérifie que l’intégrité ASAR embarquée dans l’EXE correspond à son archive.
Les sommes SHA-256 des livrables sont remises avec la livraison. Elles vérifient
le fichier reçu ; elles ne constituent pas une signature Authenticode Windows.
