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

## Android comme exécuteur

1. Sur Android, importer les sons dans **Mon espace**, puis ouvrir **Configuration → Appareils → Connexion sécurisée** et activer le partage réseau.
2. Créer un code d’association et choisir les permissions. Copier le lien avec son empreinte dans **Connexions** sur l’autre application Windows ou Android. La permission Audio autorise les sons ; Chat autorise l’ouverture des écrans ; l’administration complète autorise les modifications synchronisées.
3. Choisir cet Android dans **Mon installation → Ouvrir cet appareil**, ou associer un bouton dans **Destination**. L’exécuteur figure sur le bouton et dans le reçu. Le son doit déjà être importé sur Android ; aucun autre appareil ne le remplace automatiquement.
4. Pour afficher les retours, utiliser **Mon installation → Ouvrir ses écrans**, puis renseigner la chaîne Twitch et l’identifiant YouTube. Les sessions web restent celles du téléphone.
5. Garder l’application Android ouverte. L’arrêt de l’application ferme le récepteur ; après une coupure, vérifier le résultat d’une commande avant de la demander de nouveau. Les commandes ne sont jamais rejouées à la reconnexion.
6. Les appareils autorisés peuvent être limités ou révoqués depuis Android. La révocation n’est pas bloquée par un son en préparation.

## Limites de cette version d’essai

Les associations Next 2.1 utilisent HTTPS avec vérification d’empreinte. Les anciennes adresses HTTP restent conservées mais doivent être associées de nouveau en HTTPS. La lecture audio multiple locale est disponible sur Windows et Android.

La découverte automatique, le transfert transactionnel complet des responsabilités, toutes les macros natives des contenus locaux Windows et le transfert de fichiers vers le récepteur Android restent à compléter. Les réglages de comptes et de partage Android se font sur Android. Les reçus d’écriture interrompue restent à vérifier ; aucun succès n’est déduit d’une simple reconnexion.

La qualification complète des six installations, la migration d’une copie réelle RC11.7, les sessions de comptes réels, la mise à jour et le retour arrière restent ouverts. Aucun téléphone n’était connecté à ADB lors de cette vérification. Les paquets compilés sont des candidats d’essai ; ils ne remplacent pas RC11.7. Voir le [bilan Android](qa/2026-10-21-android-executor.md) et la [matrice](qa/next21-qualification.json).
