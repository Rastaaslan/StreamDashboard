# F08 — Création de prédiction Twitch à confirmation unique (FIXE, 2026-11-02)

## Périmètre intégré dans les sources 3.0
- La consultation GET reste strictement non mutante.
- Les nouvelles routes **POST** `/api/v1/twitch/advanced/prediction/preview` et `/confirm` sont limitées à un appareil explicitement appairé en gestion, avec capacités `chat+cloud`. L'identité n'est jamais extraite du JSON et le loopback ne vaut pas authentification.
- Le FIXE seul détient le jeton Twitch. Les deux routes nécessitent l'observation OBS/Twitch live de la régie propriétaire, avec barrière `connectionGeneration:streamTransitionEpoch`; aucune nouvelle autorité OBS ou minuterie n'est créée.
- Twitch préflight `oauth2/validate` exige le même compte propriétaire et `channel:manage:predictions`; la chaîne doit être affiliate/partner. Une prédiction active/verrouillée, inconnue ou un fournisseur indisponible empêchent la publication.
- Le brouillon est strict : titre 1–45 caractères, 2–10 issues distinctes de 1–25 caractères, fenêtre entière 30–1800 s. La prévisualisation ne publie rien.
- Un UUID de confirmation lié à l'acteur, l'époque OBS et à une empreinte du jeton n'est conservé qu'en mémoire pendant **45 s maximum**. Le serveur le consomme AVANT la première attente de confirmation. Les permissions, le live, l'epoch et le jeton sont relus avant l'unique POST Twitch.
- Toute erreur après le point où le POST peut partir — même réponse HTTP 400/403, coupure, jeton changé ou reçu illisible — donne `PREDICTION_OUTCOME_UNCERTAIN`, sans retry ou prétention d'échec définitif.
- Dans le Live Monitor, une question et des issues peuvent être saisies, prévisualisées et publiées seulement après une case de consentement et un clic **distinct**. Un reçu perdu, une déconnexion, une suspension ou un changement de source pendant l'envoi verrouille la vue jusqu'à déclaration volontaire de vérification Twitch ; aucun appel automatique.

## Durcissement de concurrence FIXE (23 h, 02/11)
- Deux UUIDs de consentement distincts pour une même chaîne **ne peuvent plus déclencher deux POSTs concurrents** : le service central prend une barrière synchrone par `broadcasterId` avant tout `await`. L'UUID perdant est consommé, retourne 409 et n'émet aucun POST.
- Une erreur `AdvancedTwitchError` survenue **avant** l'envoi Twitch libère la barrière, permettant un nouveau brouillon volontaire. Un POST confirmé ou potentiellement envoyé conserve la barrière fermée : aucune répétition ou deuxième prédiction implicite dans ce processus.
- **Limitation volontaire** : aucune réconciliation serveur autorisée n'existe encore pour libérer la barrière après une résolution Twitch. La création d'une seconde prédiction dans le même processus est donc bloquée après succès/incertitude ; redémarrer perd au contraire cette protection et n'est pas une procédure de reprise sûre. Ne pas déclarer cette UX complète avant état durable + réconciliation d'un reçu.
- Preuve simulée : 14 tests HTTP ciblés, dont deux UUID concurrents et libération après refus pré-POST, 7 tests Edge tactile 320 px, types, sécurité 865 fichiers, types navigateur et revue diff. Aucun véritable POST Twitch effectué.

## Limites de sécurité / gates
- Tests HTTP en boucle locale et Microsoft Edge tactile 320 px utilisent **Twitch simulé**, jamais le vrai compte Twitch ni OBS de production. Aucun utilisateur public, aucun live et aucun appareil Android/laptop physique testés.
- Il n'y a PAS d'atomicité entre OBS, Twitch, un réseau interrompu et la confirmation. Un redémarrage de processus ou un redémarrage de l'application après un POST incertain perd le verrou volatil ; une réconciliation/durabilité sûre est requise pour une certification G3/G4.
- Le même format n'implémente ni verrouillage, ni résolution/cancellation des prédictions. Le résultat réellement affiché aux spectateurs n'est pas vérifié via EventSub.
- Pas d'EXE/APK de production, d'installation, de publication ni de RC finale. F08 demeure **partial**, G2 **in_progress**, G3–G5 **open**. Les exigences 3.1 restent hors scope.
