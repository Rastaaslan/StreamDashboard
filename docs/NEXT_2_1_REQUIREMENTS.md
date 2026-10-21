# Cahier des charges — StreamDashboard Next 2.1
## Architecture universelle, conception simultanée de tous les setups et correction des visionneuses

**Statut :** Spécification fonctionnelle et technique consolidée — à développer et à qualifier
**Révision :** 21 octobre 2026 — intégration de l’avenant P0
**Priorité :** P0 — conception simultanée de tous les setups, exigence architecturale non négociable
**Base vérifiée :** RC11.7 — commit `4c80ba3` ; branche de réalisation créée sur `28c1b7e` (uniquement un complément de compte rendu après RC11.7).
**Branche de référence :** `work/streamdashboard-desktop-live-reliability`
**Plateformes :** Windows 11, Android ; architecture extensible
**Objectif :** rendre StreamDashboard utilisable par tout streamer, quel que soit son matériel, sans dépendance à l'infrastructure personnelle du créateur.

---

## 1. Vision du produit

### Décision P0 faisant autorité

StreamDashboard est conçu dès le départ comme un système universel, modulaire et indépendant du nombre d’appareils. Tous les formats d’installation sont inclus dans le périmètre initial de développement :

- Mono-PC Windows.
- Mono-PC Windows + Android Deck.
- Double-PC Windows.
- Double-PC Windows + Android Deck.
- Android autonome.
- Configuration personnalisée avec plusieurs contrôleurs et appareils.

Les situations où un appareil est éteint, déconnecté ou temporairement indisponible appartiennent au même périmètre initial.

**Aucun setup ne doit être traité comme une adaptation ultérieure ou différé à une version suivante.** Les fonctionnalités sont développées par modules transversaux et qualifiées sur toutes leurs combinaisons compatibles.

Cette révision remplace l’ancien plan par phases successives, notamment la phase « Mono-PC et agent OBS » suivie d’une association Android plus tardive. En cas de contradiction, cette décision P0 et les lots A à D de la section 14 prévalent.

Le présent document décrit des exigences. Il n’atteste ni leur implémentation ni leur qualification sur les appareils réels.

### Vision commune

StreamDashboard doit devenir une solution modulaire de gestion de streaming permettant de contrôler OBS, les plateformes de diffusion, les chats, les événements, les macros, les sons et les plannings depuis un ou plusieurs appareils.

Le nombre d'ordinateurs ne doit plus déterminer les fonctionnalités disponibles.

**Principe fondamental : un appareil peut assurer plusieurs rôles, et un rôle peut être déplacé d'un appareil à un autre.**

L'utilisateur doit pouvoir choisir son installation initiale, la modifier ultérieurement et conserver ses données sans devoir réinstaller ou reconfigurer toute l'application.

### Objectifs non négociables

- Une application Windows unique avec modules activables.
- Une application Android Deck autonome.
- Aucune obligation de posséder un PC dédié au streaming.
- Aucune obligation d'ouvrir la fenêtre StreamDashboard pour contrôler OBS.
- Aucun serveur central personnel obligatoire.
- Fonctionnement autonome des comptes et services cloud sur chaque appareil.
- Conservation des fonctionnalités et corrections de la RC11.7.
- Compatibilité avec les installations existantes.
- Possibilité de distribuer le logiciel à des utilisateurs extérieurs.

## 2. Choix du setup

Au premier lancement, un assistant de configuration permet de sélectionner son installation.

### Configuration A — Mono-PC

**Un ordinateur assure le jeu, la diffusion et le contrôle.**

Modules activés sur le même PC :

- Agent OBS/Aitum.
- Tableau de bord.
- Macros globales.
- Twitch et YouTube.
- Streamlabs et WizeBot.
- Planning et Google Calendar.
- Soundboard et gestion des clips.

Les commandes doivent fonctionner lorsque le tableau de bord est réduit, masqué ou fermé, dès lors que les composants d’exécution concernés restent actifs. Le moteur de raccourcis globaux doit donc lui aussi pouvoir fonctionner sans fenêtre.

### Configuration B — Double-PC

**Préréglage : un PC diffuse, un second pilote.** Les appellations « PC stream » et « PC jeu » ci-dessous décrivent ce préréglage ; elles ne constituent jamais des identités ou des dépendances obligatoires dans le code.

PC stream :
- OBS et Aitum.
- Agent StreamDashboard léger.
- Exécution des commandes OBS.
- Gestion des sorties et du tampon de relecture.

PC jeu :
- Tableau de bord complet.
- Macros et raccourcis globaux.
- Visionneuses Twitch/YouTube.
- Chats, événements et planning.
- Commandes distantes de l'agent OBS.

Le tableau de bord du PC stream reste facultatif. Les raccourcis capturés sur le PC jeu doivent continuer à fonctionner sans tableau de bord ouvert sur celui-ci, tant que son moteur de macros reste actif. Un agent OBS actif sur une autre machine ne peut pas, à lui seul, capturer les touches du PC jeu.

### Configuration C — Mono-PC Windows + Android Deck

L’ordinateur exécute OBS et son agent. Android conserve ses propres comptes, services cloud et données utilisables de façon autonome ; il ne dépend de l’agent PC que pour les actions nécessitant les capacités de ce PC.

Le téléphone sert de contrôleur tactile :
- Scènes et microphone.
- Macros.
- Déclenchement des clips.
- Soundboard local.
- Commandes WizeBot.
- Événements et alertes.
- Planning et informations du live.

### Configuration D — Double-PC + Android

Le PC stream héberge l'agent OBS, le PC jeu le contrôleur et le téléphone le Deck.

Les trois appareils communiquent sans imposer qu'une interface graphique soit ouverte sur le PC stream.

### Configuration E — Android autonome

Sans ordinateur connecté, Android conserve :

- Gestion des comptes compatibles, Twitch et YouTube compris.
- Chats Twitch et YouTube simultanés, indépendants d’OBS.
- Visionneuses selon les capacités disponibles, avec diagnostic et repli externe.
- Historique cloud Streamlabs.
- Gestion du planning.
- Google Calendar.
- Configuration des plateformes.
- Commandes et modèles WizeBot.
- Soundboard local.
- Export et import des données.

Les fonctions exigeant OBS apparaissent indisponibles, avec une explication claire, sans bloquer le reste de l'application.

### Configuration F — Personnalisée, plusieurs contrôleurs et appareils

L’utilisateur associe plusieurs ordinateurs et/ou téléphones, puis affecte les responsabilités selon les capacités et permissions réelles de chacun.

- Plusieurs interfaces peuvent consulter les mêmes états et piloter un exécuteur autorisé.
- L’appareil de lecture vidéo, l’appareil de sortie audio, le contrôleur et l’exécuteur OBS peuvent être distincts.
- Une instance OBS ne reçoit pas des commandes concurrentes non coordonnées de plusieurs agents.
- La disparition d’un contrôleur ne prive pas les autres de leurs fonctions compatibles.
- L’absence d’un exécuteur rend ses actions indisponibles sans bloquer les fonctions locales ou cloud.
- Le remplacement d’un appareil ou le déplacement d’un rôle conserve les données pertinentes et nécessite une association sécurisée.

### Matrice fonctionnelle obligatoire

Chaque ligne doit être spécifiée, implémentée et qualifiée dans toutes ses configurations compatibles au sein du même chantier.

| Fonction | Mono-PC | Double-PC | Avec Android | Android seul |
|---|---|---|---|---|
| OBS / Aitum | Local | Distant | Via agent PC | Indisponible |
| Macros | Locales | Distantes | Locales ou distantes | Actions compatibles |
| Twitch / YouTube | Autonomes | Autonomes | Autonomes | Autonomes |
| Visionneuses | Locales | Sur appareil choisi | Selon capacités | Selon capacités |
| Chats | Local | Local ou distant | Autonome | Autonome |
| Streamlabs cloud | Direct | Direct | Direct | Direct |
| Planning | Local/cloud | Local/cloud | Local/cloud | Local/cloud |
| Sons | PC | PC choisi | Téléphone ou PC | Téléphone |
| Clips OBS | Local | Distant | Via agent PC | Indisponible |

« Avec Android » couvre à la fois mono-PC + Android et double-PC + Android. La configuration personnalisée applique chaque ligne à chaque appareil concerné selon ses capacités et permissions ; elle doit également être qualifiée avec plusieurs contrôleurs actifs.

« Autonome » signifie sans dépendance à un autre appareil StreamDashboard. L’accès à un service cloud reste soumis au réseau, aux autorisations du compte et aux possibilités du fournisseur. Une capacité absente doit produire un état explicite et ne doit pas bloquer le reste de l’application.

## 3. Assistant de configuration

### Premier démarrage

L'application demande :

1. Quel est le type d’installation ? Mono-PC Windows, mono-PC + Android Deck, double-PC Windows, double-PC + Android Deck, Android autonome ou personnalisé.
2. Sur quel appareil fonctionne OBS, ou aucun si OBS n’est pas utilisé ?
3. Souhaitez-vous utiliser le contrôle OBS en arrière-plan ?
4. Quels appareils supplémentaires souhaitez-vous associer ?
5. Quelles plateformes souhaitez-vous connecter ?

Les modules nécessaires sont activés automatiquement.

L'utilisateur avancé peut modifier manuellement les rôles.

### Modification ultérieure

Depuis **Paramètres → Mon installation** :

- Ajouter ou retirer un appareil.
- Passer du mono-PC au double-PC et du double-PC au mono-PC.
- Ajouter ou retirer Android Deck.
- Déplacer le rôle d’agent OBS et les autres responsabilités compatibles.
- Activer ou désactiver le Deck.
- Modifier le PC de contrôle.
- Dissocier un appareil.
- Sauvegarder et restaurer une configuration.

Le choix du setup est un préréglage de configuration au-dessus d’une architecture commune, jamais un choix entre plusieurs versions du logiciel.

Une modification de setup ne doit jamais supprimer automatiquement les macros, scènes associées, sons, plannings, identités, associations, comptes ou paramètres pertinents.

Avant application, présenter les changements de rôles, les fonctions qui deviendraient indisponibles et les associations à renouveler. Vérifier les capacités de destination, sauvegarder la configuration, puis appliquer la transition de façon transactionnelle autant que possible. Prévoir l’annulation ou la restauration et la reprise après interruption, sans double exécution ni suppression silencieuse.

La conservation des identités et associations ne signifie pas la copie de secrets ou de cookies entre appareils : les autorisations propres à chaque appareil restent isolées et une nouvelle authentification est demandée lorsque nécessaire.

## 4. Architecture modulaire

### Modèle commun : appareil, capacité, rôle

| Concept | Définition | Exemples |
|---|---|---|
| Appareil physique | Ordinateur Windows ou téléphone Android associé | Un PC, un téléphone |
| Capacité | Fonction réellement disponible sur cet appareil | OBS, raccourcis globaux, lecteur vidéo, audio local, connexion cloud, stockage |
| Rôle | Responsabilité affectée à un appareil | Pilotage, exécution OBS, affichage, services |

Un appareil peut posséder plusieurs rôles et plusieurs capacités. Un rôle ne dépend d’un type de matériel que si une contrainte technique réelle le justifie. Les fonctionnalités ne supposent jamais l’existence d’un PC stream, d’un PC jeu ou d’un téléphone.

Les modules résolvent leurs destinations à partir des appareils, capacités, disponibilités et permissions. Les chemins local et distant partagent les contrats d’action, d’état, d’erreur et d’accusé. Les préréglages ne doivent pas introduire des implémentations fonctionnelles distinctes.

La disponibilité doit distinguer au minimum capacité absente, appareil hors ligne, composant arrêté, autorisation manquante, reconnexion en cours et état disponible. La perte d’un exécuteur ne désactive pas les services cloud ou les actions locales indépendantes.

### 4.1 Application Windows

Une seule application distribuée, composée de modules indépendants :

**Agent OBS**
- Communication OBS WebSocket.
- Pilotage Aitum/Stream Suite.
- Scènes, micro, sources et sorties.
- Replay Buffer et clips.
- Surveillance de l'état réel de diffusion.
- Gestion des commandes et de leurs accusés.

**Contrôleur**
- Interface de pilotage.
- Configuration et suivi des macros globales, avec moteur d’exécution indépendant de la fenêtre.
- Visionneuses et chats.
- Gestion des appareils.
- État des services.

**Services cloud**
- Twitch.
- YouTube.
- Streamlabs.
- Google Calendar.
- WizeBot.
- Planning et exports.

Un même PC doit pouvoir exécuter tous les modules simultanément.

### 4.2 Agent en arrière-plan

L'agent OBS doit pouvoir fonctionner indépendamment du tableau de bord.

Exigences :

- Démarrage automatique facultatif avec Windows.
- Fonctionnement sans fenêtre.
- Faible consommation CPU/RAM au repos.
- Icône de zone de notification et état de connexion si pertinent.
- Arrêt et redémarrage manuels.
- Journalisation locale.
- Reconnexion OBS automatique avec temporisation.
- Aucun démarrage automatique de live.
- Mise à jour interdite pendant un live ou enregistrement actif.
- Contrôle explicite des permissions des appareils associés.

Privilégier un processus utilisateur léger pour interagir avec OBS, sans service privilégié Windows sauf nécessité démontrée.

### 4.3 Communication entre appareils

- Découverte locale facultative.
- Association par QR code ou code temporaire.
- Authentification mutuelle.
- Permissions par appareil.
- Transport chiffré pour les communications distantes.
- Reconnexion automatique.
- Gestion des commandes interrompues.
- Accusés de réception avec identifiants uniques.
- Aucune répétition aveugle d'une commande au résultat incertain.

Pas de dépendance obligatoire à un serveur central ou à dam-server.

La présence de plusieurs interfaces ne doit pas créer plusieurs agents concurrents pilotant la même instance OBS sans coordination explicite.

Les scénarios de reconnexion, de changement d’exécuteur et de changement de rôle doivent conserver une attribution non ambiguë des actions. Un résultat incertain reste signalé comme tel jusqu’à vérification ; il n’autorise pas la répétition aveugle d’une commande.

## 5. Visionneuse Twitch — correction prioritaire

### Exigences transversales pour les visionneuses et chats

Les corrections des sections 5 à 7 appartiennent au même chantier sur Windows et Android, sur tous les setups compatibles. Le module commun de visionneuse utilise les capacités réelles de l’appareil hôte ; il ne suppose jamais un lecteur situé sur le PC stream.

Les sessions API, les sessions web des lecteurs et les identités de chat doivent être distinguées, affichées et gérées par appareil. Aucun état connecté ne doit être déduit d’une autre session ou d’un autre appareil sans preuve. Lorsque la plateforme ne permet pas la vérification, afficher explicitement « session non vérifiable » et proposer l’ouverture externe.

Les chats et services cloud restent utilisables sans agent OBS. Leur cycle de vie couvre hors live, préparation, diffusion active et fin de diffusion.

### Problème

La connexion API Twitch peut fonctionner alors que le lecteur intégré ne reconnaît pas l'utilisateur connecté.

### Comportement cible

Lorsque l'utilisateur ouvre sa visionneuse Twitch :

- Il peut savoir quel compte est connecté à l'application.
- Il peut distinguer le compte API de la session web du lecteur.
- Il dispose d'une action **Se connecter à Twitch dans le lecteur**.
- La session web reste disponible après fermeture et réouverture de l'application, dans les limites imposées par Twitch.
- Il peut ouvrir le lecteur dans son navigateur habituel.
- Une déconnexion du lecteur ne doit pas obligatoirement déconnecter l'intégration API.

### Contraintes techniques

Vérifier le fonctionnement réel des cookies, partitions Electron, connexions et restrictions Twitch.

Ne jamais injecter les tokens OAuth API dans la page du lecteur.

Ne jamais considérer la fermeture d'une fenêtre de connexion comme une authentification réussie.

Si Twitch ne permet pas de garantir la session authentifiée dans un lecteur embarqué, proposer explicitement l'ouverture dans le navigateur externe.

### Validation

- Connexion au compte dans le parcours web.
- Réouverture de l'application.
- Persistance ou diagnostic correct de session.
- Lecteur hors ligne affiché correctement.
- Connexion API préservée.
- Aucun faux état « connecté ».

**Critère de réussite :** l'utilisateur sait toujours si son lecteur utilise une session authentifiée ou si cette information est impossible à confirmer.

## 6. Visionneuse YouTube — correction prioritaire

### Problème

La connexion YouTube API et l'authentification du lecteur intégré ne correspondent pas nécessairement à la même session.

### Comportement cible

- Afficher le compte et la chaîne YouTube utilisés par StreamDashboard.
- Permettre une connexion distincte au lecteur web.
- Conserver correctement les sessions autorisées.
- Pouvoir ouvrir la diffusion dans le navigateur habituel.
- Préserver le fonctionnement du lecteur lorsque le live n'a pas commencé.
- Expliquer si la connexion au lecteur ne peut pas être vérifiée.

### Comptes Google séparés

L'application doit permettre :

- Un compte Google Calendar.
- Un autre compte Google/YouTube.
- Une session web YouTube distincte si nécessaire.

La déconnexion de Google Calendar ne doit pas supprimer la connexion YouTube, et inversement.

Aucun partage implicite de tokens entre comptes.

Les contraintes d'authentification, de cookies et d'intégration imposées par Google/YouTube doivent être respectées.

## 7. Chat YouTube — correction prioritaire

### Problème

Le chat YouTube peut afficher un état indisponible alors que la diffusion est active.

### Exigences

Distinguer clairement :

- Aucune diffusion sélectionnée.
- Diffusion programmée.
- Diffusion préparée.
- Ingestion active.
- Diffusion réellement en direct.
- Chat non encore disponible.
- Chat désactivé.
- Autorisation insuffisante.
- Erreur réseau.
- Quota API dépassé.
- Chat connecté.

### Récupération des messages

- Associer le chat à la bonne chaîne et au bon broadcast.
- Résoudre l'identifiant de chat correspondant à la diffusion.
- Actualiser l'identifiant lorsque la diffusion change.
- Respecter les intervalles de récupération et quotas YouTube.
- Empêcher les requêtes simultanées inutiles.
- Écarter les réponses tardives d'une ancienne diffusion.
- Conserver l'affichage des messages déjà reçus pendant une interruption.
- Retenter la récupération avec une temporisation adaptée.
- Proposer un diagnostic précis, jamais un simple écran vide inexpliqué.

### Multistream

Les chats Twitch et YouTube doivent rester indépendants techniquement mais visibles simultanément dans le tableau de bord.

Préserver les règles de diffusion et d'affichage applicables aux plateformes, ainsi que les distinctions entre provenance des messages.

### Validation

Essais simulés sans live, puis véritable essai pendant une diffusion autorisée :

- Broadcast préparé.
- Passage en direct.
- Identification du chat.
- Réception de messages.
- Changement de diffusion.
- Déconnexion/reconnexion.
- Fin de diffusion.
- Absence de mélange des conversations.

Ne jamais créer un live public ou envoyer un message pour un test sans autorisation explicite.

## 8. Streamlabs autonome

Streamlabs cloud devient la source de référence pour l'historique disponible auprès du fournisseur.

Chaque appareil autorisé doit pouvoir :

- Récupérer ses événements depuis Streamlabs.
- Conserver un cache local.
- Fonctionner hors ligne avec ce cache.
- Synchroniser indépendamment les nouveaux événements.
- Éviter les doublons.
- Filtrer les événements non pertinents, notamment `rollendcredits`.
- Conserver l'identité du compte utilisée pour chaque cache.

FIXE ne doit plus être indispensable pour consulter l'historique sur le laptop ou Android.

Une autorisation Streamlabs propre à chaque appareil doit être possible, sans copier des secrets depuis FIXE.

## 9. Macros, sons et clips

### Macros

- Fonctionnement lorsque la fenêtre est minimisée.
- Fonctionnement sans tableau de bord lorsque le moteur de macros local et les exécuteurs requis restent actifs.
- Support simultané du mono-PC, du double-PC, des configurations avec Android et des configurations personnalisées.
- Actions locales compatibles sur Android autonome ; actions distantes conditionnées à la présence d’un exécuteur autorisé.
- Séparation du déclencheur, de la définition de macro et de l’appareil qui exécute chaque action.
- Résultats explicites lorsqu’un appareil cible est indisponible et absence de répétition aveugle après reconnexion.
- Raccourcis personnalisables.
- Gestion des conflits de touches.
- Compatibilité avec les déclencheurs clavier/Synapse.
- Diagnostic clair lorsqu'un raccourci n'a pas pu être enregistré.

### Sons

- Lecture locale sur PC ou Android.
- Volume individuel.
- Arrêt immédiat.
- Lecture multiple selon configuration.
- Choix de l’appareil d’exécution PC ou Android et de sa sortie audio lorsqu’elle est disponible.
- Commandes distantes de lecture et d’arrêt avec indication de l’appareil réellement concerné.
- Absence de dépendance à FIXE pour les sons stockés sur Android.

### Clips

- Gestion du tampon OBS.
- Vérification de son état.
- Déclenchement distant.
- Confirmation uniquement après résultat OBS fiable.
- Gestion explicite des délais et résultats incertains.
- Pas de répétition automatique susceptible de créer des doublons.

## 10. Planning, configurations et sauvegardes

- Planning accessible sur chaque appareil.
- Modification hors ligne.
- Synchronisation sans perte.
- Résolution explicite des conflits.
- Comptes Google Calendar indépendants de YouTube.
- Export JSON lisible et versionné.
- Import avec prévisualisation.
- Sauvegarde avant migration.
- Conservation des champs inconnus compatibles.
- Absence d'écrasement silencieux d'une configuration plus récente.

Les transitions mono-PC ↔ double-PC, l’ajout ou le retrait d’Android et le déplacement des rôles dans une configuration personnalisée doivent préserver les données pertinentes sans repartir de zéro.

## 11. Interface utilisateur

### Interface PC

Ajouter une section **Mon installation** présentant :

- Type de setup actuel.
- Appareils associés.
- Modules actifs.
- Emplacement d'OBS.
- Statut de l'agent.
- Connexions cloud.
- État des chats et visionneuses.

Les panneaux doivent être adaptatifs et réorganisables, notamment pour voir simultanément les chats, les événements Streamlabs et les commandes.

### Interface Android

Conserver une ergonomie de type Stream Deck :

- Grandes commandes tactiles.
- Pages personnalisables.
- Soundboard avec volumes et boutons d'arrêt.
- État des appareils.
- Accès aux événements et plannings.
- Indication des commandes OBS indisponibles.

Une fonction absente du setup ne doit pas monopoliser l'espace de l'interface.

## 12. Sécurité et distribution

Le produit doit être installable par une personne extérieure, sans configuration liée au développeur.

Exigences :

- Aucune clé, adresse IP ou donnée personnelle codée en dur.
- Identifiants OAuth propres à la distribution.
- Stockage sécurisé des tokens.
- Isolation des profils utilisateur.
- Permissions par appareil.
- Absence d'API OBS exposée publiquement sans protection.
- Gestion des mises à jour et retour arrière.
- Respect des politiques d'API Twitch, Google, YouTube et Streamlabs.
- Possibilité de désinstaller sans perdre automatiquement les données exportées.

## 13. Compatibilité avec RC11.7

La RC11.7 reste la base stable à préserver jusqu’à validation de la nouvelle architecture. La référence déclarée `4c80ba3` doit être vérifiée avant toute modification du code. Les fonctionnalités listées ci-dessous sont des obligations de conservation à contrôler sur la base réelle ; leur présence et leur qualité ne sont pas attestées par cette seule consolidation documentaire.

Conserver :

- Corrections Twitch et YouTube existantes.
- Gestion des sorties OBS/Aitum.
- Protections du tampon et des clips.
- Macros globales et fonctionnement en arrière-plan.
- Historique cloud Streamlabs.
- Autonomie Android.
- Gestion des comptes séparés.
- Synchronisation prudente du planning.
- Sauvegardes et mécanismes de rollback.

**Aucune régression fonctionnelle acceptable.**

La migration doit être additive autant que possible.

## 14. Organisation transversale et qualification simultanée

Les travaux peuvent être répartis en lots techniques, jamais en lots isolés par setup. Aucun lot ne doit repousser l’implémentation d’un setup compatible à une version ultérieure.

### Lot A — Fondations universelles

- Vérifier la base RC11.7, les branches et les travaux existants.
- Auditer les dépendances aux anciens rôles host/client et aux machines nommées.
- Définir et implémenter appareils, capacités, rôles, permissions, connexions, découverte et configurations pour les six setups dès l’origine.
- Définir les contrats partagés de commande, d’état, d’erreur, de disponibilité et de reconnexion.
- Préparer une migration RC11.7 conservant les données et une restauration vérifiable.
- Poser immédiatement la matrice de tests commune, y compris Android autonome, plusieurs contrôleurs et appareils indisponibles.

### Lot B — Modules fonctionnels transversaux

Modules concernés : OBS/Aitum/Stream Suite, macros, Twitch, YouTube, visionneuses, chats, Streamlabs, WizeBot, planning/Google Calendar, sons et clips.

Chaque module est spécifié, implémenté et qualifié sur tous ses environnements compatibles dans le même chantier, selon la matrice de la section 2.

Exemple obligatoire pour OBS : commande locale mono-PC, commande distante double-PC, pilotage Android, plusieurs contrôleurs, indisponibilité contrôlée lorsque l’agent est absent, fonctionnement sans fenêtre et reconnexion après interruption. Android autonome doit afficher l’indisponibilité OBS tout en conservant ses autres fonctions.

Le même principe s’applique aux comptes, sessions de lecteurs, identités de chat, événements, macros, sons et plannings. Une fonctionnalité compatible avec plusieurs setups ne peut pas être marquée terminée lorsqu’un seul fonctionne.

### Lot C — Interfaces et choix des setups

- Assistant couvrant explicitement les six setups dès sa première version fonctionnelle.
- Tableau de bord Windows adaptable aux capacités et rôles disponibles.
- Agent et moteurs d’exécution sans fenêtre lorsque requis.
- Android Deck autonome, utilisable avec ou sans ordinateur.
- Interfaces de sélection des destinations et de diagnostic des fonctions indisponibles.
- Ajout, retrait et changement d’appareils ; déplacement des rôles ; transitions réversibles avec prévisualisation et sauvegarde.
- Conservation des comptes, identités, associations et configurations pertinentes, dans le respect de leur isolation par appareil.

### Lot D — Intégration et qualification croisée

L’intégration et les tests commencent dès la première implémentation fonctionnelle des autres lots. Le lot D consolide leurs preuves ; il ne reporte pas la prise en compte des setups à la fin du développement.

Pour chaque module, la qualification automatisée doit couvrir les combinaisons compatibles de la matrice suivante :

| Dimension | Scénarios obligatoires |
|---|---|
| Installation | Mono-PC ; mono-PC + Android ; double-PC ; double-PC + Android ; Android autonome ; personnalisée avec plusieurs contrôleurs et appareils |
| Présence | Appareil unique ; plusieurs appareils ; appareil éteint, déconnecté ou temporairement indisponible |
| Exécution OBS | Agent actif ; agent arrêté ; fenêtre fermée ; reprise de l’agent |
| Contrôle | Contrôleur actif ; contrôleur arrêté ; autres contrôleurs disponibles ; moteur de macros sans tableau de bord |
| Réseau | Perte réseau ; reconnexion ; réponses tardives ; commande au résultat incertain |
| Configuration | Changement de rôle ; mono-PC vers double-PC ; double-PC vers mono-PC ; ajout/retrait Android ; changement d’exécuteur ; interruption d’une transition et restauration |
| Données | Migration depuis RC11.7 ; conservation des données et champs inconnus compatibles ; conflits de synchronisation ; sauvegarde/restauration |
| Identités | Séparation API/web/chat par appareil ; séparation Calendar/YouTube ; comptes distincts ; sessions persistées ou diagnostic explicite |
| Diffusion | Hors live ; préparation ; ingestion ; diffusion active ; fin ; changement de broadcast et de chat |
| Distribution | Paquets Windows et Android ; installation extérieure ; mise à jour et retour arrière |

La qualification de chaque cellule doit être suivie comme « à implémenter », « à tester », « validée en simulation », « validée sur matériel », « bloquée » ou « non applicable — justification technique ». Une indisponibilité attendue doit elle-même être testée. La mention « non applicable » ne peut pas masquer un setup compatible manquant.

Le rapport conserve pour chaque essai : exigence et module, setup, version/commit, environnement, résultat attendu et observé, preuve et limite éventuelle.

**Les tests simulés ne remplacent pas les essais matériels de fin de qualification.** Les essais réels Windows et Android doivent couvrir les six setups, leurs transitions, les interruptions et les reconnexions, ainsi que les parcours de connexion et le chat pendant une diffusion autorisée. Les actions affectant OBS et les plateformes restent soumises aux règles de test et d’autorisation du présent document.

Les lots A à D peuvent comporter des travaux parallèles et des jalons intermédiaires, sous coordination des écritures. Cela n’autorise ni une campagne concurrente non coordonnée ni l’usage de Codex/CodexBridge sans nouvelle autorisation.

## 15. Critères d'acceptation finale

**StreamDashboard Next 2.1 ne sera pas considéré comme terminé tant que tous les setups prévus et leurs transitions ne seront pas implémentés et qualifiés.**

Une livraison intermédiaire peut servir aux essais, avec ses limites clairement identifiées. Elle ne peut pas être présentée comme la version finale universelle si un setup compatible ou une transition obligatoire reste absent, non implémenté ou non qualifié.

La version ne sera considérée comme terminée que si :

- Un streamer mono-PC peut installer, configurer et utiliser StreamDashboard sans second appareil.
- Le tableau de bord peut être fermé sans interrompre l'agent OBS, lorsque cette option est activée.
- Les macros continuent à fonctionner en arrière-plan.
- Un streamer double-PC peut piloter OBS sans interface StreamDashboard ouverte sur le PC de stream.
- Mono-PC + Android et double-PC + Android sont implémentés et qualifiés.
- Android autonome conserve ses fonctions compatibles sans ordinateur connecté.
- La configuration personnalisée fonctionne avec plusieurs contrôleurs et appareils, sans conflit d’exécution.
- L’arrêt ou l’indisponibilité d’un appareil ne bloque pas les fonctions indépendantes.
- Chaque module satisfait sa matrice de compatibilité et de qualification croisée.
- Twitch et YouTube disposent de parcours de connexion au lecteur fiables ou d'un repli externe explicite.
- Le chat YouTube est testé pendant un vrai live et affiche ses états correctement.
- Streamlabs cloud peut être consulté indépendamment sur chaque appareil autorisé.
- Les transitions mono-PC ↔ double-PC, l’ajout/retrait d’Android et les changements de rôle conservent les données pertinentes et disposent d’une restauration vérifiée.
- La migration RC11.7, les interruptions et les reconnexions sont testées.
- Les résultats simulés et les essais matériels sont distingués ; les essais matériels requis sont achevés avant déclaration finale.
- Les comptes et secrets restent isolés.
- Les fonctions RC11.7 passent leurs tests de non-régression.
- Aucun lancement de live, changement de scène ou modification du micro n'est effectué automatiquement pendant les tests.
- Les paquets Windows et Android sont construits et vérifiés.
- Une documentation d'installation destinée aux utilisateurs extérieurs est fournie.

---

## 16. Règles d'exécution du chantier

Le développement doit se dérouler sur une branche dédiée issue d'une base RC11.7 vérifiée.

- Ne pas écraser les corrections déjà livrées.
- Vérifier la branche, les commits et les changements en cours.
- Ne pas créer de campagne concurrente d'écriture.
- Effectuer des tests ciblés à chaque évolution.
- Ne pas modifier les installations personnelles sans contrôle préalable.
- Préserver les profils, données, comptes et PID OBS.
- Ne pas interrompre un live ou enregistrement.
- Ne pas utiliser CodexBridge ou Codex sans nouvelle autorisation.
- Respecter les limites de ressources du serveur de développement.
- Ne pas déployer sur `main` sans validation.
- Documenter les corrections réelles, les tests réussis et les limites restantes.

## 17. Livrables attendus

- Application Windows modulaire.
- Agent OBS autonome et léger.
- Assistant de configuration des setups.
- Application Android Deck compatible.
- Visionneuses Twitch/YouTube corrigées.
- Chat YouTube stabilisé.
- Système de comptes et de services autonomes.
- Migrations de profils RC11.7.
- Matrice automatisée couvrant les six setups dès la première implémentation fonctionnelle.
- Essais matériels mono-PC, mono-PC + Android, double-PC, double-PC + Android, Android autonome et configuration personnalisée.
- Qualification des transitions, appareils absents, interruptions, reconnexions et migration RC11.7.
- Paquets d'installation.
- Documentation de configuration et de dépannage.
- Rapport final de qualification, distinguant tests simulés et essais réels.

**Résultat attendu : StreamDashboard doit s’adapter à l’installation de l’utilisateur.**

**Décision finale : une seule architecture, tous les setups dès la conception, des fonctionnalités communes et une qualification croisée obligatoire.**
