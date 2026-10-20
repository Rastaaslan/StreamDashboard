# StreamDashboard Next — RC9.2 Android

Correctifs du parcours d’autorisation Google Calendar / YouTube sur le téléphone :

- Le code numérique renvoyé par Google est conservé et présenté sur la carte du service concerné, sans message brut du SDK ni jeton.
- Une autorisation annulée ou refusée conserve la connexion déjà acquise. L’ajout de YouTube ne retire plus l’accès Calendar existant.
- Une seule demande Google peut être ouverte à la fois. La fenêtre native n’est plus présentée comme une connexion à terminer dans un navigateur.
- Le diagnostic de distribution ne déclare plus Google non configuré sur le seul critère d’un client ID incorporé vide : AuthorizationClient utilise le package et le certificat Android.

Installer l’APK par-dessus Next, sans désinstaller. Le package et la signature restent ceux de la RC9.1 ; les données et réglages locaux sont conservés. Ce correctif ne modifie pas l’enregistrement OAuth dans Google Cloud.

En cas de refus, relever le message de la fenêtre Google et le code affiché dans **Mes comptes**. `GOOGLE_API_10` indique une configuration d’application à vérifier côté éditeur : client OAuth de type Android correspondant à `com.rastaaslan.streamdashboard.remote.next` et au SHA-1 du certificat de l’APK. Pour ce candidat, SHA-1 : `E2:F2:1F:4C:28:79:DE:33:B8:85:A4:54:8B:DF:D5:A2:21:2B:1B:1F`. Vérifier aussi l’audience de test et les API Calendar / YouTube du projet si Google signale un accès bloqué. Aucun secret OAuth desktop n’est à saisir dans l’APK.

La validation automatisée couvre les refus du SDK, l’annulation, l’ajout de permissions, le maintien de Calendar, les demandes concurrentes et leur présentation. L’autorisation réelle du compte sur le S24 et la configuration de son client Android chez Google restent à vérifier ; ces tests simulés ne les certifient pas.

Référence de configuration : https://developer.android.com/identity/authorization
