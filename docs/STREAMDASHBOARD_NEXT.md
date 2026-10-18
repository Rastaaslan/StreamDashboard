# StreamDashboard Next 2.0 candidate

Cette candidate introduit une régie partagée : le PC de stream exécute les actions et conserve les données ; le PC de jeu et l’application Android servent de contrôleurs et d’interfaces de gestion. La version actuelle reste disponible. Ne lancez pas simultanément les deux hôtes avec les mêmes comptes et OBS : leurs synchronisations et automatismes pourraient agir sur les mêmes ressources.

## Installation et connexion

1. Sur **laptop-damien**, extraire le paquet Windows dans un nouveau dossier. Conserver l’ancien dossier et son raccourci.
2. Applications StreamDashboard fermées, exécuter `Migrate-StreamDashboard-Next.ps1` dans PowerShell. Il copie `%APPDATA%\StreamDashboard` vers `%APPDATA%\StreamDashboard-Next`, vérifie que le fichier source n’a pas changé, remappe les sons et réinitialise uniquement les associations de la copie. Il refuse d’écraser une candidate existante. Les credentials chiffrés restent sur la même machine et le même compte Windows.
3. Lancer `Start-Next-Host.cmd`. La candidate utilise le port **48133** ; l’ancienne version conserve **48132**. Configuration → OBS et scènes : vérifier le WebSocket OBS, le micro, les scènes et la source du minuteur. Le minuteur candidat est `http://127.0.0.1:48133/overlay/timer/`. Conserver l’ancienne source OBS pour le retour arrière.
4. Le réseau local doit être activé dans Configuration. Après modification, redémarrer la candidate. Autoriser l’application sur le réseau privé Windows si le pare-feu le demande. Aucun port Internet à ouvrir.
5. Sur le PC de stream, Configuration → Appareils → **Créer un code de gestion complète**. Chaque code est valable cinq minutes et utilisable une seule fois.
6. Sur **FIXE**, extraire le même paquet, lancer `Start-Next-Client.cmd`, cliquer sur Appareils et coller le lien de pairing. Le client sert son interface en local sur le port **48134**, sans moteur OBS ni données métier locales. Les commandes quittent immédiatement le client ; elles ne sont pas mises en attente pendant une coupure.
7. Sur le **S24 Ultra**, installer l’APK Next fourni (application distincte de l’ancienne), ouvrir Appareils et coller un deuxième lien. Le mode Deck et toutes les rubriques de gestion utilisent la régie. Le jeton du téléphone est conservé dans Android Keystore ; celui du client Windows est chiffré par Electron safeStorage.

## Navigation

- **Le live** : OBS, Twitch et YouTube séparés ; informations communes, démarrage conjoint, arrêt, minuteur, checklist et résultats des commandes.
- **Mon Deck** : boutons personnalisables, paramètres, couleurs et raccourcis. Un son correspond au catalogue audio OBS ; une alerte relance une source média OBS ; un message précise sa destination `twitch:message` ou `youtube:message`.
- **Planning et événements** : création, édition et suppression ; distinction entre série et occurrence, fuseau, récurrences, destinations Twitch/Google et état des publications. « Préparer » ouvre les informations communes à partir de l’événement choisi.
- **Configuration** : OBS et scènes, diffusion, profil, intégrations, appareils et macros. Certains réglages avancés du profil et des automatisations utilisent encore un éditeur JSON ; les autorisations OAuth Google se terminent sur le PC de stream.

## Twitch et YouTube

Une commande commune alimente un journal persistant. Chaque plateforme est vérifiée par son API ; l’état OBS seul ne produit jamais un succès conjoint. Les informations demandées sont enregistrées avant application. Un résultat partiel conserve les résultats et permet de reprendre uniquement la plateforme concernée. Une coupure ne rejoue jamais automatiquement un message, son ou lancement.

Dans Configuration → Diffusion :

1. Connecter Twitch avec l’autorisation de modification de la chaîne. Connecter YouTube avec le Client ID d’une application Google Desktop, YouTube Data API activée, et le scope `youtube.force-ssl`. Le Client Secret éventuel est celui enregistré dans la configuration Google de l’hôte ; une configuration utilisant un autre projet doit être corrigée avant connexion.
2. Choisir explicitement une diffusion préparée dans YouTube Studio et sa chaîne. La candidate ne crée aucune diffusion YouTube automatiquement. Elle utilise le flux lié à cette diffusion et peut passer une diffusion prête en direct après réception de la vidéo.
3. Renseigner les sorties réellement exposées par OBS : sortie principale ou sortie nommée retournée par **Détecter les sorties OBS**. Si Stream Suite ne les expose pas via `GetOutputList`/`StartOutput`, ce raccordement nécessite un adaptateur spécifique à sa version. Ne renseigner aucun nom supposé. Une sortie non configurée reste une erreur visible.
4. Titre commun limité à 100 caractères, tags communs compatibles Twitch, catégorie Twitch par ID et catégorie vidéo YouTube explicite (20 = Jeux vidéo). La description concerne YouTube ; le jeu Twitch n’est pas présenté comme une catégorie de jeu YouTube synchronisée.
5. Ne pas effectuer de publication de test pendant un live. Les essais de diffusion réelle et le mapping Stream Suite doivent être validés avant utilisation publique. Un arrêt d’une sortie principale commune coupe toutes les plateformes qui en dépendent.

Références officielles : [API Twitch](https://dev.twitch.tv/docs/api/reference/), [mise à jour YouTube](https://developers.google.com/youtube/v3/docs/videos/update), [transition d’une diffusion YouTube](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition), [OBS WebSocket](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md).

## BlackWidow V4 X et Synapse

Le clavier dispose de six touches macro dédiées configurables dans Synapse : [documentation Razer](https://mysupport.razer.com/app/answers/detail/a_id/13223).

| Touche | Affectation Synapse | Action initiale StreamDashboard |
|---|---|---|
| M1 | Ctrl + Alt + Maj + F1 | Micro principal : mute/unmute |
| M2 | Ctrl + Alt + Maj + F2 | Scène du mode Jeu |
| M3 | Ctrl + Alt + Maj + F3 | Scène Pause |
| M4 | Ctrl + Alt + Maj + F4 | Scène Discussion |
| M5 | Ctrl + Alt + Maj + F5 | Ajouter 300 secondes au minuteur |
| M6 | Ctrl + Alt + Maj + F6 | Scène Introduction |

Dans Synapse, affecter chaque touche à la combinaison correspondante, une pression simple, sans boucle ni répétition. Le client Next doit rester ouvert sur FIXE. Configuration → Appareils → **Vérifier les raccourcis** montre ceux qui sont enregistrés et ceux déjà occupés par une autre application. Les associations action/raccourci se modifient depuis Mon Deck sur tous les appareils. Une macro de lancement utilise la même commande Twitch + YouTube ; un arrêt au clavier demande de passer par le bouton de confirmation de l’interface.

Les associations matérielles Synapse ne sont pas prétendues installées : FIXE était hors ligne pendant le développement. Aucun profil propriétaire Synapse fictif n’est fourni.

## Architecture et données

- `packages/contracts/src/control.ts` : configuration versionnée, actions et résultats par plateforme.
- `apps/server/src/control-service.ts` : file sérialisée, intent persistant avant effet externe, idempotence, expiration des commandes et résultats partiels.
- `integrations/youtube/src/client.ts` : OAuth PKCE, rafraîchissement des jetons, cible chaîne/diffusion explicite, métadonnées, transition et chat.
- `apps/mobile/control/` : interface responsive commune, sans lecture des secrets des services.
- `apps/desktop/src/controller.ts` : mode client Windows et raccourcis globaux.
- `config/dashboard.json` conserve les données historiques ; `config/control-v2.json` contient Deck, macros, choix de sorties, métadonnées et journal. Les écritures sont atomiques.

Les écritures de configuration principale, du Deck et du planning portent une révision attendue. Une édition dépassée est rejetée avec 409, sans remplacer l’état plus récent. Les anciens tokens de télécommande restent limités ; la nouvelle gestion complète exige un nouveau pairing explicitement créé sur l’hôte.

## Base et comparaison

Base Git : `ci/cb140-final`, commit `343dae86feadbee4d862718202b1d1d2b5f1e57e` (PR 73), comparé à `main` et aux branches publiées. Un paquet plus récent a été trouvé sur dam-server : `StreamDashboard-CB173-final`, commit annoncé `03d89ef1e524eaa8cf632f400b83dabdac32f2ab`, daté du 8 octobre. Ce commit n’est pas disponible sur le dépôt distant. Son contenu JavaScript a été extrait et comparé au build de la base sans modifier le paquet.

La candidate reprend les acquis de la base, les corrections de fusion d’exceptions et de création de séries, ainsi que la préparation des occurrences Twitch et le journal de création persisté avant publication. Le nouveau pilotage remplace la sélection implicite et le lancement limité à OBS par des actions explicites, des résultats enregistrés et une confirmation par plateforme. La version réellement installée sur laptop-damien et ses éventuels correctifs locaux restent à comparer : cette machine n’était pas accessible. StreamTool et damPlanner ne sont pas modifiés.

## Retour à la version actuelle

Fermer Next sur les trois appareils. Relancer l’ancien StreamDashboard et sélectionner à nouveau l’ancienne source minuteur OBS si elle a été changée. L’ancien dossier de données n’a pas été écrit par la migration. Les changements effectués ensuite dans Next ne sont pas recopiés automatiquement dans l’ancienne version : conserver les deux dossiers et exporter les événements nécessaires avant toute suppression.

## Vérifications et limites de livraison

Les tests du nouveau journal vérifient l’intent avant effet externe, les doublons simultanés, la reprise après redémarrage, la péremption, les conflits de révision et la reprise YouTube sans redémarrer Twitch. Les tests HTTP traversent le serveur réel avec sauvegarde, redémarrage et modifications croisées. Les tests des plateformes utilisent des adaptateurs simulés ; ils ne constituent pas un live réel.

À valider sur les appareils : comparaison de l’installation actuelle, compatibilité exacte Stream Suite, autorisations YouTube, démarrage/arrêt public conjoint, audibilité des sons, alertes, messages de bot, raccourcis Synapse et installation de l’APK sur le S24 Ultra. Le paquet Windows est portable et non signé ; l’APK de développement est signé avec une clé de test. Cette candidate n’est pas annoncée comme validée pour un live public avant ces essais.

### Résultat de la vérification candidate

- 184 tests TypeScript distincts passent : pilotage commun, récurrences et reprises de publication Twitch, audio OBS, autorisations LAN et transport OBS WebSocket.
- 18 tests Android passent ; APK debug construit avec un identifiant d’application distinct et le nom StreamDashboard Next.
- Parcours navigateur reproductible : `npm run build && node scripts/check-control-browser.mjs` (Chromium Playwright requis). Il utilise deux interfaces desktop/mobile, le vrai serveur HTTP et le transport OBS v5 simulé : mute au clavier, scène et minuteur depuis le téléphone, création/modification/suppression d’événement, changement de configuration, redémarrage et conservation du pairing.
- Paquet Windows x64 reconstruit et contrôlé par `node scripts/check-desktop-package.mjs`. Les écrans 1440 px et 412 px ont été inspectés.
- Ces vérifications ne remplacent pas l’installation Windows/S24, Synapse, les sorties de multidiffusion réelles et les autorisations Twitch/YouTube. La suite complète historique n’a pas été exécutée.
