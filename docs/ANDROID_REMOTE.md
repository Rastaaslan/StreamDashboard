# StreamDashboard Remote pour Android

L'application Android réutilise directement les assets de `apps/mobile`. Le shell Android charge ces fichiers depuis l'origine locale fermée `http://localhost`, bloque toute navigation externe et utilise l'adresse LAN configurée uniquement pour REST et WebSocket.

## Construire et installer

Prérequis : JDK 17, Android SDK 35 et Gradle 8.11.1.

```bash
npm ci
npm run android:check
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

GitHub Actions publie chaque build de pull request sous l'artifact **StreamDashboard-Remote-debug**. Une signature de release pourra être ajoutée par CI avec un keystore fourni exclusivement comme secret ; aucun keystore ou mot de passe n'est versionné.

## Connexion et sécurité

1. Activez **Remote LAN** dans StreamDashboard sur le PC puis redémarrez-le.
2. Créez un appairage avec **Ajouter une télécommande**.
3. Dans l'application, saisissez l'adresse privée du PC (`192.168.1.42:47832`) et l'ID/code, ou collez/ouvrez le lien `streamdashboard://pair?...`.

Le credential longue durée est chiffré AES-GCM avec une clé non exportable de l'Android Keystore. L'adresse et les préférences non sensibles restent dans le stockage web local. Le WebSocket ne reçoit que le ticket court à usage unique.

Android autorise ici le HTTP en clair **uniquement pour permettre la télécommande StreamDashboard sur le LAN**. Ce transport n'est pas HTTPS : ne rendez jamais le port accessible depuis Internet et n'activez ni transfert de port, ni UPnP. Le backend n'accepte comme origine native que `http://localhost`.

## Validation physique restante

- [ ] Installer l'APK, lancer l'application et contrôler icône, portrait et paysage.
- [ ] Appairer sur le PC Stream réel, fermer/rouvrir l'application et vérifier la persistance.
- [ ] Vérifier Intro, Live, Pause, Fin et la scène actuelle avec OBS réel.
- [ ] Vérifier Start/Pause/Reset/+5 du timer et sa synchronisation.
- [ ] Vérifier mute, unmute et le slider de -60 dB à +6 dB sans saut de niveau.
- [ ] Relancer chaque média autorisé du Fun Deck.
- [ ] Confirmer Start Live et Stop Live avec Twitch réel ; vérifier LIVE/OFFLINE.
- [ ] Couper puis réactiver le Wi-Fi et observer la reconnexion automatique.
- [ ] Révoquer le téléphone depuis le PC et vérifier le retour immédiat à l'appairage.
- [ ] Effectuer le test final dual-PC avec le PC Stream cible.

## Scénario terrain final

1. Lancer `StreamDashboard-Desktop.cmd` (et non `npm start`) afin d'utiliser ElectronSecretStore.
2. Vérifier la persistance Twitch et Google après redémarrage, puis la connexion OBS.
3. Connecter Android et vérifier en un appui Intro, Pause, Live et End avec l'overlay associé.
4. Vérifier le timer Intro/Pause, le timer interne End invisible côté viewers et la reconnexion WebSocket.
5. Redémarrer Desktop et confirmer que les credentials sont toujours disponibles.

## Contrôles partagés validés

Le mixer Desktop et Android utilise exclusivement `obs.activeAudioInputs`, calculé par OBS à partir de la scène programme, des scènes et groupes imbriqués activés et des entrées spéciales globales. Les changements de scène et d'activation d'un Scene Item déclenchent un rafraîchissement automatique.

Le téléphone peut rechercher une catégorie puis enregistrer le titre et la catégorie Twitch. Toutes les opérations passent par l'API StreamDashboard authentifiée ; aucun token Twitch n'est projeté vers le mobile.

Les interfaces Desktop et Android proposent +1, +2, +5 et +10 minutes sur l'unique timer serveur. Celui-ci reste pilotable en mode End, mais l'overlay Campfire masque explicitement le chrono pour les viewers dans ce mode.
