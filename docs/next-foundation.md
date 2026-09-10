# StreamDashboard NEXT — configuration et validation

## Statut

Cette version branche réellement le planning multi-provider, Google Calendar, le préflight Twitch et la télécommande LAN au serveur/UI. Elle reste une **release candidate** : ne pas merger vers `main` avant validation réelle Windows + OBS + Twitch + Google + Android.

## Google Cloud Console

1. Créer ou sélectionner un projet et activer **Google Calendar API**.
2. Configurer l’écran de consentement OAuth et ajouter les comptes de test tant que l’application est en mode test.
3. Créer un client OAuth **Application de bureau**. Aucun secret client n’est embarqué : seul le Client ID public est requis.
4. Configurer ce Client ID avec `GOOGLE_CLIENT_ID` lors de la préparation de la distribution (ou `resources/distribution.json` en développement), puis reconstruire l’application.
5. StreamDashboard utilise Authorization Code + PKCE, `state` aléatoire et callback loopback `127.0.0.1`.
6. Le scope utilisé est `https://www.googleapis.com/auth/calendar`. Les tokens sont stockés via le SecretStore Electron et ne sont jamais renvoyés dans l’état public.
7. Dans Réglages, connecter Google, puis choisir un calendrier avec rôle `owner` ou `writer`.
8. Tester import, create, update, delete, conflit, suppression distante puis redémarrage de StreamDashboard.

## Twitch / préflight

Les nouvelles connexions Twitch demandent `channel:manage:schedule` pour le planning et `channel:manage:broadcast` pour appliquer titre/catégorie avant le live. Une ancienne session ne possédant que le scope planning reste utilisable pour le planning ; le préflight demandera explicitement une reconnexion Twitch si le scope broadcast manque.

Le bouton **Préparer** ne démarre jamais la diffusion. Il prépare OBS, remet le timer à 05:00 hors live, rafraîchit la Browser Source timer configurée et prépare les métadonnées du prochain live sur Twitch si sa catégorie est connue.

## Timer OBS natif StreamDashboard

StreamDashboard expose maintenant un overlay timer indépendant de StreamTool :

`http://127.0.0.1:47832/overlay/timer/`

Le desktop utilise volontairement le port stable **47832** afin que l’URL de la Browser Source OBS ne change pas à chaque démarrage.

Dans OBS, créer une nouvelle **Source navigateur** pour StreamDashboard pointant vers cette URL afin de conserver la source historique StreamTool comme fallback. Dans **Réglages > OBS**, sélectionner ensuite exactement cette Browser Source dans **Browser Source du timer**. StreamDashboard déclenche `refreshnocache` pendant Préparer et juste avant Start ; un bouton manuel reste disponible. Une erreur de refresh du timer ne doit jamais interrompre un live.

## Télécommande Android sur LAN

1. Le mode Remote est **désactivé par défaut** et le serveur reste alors lié au loopback.
2. Dans Réglages, cocher **Télécommande LAN**, enregistrer puis **redémarrer StreamDashboard**. Le changement de bind réseau n’est volontairement pas appliqué à chaud.
3. Après redémarrage, cliquer **Ajouter une télécommande** sur le PC. Le PC affiche un code court et les URL LAN possibles. Le port reste `47832`, ce qui permet au téléphone de retrouver le serveur après redémarrage.
4. Sur Android, ouvrir l’URL `/mobile/`. L’ID/code peuvent être préremplis si le lien de pairing a été utilisé ; sinon les saisir manuellement.
5. Le téléphone échange le code éphémère contre une credential dédiée. Cette credential est stockée localement sur le téléphone ; Twitch/Google/OBS ne sont jamais exposés au mobile.
6. Les WebSockets n’utilisent pas la credential longue dans l’URL : le mobile obtient d’abord un ticket WS court, à usage unique.
7. Tester scènes, timer, audio dB, médias, Préparer, puis START/STOP avec confirmations.
8. Couper/rétablir le Wi-Fi et vérifier la reconnexion + snapshot complet.
9. Révoquer le téléphone depuis le PC : la socket existante doit être coupée immédiatement et la reconnexion refusée.

### HTTP, PWA et modèle de menace

Le mode LAN actuel utilise HTTP/WS. Il est destiné **uniquement à un réseau local privé de confiance** et n’effectue ni UPnP ni ouverture de port. Le trafic n’est pas chiffré.

La page mobile fonctionne comme télécommande web en HTTP LAN, mais un Service Worker/PWA installable nécessite un **contexte sécurisé HTTPS** sur une adresse LAN. Le code n’enregistre donc le Service Worker que lorsque `window.isSecureContext` est vrai. Ne pas annoncer l’installation PWA comme disponible en HTTP LAN.

**Ne pas placer pour l’instant un reverse proxy local devant StreamDashboard.** L’autorisation locale/distance utilise l’adresse socket ; un proxy tournant sur le même PC modifierait le modèle de confiance. Une future tranche HTTPS devra être proxy-aware et explicitement testée avant d’être documentée comme supportée.

## Sécurité remote

- seules `/api/v1/health` et `/api/v1/capabilities` sont lisibles à distance sans credential ;
- `/api/v1/state`, `/api/v1/commands` et la génération de ticket WS exigent une credential device ;
- settings, diagnostics, planning CRUD, OAuth et administration devices restent PC-only ;
- les codes de pairing expirent, sont à usage unique et limités en tentatives ;
- les hashes de credentials devices sont persistés, jamais les credentials bruts ;
- la révocation coupe les WebSockets déjà ouverts du device.

## Validation avant merge

Automatique : `npm test`, `npm run build`, `npm run security:check`, `npm run smoke`, `npm run mobile:smoke`, package Windows + smoke Electron.

Manuel obligatoire : scène réellement sélectionnée avant Start, Start/Stop OBS réel, timer 05:00 + nouvel overlay visible, audio cohérent en dB, Google OAuth/CRUD/sync/conflit, Android pairing/reconnexion/révocation.

L’audit des **dépendances runtime** doit rester propre. L’audit des dépendances de développement est suivi séparément : ne jamais masquer son résultat dans un compte-rendu même si la CI le marque non bloquant.
