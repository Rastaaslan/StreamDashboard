# Compagnon Android autonome

## Modèle de fonctionnement

Le runtime mobile distingue `ONLINE_PC`, `ONLINE_STANDALONE` et `OFFLINE`. Une coupure du WebSocket ne bloque plus le planning : le dernier snapshot versionné est rendu immédiatement, les commandes OBS restent désactivées, et la reconnexion conserve le backoff existant. Le retour du socket replace le PC comme coordinateur et renouvelle le snapshot.

Le cache `streamdashboard.companion.v2` contient uniquement des données fonctionnelles non sensibles : planning canonique, liens provider, révisions, tombstones, file d'opérations, nom du streamer, préférences, catégories récentes, notes, checklist et templates. Chaque création Android reçoit un identifiant canonique stable. Les opérations `create`, `update` et `delete` conservent `eventId`, `baseRevision`, horodatage, patch et destinations ; une suppression conserve aussi un tombstone.

Les tokens, mots de passe OBS et secrets OAuth sont explicitement exclus de ce cache. La credential Remote existante reste dans le stockage AES/GCM adossé à `AndroidKeyStore`, avec le même alias et les mêmes `SharedPreferences`.

## Réconciliation

Une mutation locale vérifie `baseRevision`. Une révision différente produit un conflit explicite au lieu d'un écrasement. Le moteur de réconciliation compare les champs modifiés depuis une base commune : des champs disjoints sont fusionnés, mais un même champ modifié des deux côtés produit un conflit avec les versions PC et Android. Les identifiants canoniques, puis les identifiants provider, doivent être utilisés avant tout rapprochement heuristique. Les tombstones empêchent un ancien snapshot PC de ressusciter une suppression.

## Providers et OAuth : configuration requise

La publication directe provider n'est **pas activée** tant que les clients OAuth publics ne sont pas configurés et validés sur appareil réel. Il est interdit de copier les secrets Desktop dans l'APK.

* Twitch devra utiliser le Device Code Grant avec un `TWITCH_CLIENT_ID` public autorisé pour ce flow, sans client secret.
* Google devra utiliser Authorization Code + PKCE/AppAuth avec un **OAuth Client ID Android distinct**, lié au package `com.rastaaslan.streamdashboard.remote` et à l'empreinte SHA-1 réelle de la clé de signature. Aucun identifiant n'est inventé dans le dépôt.
* Les jetons devront être traités par le bridge natif et chiffrés avec Android Keystore ; ils ne devront jamais rejoindre `localStorage`, les logs ou les exports PNG.

En l'absence de cette configuration, les choix Twitch/Google et les mutations sont conservés durablement avec l'état « À synchroniser ». Ils ne sont pas annoncés comme publiés.

## Limites de cette étape

Cette étape livre le socle offline, l'interface de préparation locale, les tombstones et la détection/merge de conflits. Le transfert transactionnel de la queue au serveur, la lecture provider avant écriture, les flows OAuth natifs et les écrans complets de résolution de conflit restent à implémenter avant de considérer la publication autonome Twitch/Google prête pour production.

La signature stable dépend toujours des variables CI `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` et `ANDROID_KEY_PASSWORD`. Sans elles, un APK local n'établit pas la compatibilité de mise à jour in-place.
