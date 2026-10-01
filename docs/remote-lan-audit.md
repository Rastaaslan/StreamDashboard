# CB-14 — Remote LAN Desktop / Android

## Comportement et récupération

- L’activation et la désactivation LAN prennent effet au redémarrage Desktop. La configuration et l’état effectif sont distincts ; `/api/v1/remote/info` (PC uniquement) indique aussi `restartRequired`.
- Une invitation expire après cinq minutes et ne peut servir qu’une fois. Son empreinte et son échéance sont persistées : redémarrer le PC ne prolonge pas sa validité. Les tickets WebSocket restent éphémères (15 secondes, usage unique) ; Android en redemande après reconnexion.
- Les credentials sont propres à chaque appareil ; seules leurs empreintes sont enregistrées sur le PC. Révoquer ferme les sockets de cet appareil, invalide ses tickets et persiste la révocation. Pour une rotation, révoquer l’ancien appareil puis générer une invitation et appairer à nouveau. « Oublier » sur Android efface uniquement la connexion locale, pas l’autorisation sur le PC.
- Le serveur écoute toutes les interfaces IPv4 lorsque le LAN est actif. Les adresses affichées et la validation Host suivent les interfaces courantes sans redémarrage. Après changement d’adresse, consulter Connexions sur le PC puis, dans l’interface Android livrée (`index.html` / `mobile.js`), ouvrir **Plus → Comptes connectés → Modifier l’adresse du PC → Reconnexion à cette adresse**. Aucun ID ni code de pairing n’est demandé pour cette action. Le credential est conservé. Aucun mécanisme de découverte automatique n’est ajouté.
- Une erreur réseau ou un refus 403 conserve le credential ; un 401 nécessite un nouvel appairage. Un refus Host demande de vérifier l’adresse affichée sur le PC. Les erreurs réseau indiquent de vérifier Wi-Fi/Ethernet et Connexions.
- Le contrôle HTTP reste disponible si WebSocket échoue. Le parcours Android livré (`mobile.js`) vérifie toutes les dix secondes l’état par HTTP pour détecter les sockets silencieusement coupés. Une nouvelle instance Desktop peut publier une révision repartant à zéro sans figer l’état PC/OBS. Chaque reconnexion ferme l’ancien socket et invalide ses callbacks et réponses HTTP en attente. Les événements online/visibilitychange passent par ce gestionnaire central, y compris pour le module Préparation. Un 401 courant efface le credential du stockage natif ; un 401 issu d’une tentative obsolète est ignoré.
- Les routes LAN sensibles passent par l’authentification Device puis la politique des routes autorisées. Administration locale, Host et Origin sont vérifiés séparément. Les réponses ne sont pas mises en cache ; les liens de pairing doivent rester privés jusqu’à leur consommation/expiration.

## Validation automatisée

`tests/remote-lan.test.ts` utilise un serveur HTTP/WebSocket réel sur l’interface LAN disponible : pairing après redémarrage, reconnexion après redémarrage, état distant filtré, rejeu, révocation persistée et fermeture du socket actif, endpoints sans credential, Host/Origin hostiles. Une simulation des interfaces teste Wi-Fi + Ethernet puis disparition du Wi-Fi et mise à jour immédiate des URLs/Host acceptés. Une horloge contrôlée teste l’expiration des codes et tickets.

`tests/mobile-network-recovery.test.ts` simule une coupure puis une nouvelle adresse LAN, avec conservation du credential et nouvelle demande de ticket. `tests/mobile-command-controller.test.ts` couvre le changement d’instance Desktop. Les tests compagnon existants couvrent reprise après réponse perdue, ACK et redémarrage.

Commandes : `TMPDIR="$PWD/node_modules/.cache/cb14-tmp" npm test`, `npm run build`, `npm run check:shipped-js`, `TMPDIR="$PWD/node_modules/.cache/cb14-tmp" npm run security:check` (créer ce dossier temporaire avant exécution dans un environnement restreint).

Les tests ne remplacent pas une validation physique Windows/Android : bascule Wi-Fi/Ethernet réelle, pare-feu Windows, ouverture du deep link sur téléphone et état d’un OBS réel n’ont pas été exécutés dans cet environnement Linux.

## Validation du parcours Android livré (itération de revue)

`tests/mobile-network-ui.spec.ts` charge réellement `/mobile/index.html` et son bootstrap `mobile.js` dans Chromium. Le backend HTTP et les sockets sont contrôlés pour simuler les incidents ; le pont Android de stockage est simulé avec un stockage persistant rechargé avec la page. Les tests couvrent :

- navigation réelle jusqu’au bouton de récupération, changement d’adresse sans ID/code, absence de requête de pairing et conservation du credential après rechargement ;
- socket silencieusement coupé, détection HTTP, désactivation des contrôles/état OBS hors ligne, reconnexion automatique à une instance Desktop dont la révision repart à zéro ;
- événements online/visibilitychange concurrents, fermeture des anciens sockets, ignorance des anciens callbacks et d’un 401 HTTP retardé ;
- fallback HTTP lorsque les tickets échouent, conservation du credential sur 403, suppression du credential natif et arrêt des tentatives après révocation 401.

Exécution : `PLAYWRIGHT_BROWSERS_PATH="$PWD/node_modules/.cache/ms-playwright" TMPDIR="$PWD/node_modules/.cache/cb14-tmp" npx playwright test -c playwright.mobile-network.config.ts` (6 tests). Installation préalable de Chromium avec les mêmes variables : `npx playwright install chromium`. Ce test navigateur ne prétend pas exécuter un APK ni Android Keystore.

## Réponses de commandes retardées (itération de revue 2)

Le contrôleur de commandes capture la génération au lancement et la vérifie avant d’appliquer une réponse, de lancer une réconciliation ou d’utiliser son résultat. Une commande obsolète rend `accepted: false, reason: stale` sans confirmation utilisateur. Les verrous sont propres à la génération : terminer une ancienne commande ne débloque pas une commande courante.

Le transport capture également la génération pour toutes les réponses HTTP : commandes, lectures, réglages, planning, providers et compagnon. Il rejette les succès et erreurs obsolètes avant leurs consommateurs, notamment les appels directement transmis à `render`. Une erreur obsolète ne déclenche pas le fallback planning vers le nouveau PC. Quand la surveillance HTTP découvre une nouvelle instance Desktop, elle invalide la génération avant de reconnecter.

Deux tests Chromium supplémentaires suspendent une commande du parcours livré, adoptent l’état d’une nouvelle instance Desktop (via événement online ou surveillance HTTP), puis libèrent l’ancienne réponse `streaming=true`. L’état reste arrêté et les contrôles courants restent disponibles. Les tests unitaires couvrent aussi la réconciliation suspendue, l’absence de réconciliation d’une erreur ancienne et l’isolation des verrous entre générations.
