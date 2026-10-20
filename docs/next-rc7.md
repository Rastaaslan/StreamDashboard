# StreamDashboard Next — RC7, autonomie des appareils

## Utilisation

FIXE conserve son rôle de régie : OBS, diffusion Twitch + YouTube, sons et interactions. Laptop-damien et le S24 Ultra conservent désormais leur propre copie des données. Après une première connexion à la régie RC7, on peut fermer et rouvrir leur application, consulter le planning et travailler hors ligne. Utiliser l’application Windows en mode client ou l’APK : une simple page web servie par FIXE ne peut pas se recharger lorsque FIXE est éteint.

- Planning : création, modification, suppression, séries, exceptions d’occurrence, modèles, export PNG. Les publications souhaitées sont appliquées lors de la synchronisation avec la régie ; leur résultat reste distinct du simple enregistrement local.
- Configuration : boutons et associations macros, OBS et scènes, sorties Twitch/YouTube, profil, métadonnées des sons, règles d’automatisation, destination Google et paramètres non secrets Discord.
- Brouillons locaux : informations du prochain live et réponses WizeBot. Leur application aux plateformes ou au chat exige un nouvel appui explicite en ligne.
- **Synchronisation** dans l’en-tête : nombre de modifications en attente, dernières données reçues, comparaison des versions en conflit, choix de sa version ou de celle de la régie et export JSON de la copie locale.

Des modifications de champs différents fusionnent automatiquement. Deux valeurs différentes pour un même champ, ou une modification face à une suppression, demandent un choix. Les autres entités continuent leur synchronisation. Les modifications locales restent affichées et enregistrées tant qu’elles ne sont pas acceptées par la régie. Une validation serveur refusée apparaît également dans cet écran.

Les commandes micro, scène, son, clip, minuteur, chat et lancement/arrêt du live ne sont jamais mises en attente. Les commandes restent également suspendues si des réglages de pilotage attendent une synchronisation ou une résolution, pour éviter d’exécuter une ancienne association. Hors connexion, leur résultat est inconnu et leurs boutons de déclenchement sont suspendus. Les boutons et les fichiers audio restent préparables/configurables dans la mesure indiquée ci-dessus ; l’exécution continue d’appartenir à FIXE.

## Installation et connexion

1. Sauvegarder `%APPDATA%\StreamDashboard-Next` et conserver la distribution RC6. Ne pas modifier l’installation historique.
2. Sur FIXE, fermer Next lorsque le live et l’enregistrement sont arrêtés. Extraire le ZIP dans un nouveau dossier, lancer `Start-Next-Host.cmd`. Les données existantes, les comptes, les sons et les associations sont repris.
3. Sur laptop-damien, fermer Next puis lancer `Start-Next-Client.cmd` depuis la nouvelle distribution. Garder Synapse et le clavier sur ce PC. Les macros M1–M6 restent Ctrl + Alt + Maj + F1–F6 ; aucun remplacement des associations personnalisées.
4. Installer l’APK RC7 par-dessus RC6 sur le S24 Ultra, **sans désinstaller**. La signature et l’identifiant Android Next sont conservés.
5. Connecter chaque application une fois à `http://FIXE:48133` ou à l’adresse LAN déjà utilisée (actuellement `http://192.168.1.158:48133`). Attendre « copie locale à jour ». L’association existante reste valable ; si nécessaire, créer un code de gestion complète distinct par appareil depuis FIXE → Configuration → Appareils.
6. Pour vérifier l’autonomie : couper la connexion à FIXE, rouvrir l’application, créer un événement personnel sans publication, puis reconnecter et vérifier le planning de FIXE.

Les modifications hors ligne sont liées à l’adresse et à l’identité de la régie. Changer d’adresse ouvre une autre copie ; l’ancienne n’est pas effacée. Garder la même adresse pendant les premiers essais. Une régie réinitialisée à la même adresse est détectée : les données en attente sont conservées et ne sont pas transférées à son insu.

## Sauvegarde et retour arrière

La régie ajoute `config/autonomy-v1.json` au stockage Next : identité stable et accusés de réception durables. Les clients utilisent IndexedDB dans le stockage de leur application, séparément des identifiants conservés par les mécanismes existants. Les écritures locales sont annoncées uniquement après la validation de la transaction. Ne pas effacer les données de l’application ni désinstaller l’APK avec des modifications en attente. L’export JSON est un secours consultable ; il n’existe pas encore d’import automatique de cet export.

La RC6 reste compatible avec les données métier. Revenir à son exécutable ou APK peut toutefois masquer les modifications encore uniquement locales à RC7 ; synchroniser/exporter avant le retour arrière. Ne pas rétrograder l’APK en supprimant les données pour contourner le contrôle Android.

## Limites explicites

- Première récupération des données et association : régie accessible nécessaire.
- OAuth, changement de mots de passe/jetons, import du fichier audio, détection de sorties OBS, recherche de catégories Twitch, lecture des calendriers Google, publication Discord et actualisation distante WizeBot : connexion nécessaire. Les secrets ne sont pas stockés dans la file hors ligne.
- La suppression par période hors ligne exclut les séries, la lecture seule et les événements dont une publication doit être conservée ; utiliser leur formulaire individuel. Les exceptions de séries sont prises en charge.
- La suppression différée d’un son retire son entrée du catalogue et conserve le fichier pour récupération ; elle ne coupe jamais une lecture en cours à la reconnexion.
- Les brouillons de live et WizeBot sont propres à l’appareil. Les réglages métier et le planning sont partagés ; le choix de page et les préférences d’affichage restent locaux.

## Vérifications

37 tests ciblés : contrôle commun, Twitch, WizeBot, fusion, conflit, déduplication et journal après interruption. Parcours navigateur avec deux clients et serveur réel : création hors ligne depuis le formulaire, fermeture complète/réouverture, synchronisation, conflit comparé et résolu, modifications indépendantes, perte de réponse après écriture, redémarrage de la régie, paramètres, modèles, série et exception, suppressions et définition d’automatisation. Parcours RC6 rejoué : micro/scènes, replay, sons et boutons WizeBot, édition et confirmation simulée.

Les services externes sont simulés pour ces essais : aucun live lancé et aucun message réel envoyé. Installation sur FIXE et laptop-damien, puis validation du stockage sur le S24 physique, restent à effectuer lorsqu’ils seront accessibles. Leurs installations RC6 n’ont pas été modifiées pendant cette livraison.
