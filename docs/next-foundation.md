# StreamDashboard NEXT — configuration opérateur

## Google Cloud Console

1. Créer ou sélectionner un projet, puis activer **Google Calendar API**.
2. Configurer l'écran de consentement OAuth et ajouter les comptes de test tant que l'application est en mode test.
3. Créer un client OAuth de type **Application de bureau**. Seul l'identifiant client public est configuré dans StreamDashboard ; aucun secret client n'est embarqué.
4. Autoriser le scope `https://www.googleapis.com/auth/calendar`. La connexion utilise Authorization Code, PKCE, un `state` aléatoire et un callback loopback.
5. Choisir dans StreamDashboard un calendrier dont le rôle est `owner` ou `writer`. Les refresh tokens sont chiffrés par le secret store Electron et ne figurent jamais dans l'état public.

## Test Android sur le LAN

1. Vérifier que le PC et le téléphone sont sur un réseau privé de confiance et que le profil pare-feu Windows est **Privé**.
2. Dans les réglages desktop, activer explicitement **Télécommande LAN**, puis **Ajouter une télécommande**.
3. Ouvrir sur Android l'URL `/mobile/` affichée avec le QR code et saisir/scanner le code court avant son expiration.
4. Installer la PWA depuis le menu Chrome. Tester la reconnexion en coupant puis réactivant le Wi-Fi : l'indicateur passe par « Reconnexion » et un snapshot complet remplace l'état obsolète.
5. Pour START et STOP, vérifier que la confirmation est affichée et que l'interface attend le retour du serveur. Révoquer ensuite l'appareil depuis le desktop et vérifier le refus immédiat.

## Modèle de sécurité LAN

Le mode distant est désactivé par défaut et le serveur reste alors lié au loopback. L'activation LAN n'effectue ni UPnP ni redirection de port. Les mutations et WebSockets venant du LAN exigent une credential aléatoire propre à l'appareil ; les codes de pairing expirent, sont à usage unique et sont limités en débit. Les en-têtes `Origin` doivent correspondre au `Host`. HTTP/WS local protège contre les applications web étrangères et les appareils non pairés, mais ne chiffre pas le trafic : utiliser exclusivement un LAN privé de confiance, sans exposition Internet. Une terminaison HTTPS/WSS locale administrée peut être placée devant le serveur si le certificat est installé sur Android.
