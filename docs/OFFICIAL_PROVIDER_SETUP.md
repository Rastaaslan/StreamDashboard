# Fournisseurs officiels et personnalisés

StreamDashboard sépare explicitement deux modes, enregistrés dans le profil **sans secret** :

- `official` : parcours destiné au streamer. Les identifiants publics sont fournis par une distribution officielle et les jetons restent dans `SecretStore`.
- `custom` : parcours avancé pour les forks et installations auto-hébergées. Les identifiants et endpoints sont configurés par l’opérateur.

Le dépôt ne prétend pas qu’une application ou un service externe officiel existe déjà. Tant que les éléments ci-dessous ne sont pas provisionnés, l’interface doit afficher **Indisponible** plutôt que proposer un faux OAuth.

## Twitch

Le mainteneur doit créer une application Twitch StreamDashboard, enregistrer les URI autorisées et publier son client ID dans la configuration de distribution. Le client public utilise le Device Code Flow lorsqu’il est disponible et contrôle les scopes demandés, notamment `channel:read:redemptions`. Les access/refresh tokens sont exclusivement stockés dans `SecretStore`.

Le mode `custom` accepte le client ID d’une application créée par l’opérateur. Aucun client secret ne doit être demandé par l’interface mobile ni écrit dans `streamdashboard.yaml`.

## Google Calendar

Le mainteneur doit créer un projet OAuth, configurer l’écran de consentement et un client Desktop officiel. La distribution fournit le client ID public. PKCE est utilisé lorsque le client n’a pas de secret. Les jetons restent dans `SecretStore`.

En mode `custom`, l’opérateur configure son propre client OAuth. StreamDashboard ne demande jamais à l’utilisateur normal de créer un projet Google Cloud.

## Discord

Le mode officiel nécessite un service StreamDashboard exploité séparément et un bot officiel :

```text
Desktop → service StreamDashboard → bot Discord officiel
```

Le token global du bot ne doit jamais être embarqué dans l’EXE, l’APK ou le profil. Le service, son authentification, sa politique de confidentialité et son exploitation restent des prérequis externes.

Le mode `custom` conserve les possibilités existantes : bot personnel et, lorsqu’une action s’y prête, webhook. Ces champs avancés ne doivent être visibles qu’en mode personnalisé.

## Streamlabs et WizeBot

Aucun OAuth n’est supposé. Les adaptateurs utilisent uniquement les mécanismes réellement fournis par ces services. L’UX peut normaliser le statut, le test et la déconnexion sans présenter un bouton « Se connecter » fictif.

## OBS

OBS reste une connexion locale en mode `custom`, harmonisée dans l’écran Connexions avec les capacités `configure`, `test`, `scenes` et `audio`.

## Checklist de publication officielle

1. Provisionner les applications Twitch et Google.
2. Déployer, sécuriser et superviser le service Discord officiel.
3. Injecter uniquement les identifiants publics dans la configuration de distribution.
4. Vérifier que tous les tokens sont écrits dans `SecretStore`.
5. Tester connexion, révocation, scopes manquants, réautorisation et indisponibilité.
6. Publier les URI de redirection, mentions légales et procédures de rotation.
