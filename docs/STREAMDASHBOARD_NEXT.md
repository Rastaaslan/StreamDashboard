# StreamDashboard Next 2.0 candidate

Cette candidate introduit une régie partagée : le PC de stream exécute les actions et conserve les données ; le PC de jeu et l’application Android servent de contrôleurs et d’interfaces de gestion. La version actuelle reste disponible. Ne lancez pas simultanément les deux hôtes avec les mêmes comptes et OBS : leurs synchronisations et automatismes pourraient agir sur les mêmes ressources.

## Installation et connexion

1. Sur **FIXE** (PC de stream), extraire le paquet Windows dans un nouveau dossier. Conserver l’ancien dossier et son raccourci.
2. Applications StreamDashboard fermées, exécuter `Migrate-StreamDashboard-Next.ps1` dans PowerShell. Il copie `%APPDATA%\StreamDashboard` vers `%APPDATA%\StreamDashboard-Next`, vérifie que le fichier source n’a pas changé, remappe les sons et réinitialise uniquement les associations de la copie. Il refuse d’écraser une candidate existante. Les credentials chiffrés restent sur la même machine et le même compte Windows. Le fichier `Local State`, contenant la clé protégée par Windows utilisée par Electron, accompagne la copie avant le premier lancement. Le script refuse la migration si une application StreamDashboard est encore ouverte.
3. Lancer `Start-Next-Host.cmd`. La candidate utilise le port **48133** ; l’ancienne version conserve **48132**. Configuration → OBS et scènes : vérifier le WebSocket OBS, le micro, les scènes et la source du minuteur. Le minuteur candidat est `http://127.0.0.1:48133/overlay/timer/`. Conserver l’ancienne source OBS pour le retour arrière.
4. Le réseau local doit être activé dans Configuration. Après modification, redémarrer la candidate. Autoriser l’application sur le réseau privé Windows si le pare-feu le demande. Aucun port Internet à ouvrir.
5. Sur le PC de stream, Configuration → Appareils → **Créer un code de gestion complète**. Chaque code est valable cinq minutes et utilisable une seule fois.
6. Sur **laptop-damien** (PC de jeu), extraire le même paquet, lancer `Start-Next-Client.cmd`, cliquer sur Appareils et coller le lien de pairing. Le client sert son interface en local sur le port **48134**, sans moteur OBS ni données métier locales. Les commandes quittent immédiatement le client ; elles ne sont pas mises en attente pendant une coupure.
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
3. Cliquer sur **Détecter les sorties OBS**. Pour Aitum Stream Suite, associer chaque sortie de type `stream` à Twitch ou YouTube, puis enregistrer. L’adaptateur utilise le protocole vendeur de Stream Suite 1.2.4 (`get_outputs`, `start_output`, `stop_output`) ; il refuse les noms absents ou ambigus et ne redémarre pas une sortie déjà active. L’accusé de réception du plugin ne vaut pas confirmation du direct : les API des plateformes restent la référence. Les sorties principale et nommées OBS restent proposées pour les autres installations. Ne renseigner aucun nom supposé.
4. Titre commun limité à 100 caractères, tags communs compatibles Twitch, catégorie Twitch par ID et catégorie vidéo YouTube explicite (20 = Jeux vidéo). La description concerne YouTube ; le jeu Twitch n’est pas présenté comme une catégorie de jeu YouTube synchronisée.
5. Ne pas effectuer de publication de test pendant un live. Les essais de diffusion réelle et le mapping Stream Suite doivent être validés avant utilisation publique. Un arrêt d’une sortie principale commune coupe toutes les plateformes qui en dépendent.

Références officielles : [API Twitch](https://dev.twitch.tv/docs/api/reference/), [mise à jour YouTube](https://developers.google.com/youtube/v3/docs/videos/update), [transition d’une diffusion YouTube](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition), [OBS WebSocket](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md), [protocole Stream Suite 1.2.4](https://github.com/Aitum/obs-aitum-stream-suite/blob/d7d1420731b024dc98a4704c34a715b49d91f053/src/utils/obs-websocket.cpp).

### Installation OBS observée sur FIXE

Le contrôle WebSocket authentifié confirme OBS **32.2.2**, WebSocket **5.7.4**, Stream Suite **1.2.4**, profil `Sans nom`, collection `LeFeuDeCamp`. Les deux sorties étaient inactives lors de cette lecture.

| Plateforme | Type dans Next | Nom |
|---|---|---|
| Twitch | Sortie principale OBS | Sans nom à renseigner |
| YouTube | Aitum Stream Suite | `YouTube Output` |

Ce mapping est fondé sur la configuration existante et la réponse réelle du plugin. Il ne confirme pas encore l'autorisation YouTube ni le démarrage public. Scènes disponibles : `FIN`, `CAM_RAW`, `PAUSE - Miryun`, `PAUSE`, `CAM_JEU`, `CHATTING`, `CAM_CHAT`, `JEU`, `INTRO`. Le micro `micro` répond et était coupé lors de la lecture.

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

Dans Synapse, affecter chaque touche à la combinaison correspondante, une pression simple, sans boucle ni répétition. Le client Next doit rester ouvert sur laptop-damien, avec le clavier et Synapse. Configuration → Appareils → **Vérifier les raccourcis** montre ceux qui sont enregistrés et ceux déjà occupés par une autre application. Les associations action/raccourci se modifient depuis Mon Deck sur tous les appareils. Une macro de lancement utilise la même commande Twitch + YouTube ; un arrêt au clavier demande de passer par le bouton de confirmation de l’interface.

Sur laptop-damien, le contrôle matériel confirme le BlackWidow V4 X (VID 1532, PID 0293) et Synapse 4.0.827. Les six combinaisons ont été enregistrées sans conflit par le client Windows. Les associations physiques M1–M6 restent à appliquer dans Synapse : son interface n’a pas fourni de contrôles accessibles pour cette opération distante. Aucun profil propriétaire fictif n’est fourni.

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

La candidate reprend les acquis de la base, les corrections de fusion d’exceptions et de création de séries, ainsi que la préparation des occurrences Twitch et le journal de création persisté avant publication. Le nouveau pilotage remplace la sélection implicite et le lancement limité à OBS par des actions explicites, des résultats enregistrés et une confirmation par plateforme. Le contrôle de FIXE le 18 octobre confirme que l’ASAR de la version exécutée a exactement le même SHA-256 que le paquet CB173 récupéré : `b0d8be2945f47bc9a64b7b4979b4af1c1569d485c9a60aeefc241fdb38ea166f`. Sa configuration contient 93 éléments de planning et 8 sons. OBS 32.2.2 et le fichier du plugin Aitum Stream Suite 1.2.4 sont présents. La configuration utilisée indique OBS sur `ws://127.0.0.1:4555`, micro `micro`, et les scènes `INTRO`, `JEU`, `PAUSE`, `FIN`. L’installation et les données actuelles restent inchangées. StreamTool et damPlanner ne sont pas modifiés.

## Retour à la version actuelle

Fermer Next sur les trois appareils. Relancer l’ancien StreamDashboard et sélectionner à nouveau l’ancienne source minuteur OBS si elle a été changée. L’ancien dossier de données n’a pas été écrit par la migration. Les changements effectués ensuite dans Next ne sont pas recopiés automatiquement dans l’ancienne version : conserver les deux dossiers et exporter les événements nécessaires avant toute suppression.

## Vérifications et limites de livraison

Les tests du nouveau journal vérifient l’intent avant effet externe, les doublons simultanés, la reprise après redémarrage, la péremption, les conflits de révision et la reprise YouTube sans redémarrer Twitch. Les tests HTTP traversent le serveur réel avec sauvegarde, redémarrage et modifications croisées. Les tests des plateformes utilisent des adaptateurs simulés ; ils ne constituent pas un live réel.

À valider sur les appareils : démarrage et arrêt des sorties Stream Suite réelles, autorisations YouTube, démarrage/arrêt public conjoint, audibilité des sons, alertes, messages de bot, raccourcis Synapse et installation de l’APK sur le S24 Ultra. Le paquet Windows est portable et non signé ; l’APK de développement est signé avec une clé de test. Cette candidate n’est pas annoncée comme validée pour un live public avant ces essais.

### Résultat de la vérification candidate

- 187 tests TypeScript distincts passent : pilotage commun, récurrences et reprises de publication Twitch, audio OBS, autorisations LAN et transport OBS WebSocket, dont 3 tests du protocole Stream Suite.
- 18 tests Android passent ; APK debug construit avec un identifiant d’application distinct et le nom StreamDashboard Next.
- Parcours navigateur reproductible : `npm run build && node scripts/check-control-browser.mjs` (Chromium Playwright requis). Il utilise deux interfaces desktop/mobile, le vrai serveur HTTP et le transport OBS v5 simulé : mute au clavier, scène et minuteur depuis le téléphone, création/modification/suppression d’événement, changement de configuration, redémarrage et conservation du pairing.
- Paquet Windows x64 reconstruit et contrôlé par `node scripts/check-desktop-package.mjs`. Les écrans 1440 px et 412 px ont été inspectés.
- Ces vérifications ne remplacent pas l’installation Windows/S24, Synapse, les sorties de multidiffusion réelles et les autorisations Twitch/YouTube. La suite complète historique n’a pas été exécutée.

### Contrôle RC2 sur les appareils, 18 octobre 2026

- **FIXE** : candidate construite et démarrée depuis `C:\Users\damie\StreamDashboard-Next-work\out\StreamDashboard-win32-x64`. Raccourci de bureau `StreamDashboard Next - Stream`. Ancienne application fermée proprement ; ancien dossier et anciennes données conservés. Migration vérifiée de 93 éléments de planning et 8 sons, avec copie de `Local State` indispensable au déchiffrement des credentials Windows. Le hash des données d'origine reste identique après les essais.
- L'adaptateur détecte Stream Suite 1.2.4 dans OBS réel ; Twitch principal et `YouTube Output` sont enregistrés dans Next. Mute/unmute et scène Pause ont donné un résultat réussi avec lecture de l'état OBS. État initial rétabli : scène `FIN`, micro coupé, aucune diffusion active.
- **laptop-damien** : client construit, association de gestion complète préparée et credential enregistré dans le stockage chiffré Windows. Raccourci de bureau `StreamDashboard Next - Jeu`. Les six raccourcis globaux ont été enregistrés sans conflit lors du contrôle.
- Adresse locale vérifiée de FIXE : `http://192.168.1.158:48133`. Le client est préconfiguré avec cette adresse. La résolution du nom `FIXE` renvoyait une ancienne adresse depuis dam-server ; privilégier l'adresse affichée par la régie. Une réservation DHCP évitera son changement.
- Le pare-feu de FIXE bloque encore la connexion depuis les autres appareils. Windows a refusé l'ajout de la règle faute de droits administrateur. Sur **FIXE**, ouvrir PowerShell en administrateur et exécuter cette commande, limitée au programme Next, au port 48133 et au sous-réseau local sur Ethernet :

```powershell
New-NetFirewallRule -Name 'StreamDashboard-Next-LAN-48133' -DisplayName 'StreamDashboard Next - LAN' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 48133 -RemoteAddress LocalSubnet -InterfaceAlias 'Ethernet' -Program "$env:USERPROFILE\StreamDashboard-Next-work\out\StreamDashboard-win32-x64\StreamDashboard.exe" -Profile Any
```

La règle peut être retirée avec `Remove-NetFirewallRule -Name 'StreamDashboard-Next-LAN-48133'` dans un PowerShell administrateur. Aucun port de routeur n'est ouvert.

Restent à terminer : connexion entre les appareils après cette autorisation Windows, affectation physique des touches dans Synapse, installation sur S24 Ultra, autorisation YouTube et choix de sa diffusion, puis essai conjoint de démarrage et de mise à jour Twitch/YouTube. Aucun live public ni message de bot de test n'a été envoyé.
