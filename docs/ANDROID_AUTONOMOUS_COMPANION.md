# Compagnon Android autonome

## Synchronisation transactionnelle (phase 2)

```text
Cache Android -> opérations pending -> Companion Sync API
                                      -> réconciliation -> planning canonique
                                                            |-> Twitch (PC)
                                                            `-> Google (PC)
```

Chaque mutation conserve un `operationId` durable, l'identifiant canonique, sa `baseRevision`, un patch borné et sa base de fusion. Le PC enregistre atomiquement planning, révisions, tombstones, conflits et journal d'idempotence avant de renvoyer `acknowledged`. Android ne retire que ces identifiants de sa queue. Une réponse perdue peut donc être rejouée sans recréation ni nouvelle révision; le journal survit au redémarrage et reste borné à 5 000 entrées.

Les champs disjoints sont fusionnés. Un même champ modifié depuis la base commune reste pending et apparaît en `⚠️ Conflit`; l'utilisateur choisit **GARDER PC** ou **GARDER TÉLÉPHONE**. Delete contre update est également explicite et les tombstones empêchent la résurrection par un ancien snapshot.

Le retour en `ONLINE_PC` déclenche un flush single-flight avant le nouvel état canonique. Timeout, Wi-Fi perdu, réponse perdue, arrêt et 503 conservent la queue; la reconnexion fournit le backoff. `COMPANION_SCHEMA_INCOMPATIBLE` n'efface jamais le cache. Le endpoint exige toujours le credential Remote, même depuis localhost, valide types, identifiants, dates, tailles et clés, et n'expose aucun secret provider ou desktop.

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

## Providers autonomes (Android)

Le routage est strict : `ONLINE_PC` confie toutes les écritures au `PlanningOrchestrator` du PC, `ONLINE_STANDALONE` utilise le bridge Android, et `OFFLINE` ne fait aucun appel externe. La queue compagnon et l'`eventId` canonique restent inchangés dans les trois modes. Chaque succès/erreur est persisté séparément dans `providerLinks`; un retry ciblé ne rejoue donc pas un provider déjà réussi. Au retour du PC, les opérations demeurent dans la queue transactionnelle et les IDs/révisions provider accompagnent l'événement pour que la réconciliation reconnaisse l'écriture déjà publiée.

### OAuth et isolation

Les deux associations sont indépendantes du credential Remote. Le bridge utilise Authorization Code + PKCE (`S256`) dans le navigateur système, sans `client_secret`, puis chiffre access/refresh tokens avec AES-GCM sous une clé non exportable Android Keystore. Le JavaScript ne reçoit qu'un état connecté/non connecté et les résultats métier; aucun token ne rejoint localStorage, le snapshot, la queue, les logs ou l'export PNG.

* Twitch requiert `TWITCH_ANDROID_CLIENT_ID` et les scopes `channel:manage:schedule channel:read:schedule`. Le redirect URI public/native à enregistrer est `streamdashboard://oauth?provider=twitch`. Twitch ne fournissant pas d'ETag de segment, l'adapter relit le segment et compare un SHA-256 stable sur titre, début, fin et catégorie avant update.
* Google requiert un OAuth Client ID d'application Android configuré dans `GOOGLE_ANDROID_CLIENT_ID`, pour le package `com.rastaaslan.streamdashboard.remote`, avec les empreintes SHA-1/SHA-256 de la clé qui signe réellement l'APK. Autoriser le redirect `streamdashboard://oauth?provider=google` et Calendar API. Sans valeur, l'app compile et affiche **Google autonome non configuré**. Les scopes sont `calendar.events` et `calendar.readonly`; les updates/deletes transmettent `If-Match` avec l'ETag connu et transforment 409/412 en conflit.

Configuration CI/build : fournir les variables d'environnement au build Gradle (`TWITCH_ANDROID_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID`). Ne jamais réutiliser ni embarquer le secret du client Desktop. Les créations Google portent `extendedProperties.private.streamDashboardEventId`; ceci permet l'identification métier après une réponse perdue, mais une panne exactement entre création Twitch et réception de son ID ne peut pas être rendue parfaitement idempotente par l'API Twitch.

Les bascules conservent les sessions chiffrées. Les mutations par événement/provider, refresh OAuth et sync compagnon utilisent des single-flights. Une tombstone est conservée même si une suppression provider échoue.
