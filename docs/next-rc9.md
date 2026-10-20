# StreamDashboard Next — RC9 : gestion autonome par appareil

Cette candidate relie les comptes de chaque appareil au planning et aux intégrations de gestion. Elle conserve la régie existante et les parcours du live. Aucun serveur permanent, nom de machine ou compte personnel n’est imposé.

## Utilisation

1. Installer l’APK par-dessus Next, sans désinstaller et sans effacer ses données. Sur Windows, extraire la nouvelle archive dans un dossier distinct ; conserver l’ancienne distribution. Les données Next restent dans son profil utilisateur.
2. Sur le téléphone ou le PC de jeu, choisir **Mon espace** dans l’en-tête. L’application fonctionne même si les autres machines sont éteintes. Pour Damien : **FIXE = stream**, **laptop-damien = jeu + Synapse**, **S24 Ultra = mobile**.
3. Ouvrir **Mes comptes** et connecter les comptes propres à cet appareil. Réautoriser Twitch après RC8 pour ajouter la permission d’édition WizeBot par le chat. Les jetons restent dans Android Keystore ou le stockage sécurisé Windows.
4. Dans Configuration → Intégrations, sélectionner le calendrier Google cible et, si nécessaire, configurer Discord ou les autres intégrations sur cet appareil.
5. Créer ou modifier les événements dans Planning. Cocher Twitch et/ou Google pour publier directement. Chaque destination affiche son résultat ; un échec ne supprime pas les données locales. Utiliser **Réessayer** sur la destination concernée. Les conflits demandent un choix explicite.
6. **Actualiser les publications** renouvelle les occurrences des séries matérialisées. Le même moteur que sur desktop conserve les exceptions et publie les sept prochaines occurrences admissibles. L’application doit être ouverte ; cette candidate n’ajoute pas un service Android de publication en arrière-plan.

## Périmètre de l’autonomie

| Parcours | Sans autre appareil allumé |
| --- | --- |
| Événements, séries, exceptions, modèles, profil et réglages | Stockage local durable ; création, modification et suppression |
| Publication Twitch / Google Calendar | Directe avec les comptes de cet appareil ; Internet et autorisations du service requis |
| Calendriers Google | Choix du calendrier, import complet, actualisation et signalement des conflits |
| Export du planning | PNG généré sur l’appareil ; publication Discord via son propre bot |
| Sons | Import du fichier et gestion du catalogue local ; transfert des fichiers lors de l’association |
| WizeBot | Lecture du catalogue public, import des boutons, édition des réponses SAY et confirmation par relecture |
| Configurations sensibles | Sauvegarde locale chiffrée ; les secrets ne sont pas transférés ou exportés dans la réplique |
| OBS, diffusion, scènes, micro, replay, sons sur le stream et exécution des automatisations | Hors de ce chantier : exécution sur la régie conservée |

Les opérations externes utilisent Internet. Une perte de réseau conserve le planning et les réglages ; elle n’est jamais présentée comme une publication réussie. Les messages ne sont pas mis en file pour être envoyés après reconnexion. Un résultat incertain est affiché et ne provoque aucun renvoi automatique.

Les calendriers externes importés restent en lecture seule ; ils peuvent être dupliqués. Une règle externe non représentable reste conservée avec son origine, sans conversion silencieuse en événement simple. Les limites propres à Twitch et Google restent applicables.

## Espaces et transfert

**Mon espace** contient les données et comptes de cet appareil. **Ma régie** retrouve la copie synchronisée de la régie associée et ses commandes. Une copie de régie hors ligne reste modifiable ; ses modifications attendent son retour. Ces deux espaces sont distincts : ouvrir l’espace autonome ne s’approprie pas automatiquement les publications d’une régie éteinte.

Pour transférer les créations autonomes : mettre les appareils à jour en RC9, associer la destination puis Configuration → Appareils → **Transférer mes créations locales**. La confirmation présente la destination. Les identifiants distants, révisions, exceptions, conflits et suivis de publication sont conservés. Aucun événement n’est recréé à distance par l’import lui-même. Les sons sont transférés avec leur identité stable ; un nouvel essai après réponse perdue ne crée pas un second fichier.

Après transfert, les événements d’origine restent consultables et leur gestion passe à la destination. Ce passage évite deux moteurs publiant simultanément la même série. Une publication incertaine doit être réconciliée avant transfert. Les comptes restent propres à chaque appareil ; reconnecter sur la destination les comptes qui possèdent les publications.

Les copies locales RC7/RC8 sont conservées. La base IndexedDB passe en version 2 pour stocker les fichiers audio ; aucun effacement n’est effectué. Ne pas ouvrir une ancienne version de Next simultanément avec RC9 sur le même profil pendant cette migration.

## Garanties de reprise

- Le moteur de planning est partagé entre desktop et mobile, compilé pour le navigateur ; les récurrences et règles de suppression ne sont pas réécrites séparément.
- L’intention de création et son identité sont sauvegardées avant l’appel externe. Les écritures sont sérialisées entre fenêtres d’un même espace.
- Google conserve le calendrier cible, les ETags et les identités stables des occurrences. Les créations d’occurrences incertaines sont réconciliées avec la même identité.
- Android conserve les reçus Twitch confirmés avant de répondre à l’interface. Sans reçu certain, aucune création à l’aveugle n’est autorisée. Le compte propriétaire est conservé.
- Les opérations natives Android s’exécutent hors du fil JavaScript ; l’interface reçoit un résultat asynchrone. Fermer l’écran ne fait pas disparaître le journal durable.
- WizeBot affiche « À vérifier » tant que sa nouvelle réponse n’a pas été relue exactement. Un envoi Twitch confirmé ne vaut pas confirmation d’une modification chez WizeBot.

## Validation et limites de livraison

Les tests automatisés utilisent des services simulés. Ils couvrent la création locale, le redémarrage complet du navigateur, les publications indépendantes, la réussite partielle, la reprise sans doublon, les séries et exceptions, les créations à réponse perdue, l’import audio et le transfert des fichiers/identités. Les parcours antérieurs de synchronisation, conflit, macro de clip et WizeBot ont été rejoués en simulation. Aucun live ni message public réel n’a été lancé pendant ces essais.

Restent à valider sur les appareils : OAuth réel Google/Twitch, permissions des comptes, publication puis modification/suppression d’un événement de test, réception Discord et WizeBot, et ergonomie du S24. FIXE et le laptop étaient hors ligne pendant la préparation : leurs installations n’ont pas été remplacées.

Le projet OAuth Google de l’éditeur doit autoriser le package `com.rastaaslan.streamdashboard.remote.next` et le certificat de cette distribution. Pour commercialiser/distribuer largement, conserver une signature de production stable et finaliser la configuration/validation OAuth de l’éditeur. Aucun jeton ou secret utilisateur n’est incorporé à l’APK ou à l’archive Windows.

Références techniques : [Google Calendar](https://developers.google.com/workspace/calendar/api/v3/reference/events), [Twitch Schedule](https://dev.twitch.tv/docs/api/schedule), [Discord Messages](https://docs.discord.com/developers/resources/message). La découverte du catalogue WizeBot réutilise le protocole public observé et testé dans les versions précédentes ; un changement de format conserve les données déjà chargées.
