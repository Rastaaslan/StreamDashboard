# Audit — Android réellement autonome

## Cible produit

Android doit être un client StreamDashboard principal et offline-first.

Le PC est un autre client / une cible de contrôle OBS lorsqu’il est disponible. Son absence ne doit pas empêcher :
- le démarrage de l’application ;
- l’édition du profil et de l’apparence ;
- la gestion Planning / Notes / Checklist / Templates ;
- la connexion Twitch et Google ;
- la publication/synchronisation du Planning vers Twitch et Google ;
- la conservation durable des modifications jusqu’à la prochaine synchronisation multi-device.

Les fonctions intrinsèquement liées à OBS ou au mix audio du PC peuvent rester indisponibles lorsque cette cible est hors ligne, sans mettre l’application entière en état « hors ligne ».

## État actuel

### Déjà utilisable localement

- Planning local via `CompanionStore`.
- Notes, checklist et templates locaux.
- File de mutations companion avec conflits/révisions.
- Export d’image Planning et partage Android.
- SecureCredentialStore Android basé sur Android Keystore / AES-GCM.
- Bridge OAuth natif Twitch + Google avec PKCE, state et expiration du pending OAuth.
- CRUD natif d’événements Planning Twitch et Google.
- Recherche native de catégories Twitch.
- Provider links locaux avec états `syncing/synced/error/conflict`.
- Cache local de catégories Twitch récentes.

### Fonctions volontairement dépendantes d’une cible PC

Ces fonctions ne bloquent pas l’indépendance du client Android ; elles doivent simplement être présentées comme des commandes d’une cible PC indisponible :
- OBS : scènes, audio, start/stop du stream, timer overlay.
- Soundboard diffusée dans le mix OBS.
- Relance Media Sources / Browser Sources OBS.

## P0 — bloqueurs avant de pouvoir appeler Android « autonome »

### 1. Les APK publiés ne provisionnent pas les OAuth Android

`android/app/build.gradle` lit :
- `TWITCH_ANDROID_CLIENT_ID`
- `GOOGLE_ANDROID_CLIENT_ID`

mais `.github/workflows/android.yml` ne les injecte jamais.

Conséquence actuelle : les deux BuildConfig valent chaîne vide et le bridge renvoie `configured=false`, d’où « Indisponible dans cette version ».

À faire :
- provisionner les client IDs publics Android chez Twitch et Google ;
- injecter les IDs via GitHub repository variables dans le job Android ;
- faire échouer la build Remote release si l’un des deux IDs est absent ;
- permettre au build Preview de rester non provisionné ;
- tester automatiquement que la release ne contient pas de client ID vide.

### 2. Le premier lancement reste conçu comme une télécommande

`connect()` exige un credential de pairing PC.
Sans credential : « Appairage requis ».

`start()` affiche encore le pairing comme chemin principal quand aucun serveur PC n’est enregistré.

À faire :
- créer une identité d’installation Android locale dès le premier lancement ;
- démarrer directement en mode autonome si le PC est absent ;
- rendre « Ajouter / connecter un PC » optionnel dans Application ;
- ne jamais demander un pairing pour utiliser Planning / profil / providers natifs.

### 3. L’état de connexion confond PC et application

`setConnectionMode()` considère uniquement `ONLINE_PC` comme « online ».
`ONLINE_STANDALONE` apparaît donc visuellement « Hors ligne ».

`offlineState()` force aussi `twitch.connected=false` et `google.connected=false` même si les providers natifs Android sont authentifiés.

À faire :
- séparer au minimum :
  - état Internet ;
  - état providers Android ;
  - disponibilité cible PC ;
  - état de synchronisation multi-device ;
- afficher « Téléphone autonome » / « PC hors ligne » plutôt que « application hors ligne » ;
- dériver l’état Twitch/Google affiché depuis le ProviderBridge en standalone.

### 4. Profil / apparence / modules restent canoniques côté PC

Le formulaire `profile-appearance-form` refuse actuellement l’enregistrement hors `ONLINE_PC`.

Le cache local `streamdashboard.mobileUx` persiste seulement Focus et Reduce Motion ; thème, accent, densité, radius et textScale ne sont pas stockés localement comme profil canonique.

Le ProductProfile complet n’est pas inclus dans CompanionStore.

À faire :
- ajouter un ProductProfile local versionné côté Android ;
- enregistrer profil + apparence + modules sans PC ;
- appliquer la projection modules depuis le profil local ;
- synchroniser ensuite ce domaine avec les autres clients sans synchroniser les secrets.

### 5. Les provider links Android ne sont pas propagés correctement au PC

`CompanionStore.updateProvider()` modifie `providerLinks` localement mais n’ajoute pas de nouvelle opération de synchronisation.

L’opération `create` est généralement mise en file avant que le provider natif retourne `remoteId/revision/fingerprint/calendarId`.

Le serveur Companion sait accepter `providerLinks`, mais Android ne garantit pas qu’ils arrivent dans le journal envoyé au PC.

Risque :
- le PC récupère l’événement sans savoir qu’il existe déjà sur Twitch/Google ;
- doublons de publication ;
- suppressions distantes impossibles ;
- conflits faux au retour du PC.

À faire :
- journaliser toute modification de provider link, ou enrichir les opérations pendantes avant envoi ;
- synchroniser remoteId/revision/fingerprint/calendarId de façon déterministe ;
- tester le scénario : Android crée + publie → PC démarre → zéro doublon.

### 6. Pas de replay automatique des publications après retour Internet

Un événement créé en `OFFLINE` reste local.
Le passage ultérieur à `ONLINE_STANDALONE` ne parcourt pas automatiquement les publications Twitch/Google en attente.

À faire :
- file provider durable distincte ou dérivée des desiredPublication/providerLinks ;
- replay automatique au retour réseau ;
- backoff + retry ;
- état visible `pending/syncing/error/conflict/synced`;
- aucune perte si l’application est tuée entre deux tentatives.

## P1 — fonctionnalités nécessaires pour que Twitch / Google soient réellement complets sur Android

### 7. Twitch natif est actuellement limité au Planning

ProviderBridge expose actuellement :
- status / authorize / logout ;
- recherche catégorie ;
- create/update/delete Planning.

Il n’expose pas les fonctions Twitch présentes via le Runtime PC :
- titre / catégorie de chaîne ;
- chat lecture / écriture ;
- chatters / audience ;
- clips ;
- VOD + suppression ;
- modération ;
- récompenses / Streamer Pings.

Les scopes natifs actuels sont seulement :
`channel:manage:schedule channel:read:schedule`.

À faire selon le périmètre produit retenu :
- élargir les scopes Twitch Android ;
- exposer les opérations natives correspondantes ;
- afficher des capabilities réelles plutôt qu’un simple booléen connected ;
- gérer réautorisation par scope.

### 8. Google natif ne permet pas de choisir le calendrier cible

Le bridge Google fait du CRUD Calendar mais utilise `primary` en fallback.
Il n’expose pas la liste des calendriers ni le choix d’un calendrier cible.

À faire :
- lister les calendriers ;
- choisir/persister le calendrier cible Android ;
- afficher le compte/calendrier actif ;
- conserver le calendarId dans les provider links.

### 9. Le flux OAuth Google doit garantir un refresh token durable

Le bridge utilise PKCE mais la requête d’autorisation Google n’ajoute pas actuellement explicitement les paramètres nécessaires à un accès offline durable.

À vérifier/configurer avec le client OAuth officiel Android :
- redirect URI réellement enregistrée ;
- type de client compatible avec le callback Android ;
- obtention fiable d’un refresh token ;
- rotation/réauth lorsque refresh absent ou révoqué.

### 10. Les récurrences ne sont pas réellement publiées de façon autonome

CompanionStore sait stocker la récurrence.
ProviderBridge crée/modifie cependant un seul objet provider par événement canonique.

Il n’existe pas de mapping par occurrence pour Twitch/Google côté standalone.

À faire :
- définir la stratégie de publication des séries ;
- matérialiser les occurrences nécessaires ;
- provider links par occurrence ;
- propager édition/suppression d’une occurrence sans dupliquer la série.

## P1 — données et synchronisation

### 11. La synchronisation Companion reste PC-authoritative

Le endpoint `/api/v1/companion/sync` vit dans le Runtime PC.
Le vocabulaire de conflit est encore `pc/android`.
Le PC reste l’autorité qui ACK le journal.

Pour un téléphone réellement principal, deux options :
1. transition courte : conserver la sync LAN, mais considérer Android comme source locale complète et permettre un pairing tardif ;
2. cible produit : `Desktop ↔ StreamDashboard Sync ↔ Mobile`, chaque client offline-first.

À faire dans tous les cas :
- identité device indépendante du pairing ;
- synchro device-neutral ;
- conflits `device A / device B`, pas `PC / Android` ;
- ProductProfile, modules, notes, checklist, templates, planning et metadata providers dans le même domaine partagé.

### 12. Le stockage canonique Android repose sur WebView localStorage

Planning / notes / checklist / templates sont aujourd’hui persistés dans localStorage.

Pour une télécommande, c’est acceptable ; pour le client principal, c’est fragile.

À faire :
- stockage natif durable (Room/SQLite ou fichier versionné atomique) ;
- migration depuis `streamdashboard.companion.v3` ;
- backup/export/import ;
- stratégie de récupération après corruption ;
- conserver les tokens séparément dans Android Keystore.

## P2 — autonomie avancée / modules communautaires

### 13. Automatisations

Le moteur AutomationRuntime vit sur le PC.
Android ne peut pas exécuter d’automatisations PC éteint.

À terme :
- moteur partagé côté Android pour triggers/actions autonomes ;
- router les actions OBS/Soundboard vers la cible PC seulement lorsqu’elle existe ;
- WorkManager / service natif pour exécution fiable en arrière-plan.

### 14. Streamer Pings / EventSub

Les notifications Android sont actuellement déclenchées à partir de l’état reçu du Runtime PC.
PC éteint = aucun EventSub Twitch = aucun Streamer Ping.

À faire pour autonomie complète :
- EventSub Twitch natif ou service cloud/push ;
- gestion background Android robuste ;
- persistance/acquittement local puis sync multi-device.

### 15. Streamlabs / soutiens

SupportRuntime + socket Streamlabs sont PC-only.

Choix produit :
- implémenter un connecteur natif Android + service background ;
- ou déplacer ce provider vers StreamDashboard Sync/cloud.

### 16. Discord

Publication Discord directe est PC-only.
Le mode officiel est marqué non déployé.

Choix recommandé :
- service officiel côté StreamDashboard Sync plutôt que token de bot global dans l’APK ;
- Android appelle le service, jamais un secret bot embarqué.

### 17. WizeBot

WizeBot est actuellement configuré/exécuté sur PC.
Même choix : bridge natif ou service Sync.

## UX à corriger pour refléter l’architecture

- « Comptes connectés » doit présenter d’abord les comptes Android canoniques.
- Les connexions du PC doivent devenir « Connexions de la cible PC » et n’apparaître que quand la cible existe.
- Le bloc `Connexions du téléphone` ne doit plus être secondaire une fois Android principal.
- Le statut principal doit distinguer :
  - Internet ;
  - Twitch ;
  - Google ;
  - PC/OBS cible ;
  - Sync.
- « Mets à jour le PC pour gérer cette connexion » ne doit jamais apparaître pour une connexion Android native.
- Le pairing PC doit devenir une action optionnelle, pas une condition d’entrée.

## Ce qui ne doit PAS être considéré comme un manque d’indépendance

Quand le PC est éteint, il est normal de ne pas pouvoir :
- changer une scène OBS ;
- muter une source OBS ;
- contrôler le mix OBS ;
- démarrer/arrêter OBS ;
- utiliser la Soundboard injectée dans OBS ;
- relancer une Media Source OBS.

Android reste le client principal ; ces fonctions sont simplement des commandes d’un périphérique/cible actuellement absent.

## Ordre d’implémentation recommandé

### Phase A — rendre l’APK autonome réellement utilisable
1. Provisionner/injecter OAuth Twitch + Google Android.
2. Build guard : refuser un Remote APK sans IDs OAuth.
3. Démarrage sans pairing PC.
4. Identité device locale indépendante.
5. États ONLINE_STANDALONE corrects dans toute l’UI.
6. Connexions Twitch/Google Android comme comptes principaux.
7. ProductProfile + apparence + modules locaux/persistants.

### Phase B — fiabiliser Planning autonome
8. Provider links synchronisés vers PC.
9. Replay auto après retour Internet.
10. Google : calendrier cible.
11. Récurrences/occurrences provider.
12. Tests zéro doublon lors du retour PC.

### Phase C — parité Twitch Android
13. Titre/catégorie.
14. Chat/audience.
15. Clips/VOD.
16. Récompenses/Streamer Pings.
17. Modération selon scopes.

### Phase D — vraie synchronisation multi-device
18. Domaine Sync device-neutral.
19. ProductProfile et metadata provider partagés.
20. Remplacer le rôle d’autorité du PC par StreamDashboard Sync.

### Phase E — modules secondaires
21. Automatisations autonomes.
22. Streamlabs.
23. Discord officiel.
24. WizeBot.
25. Diagnostics Android locaux.

## Critères d’acceptation « Android indépendant »

Un build n’est pas considéré autonome tant que ces scénarios ne passent pas :

1. Installation neuve, aucun PC jamais démarré.
2. L’app s’ouvre sans pairing obligatoire.
3. Connexion Twitch depuis le téléphone.
4. Connexion Google depuis le téléphone.
5. Création d’un live Planning et publication Twitch + Google.
6. Fermeture complète / redémarrage : comptes et données présents.
7. Création Planning sans Internet.
8. Retour Internet : synchronisation provider automatique sans rouvrir l’événement.
9. Modification/suppression standalone répercutée chez les providers.
10. PC appairé seulement après plusieurs jours d’utilisation Android.
11. Première sync PC : aucun doublon Twitch/Google.
12. Modification simultanée PC/téléphone : conflit explicite et résoluble.
13. Profil/apparence/modules modifiables PC éteint.
14. Les fonctions OBS indiquent seulement « cible PC indisponible » sans bloquer le reste de l’application.
