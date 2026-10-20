# StreamDashboard Next — RC8, installation indépendante

Cette candidate commence la généralisation de StreamDashboard : chaque utilisateur configure ses appareils et ses comptes. Aucun nom de machine, compte de streamer ou serveur personnel n’est imposé. Un PC avec OBS suffit ; un PC de pilotage et un téléphone sont facultatifs. Un serveur permanent peut être ajouté ultérieurement, mais cette version n’en installe aucun et n’en exige aucun.

## Première utilisation

1. Windows : extraire la distribution dans un nouveau dossier et lancer `StreamDashboard.exe`. Choisir un nom et le rôle **PC de stream** ou **PC de jeu**. Un changement de rôle redémarre l’application ; il est refusé pendant un live ou un enregistrement OBS. Les lanceurs Host/Client permettent aussi un choix explicite.
2. Android : installer l’APK puis nommer l’appareil. L’application s’ouvre sans connexion préalable à un PC. Planning, événements, séries, exceptions, modèles et réglages non secrets sont sauvegardés localement.
3. **Mes comptes** dans l’en-tête connecte les comptes de cet appareil. Ce bouton fonctionne indépendamment de la régie sélectionnée. Les autorisations de la régie restent dans Configuration → Diffusion et Intégrations. Les jetons OAuth ne sont pas partagés entre appareils.
4. Sur le PC de stream, activer l’accès réseau local dans Configuration → OBS, redémarrer, puis créer un code de gestion complète dans Appareils. Coller le lien dans **Appareils → Associer une régie** sur le téléphone ou le PC de pilotage. Chaque appareil reçoit son propre code.
5. Les données déjà présentes sur la régie apparaissent sans remplacement. Pour les données créées avant association : Configuration → Appareils → **Transférer mes créations locales**. Vérifier la destination et la liste, puis confirmer le transfert. La copie d’origine reste disponible ; un même transfert ne crée pas de doublon. Les conflits demandent un choix dans Synchronisation.

**Ouvrir mon espace local** et **Retrouver ma régie** changent l’espace affiché sans effacer les données. Une association refusée conserve l’adresse et l’autorisation précédentes. Les copies de régies restent liées à leur adresse et à leur identité ; conserver la même adresse pendant les premiers essais.

## Ce que fait cette candidate

| Fonction | Sans autre PC allumé | Avec la régie connectée |
| --- | --- | --- |
| Ouvrir l’application Windows de pilotage / Android | Oui, dès la première installation | Oui |
| Créer et modifier planning et configuration non secrète | Sauvegarde locale durable | Synchronisation et gestion des conflits |
| Autoriser Twitch sur le téléphone | Connexion native par code d’appareil | Connexion native toujours indépendante |
| Autoriser Calendar et consulter l’identité YouTube sur Android | Google Identity Services, sous réserve du projet Google correctement enregistré | Même fonctionnement |
| Autoriser les comptes sur le PC de pilotage | Service propre à ce PC, aucun démarrage d’OBS | Même fonctionnement |
| Publications du planning, informations communes Twitch + YouTube, messages WizeBot | Préparation locale ; exécution via la régie encore nécessaire dans l’interface Next | Parcours RC6/RC7 conservés |
| Micro, scènes, sons, clips, lancement Twitch + YouTube | Appareil exécutant OBS nécessaire | Commandes communes, résultats réels distincts |

Les connexions indépendantes ne rendent donc pas encore toutes les opérations externes autonomes sur Android. Le branchement des publications natives du planning et des actions cloud à l’interface Next reste à terminer ; leurs identifiants distants devront être transférés sans recréer les événements lors d’une synchronisation. Aucun succès ni publication n’est annoncé à leur place. YouTube Android demande actuellement uniquement la lecture du compte ; les opérations de diffusion existantes continuent de passer par la régie.

## Comptes et distribution

Twitch Android utilise le flux officiel Device Code Grant, avec l’identifiant public de l’application fourni par la distribution. Le code secret d’appareil et les jetons restent chiffrés dans Android Keystore. Expiration, intervalle de vérification et ralentissement sont respectés. La connexion de base n’exige pas le statut affilié ; la publication du planning Twitch le nécessite toujours.

Google Android utilise AuthorizationClient de Google Play Services : consentement par service, vérification des permissions accordées et restauration silencieuse après redémarrage. Une restauration nécessitant un nouveau consentement ne lance pas de fenêtre à l’insu de l’utilisateur. Déconnecter Google ferme les autorisations locales Calendar et YouTube ensemble. Il faut enregistrer **le package et le certificat Android de cette distribution** dans le projet OAuth de l’éditeur ; ce paramétrage n’est pas demandé à chaque ami/utilisateur.

Pour cette candidate de test :

- Package : `com.rastaaslan.streamdashboard.remote.next`.
- SHA-1 du certificat conservé : `E2:F2:1F:4C:28:79:DE:33:B8:85:A4:54:8B:DF:D5:A2:21:2B:1B:1F`.
- SHA-256 : `C0:9E:61:D5:1A:DC:C0:E0:63:98:E5:F2:3B:C4:A8:8A:A3:AF:B6:84:93:DE:A1:56:4F:0B:24:8F:CB:34:03:B0`.

Cette signature de test permet la mise à jour des candidates existantes. Pour une distribution commerciale, utiliser une signature de production conservée par l’éditeur, enregistrer son empreinte Google, finaliser le consentement OAuth et la configuration publique Desktop/Android de distribution. La configuration Google Desktop existante requiert encore son Client Secret dans le stockage sécurisé de chaque installation ; l’intégration d’un parcours de distribution sans cette configuration manuelle reste à finaliser. Ne pas publier les données utilisateur ni un export des secrets avec les paquets.

Références de mise en œuvre : [Twitch Device Code Grant](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow), [Google Android Authorization](https://developer.android.com/identity/authorization).

## Migration de l’installation actuelle

Conserver les dossiers et paquets antérieurs. Sauvegarder `%APPDATA%\StreamDashboard-Next`, puis fermer Next hors live avant d’utiliser le nouveau dossier. Sur l’installation de Damien, **FIXE reste la régie** et **Laptop-damien le PC de pilotage avec Synapse et le BlackWidow**. Ces noms sont des exemples de cette installation, pas des valeurs imposées aux nouveaux utilisateurs.

Les comptes,  associations, données et macros de la régie sont repris dans leur stockage existant. Le PC de pilotage conserve ses associations et ajoute un service local sur `127.0.0.1:48135`, avec données et secrets séparés dans `device-runtime`. Son interface conserve le port 48134. Ce service local n’ouvre aucun port LAN et ne se connecte pas à OBS, même si une adresse OBS est enregistrée. Le choix de rôle et le nom de l’appareil sont conservés dans `device-role.json`.

Sur le téléphone, installer RC8 par-dessus la candidate existante **sans désinstaller ni effacer les données**. Le stockage RC7 et ses modifications en attente sont conservés. Le nouvel espace avant association est séparé des anciennes copies de régie. Synchroniser ou exporter les modifications en attente avant un retour arrière ; une ancienne version ne les affichera pas nécessairement.

Les macros personnalisées restent inchangées. Pour un nouveau clavier, configurer les six raccourcis Ctrl + Alt + Maj + F1 à F6 dans son logiciel ; modifier leur fonction dans Boutons & macros. Les sons sont déclenchés et arrêtés depuis la soundboard. Le guide RC7 reste applicable à la synchronisation et aux sauvegardes.

## Vérifications et limites de livraison

- Compilation TypeScript et Java/Android ; contrôle du JavaScript embarqué.
- Tests ciblés contrôle commun, Twitch, WizeBot, autonomie et interface Android ; tests natifs de consentement, restauration sans fenêtre, permissions insuffisantes et déconnexion.
- Parcours navigateur : appareil vierge sans aucun hôte, premier démarrage, création d’événement, fermeture complète/réouverture, écran des comptes avec adaptateur natif simulé, association ultérieure, transfert explicite et répétition sans doublon.
- Régression RC7 : planning, paramètres, modèles, séries/exceptions, conflits, perte d’accusé de réception et redémarrage de la régie.
- Régression RC6 : commandes clavier/téléphone, scènes, micro, clips, sons et WizeBot avec OBS et services simulés. Aucun live ni message public réel envoyé.

FIXE et Laptop-damien étant hors ligne pendant la préparation, la candidate n’a pas remplacé leurs installations. Installation physique, connexion OAuth réelle sur le S24 et validation du changement de rôle dans Windows restent à effectuer. Cette livraison est une **candidate de développement**, pas encore une version prête à commercialiser. La licence de distribution, la signature de production et le parcours OAuth des nouveaux utilisateurs restent à arrêter avant diffusion publique.
