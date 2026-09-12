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
