# Configuration effective de la QA StreamCockpit — 04/11/2026

## Contexte
- Actions avec autorisation explicite utilisateur de configurer directement, sur les deux PC accessibles via Remote Desktop Commander. Versions Windows QA installées `a38305f`, anciens profils de repli conservés ; branche canonique peut avancer indépendamment. Toute vérification est hors live et sans publication externe.

## FIXE : vérifications et changements confirmés
- OBS connecté à `ws://127.0.0.1:4555`, streamingKnown=true, streaming=false, recording=false, minuteur arrêté avant et après. 9 scènes, 21 entrées OBS.
- Scènes associées existantes : INTRO / JEU / PAUSE / FIN, discussion CHATTING, démarrage en INTRO. Sortie Twitch OBS principale (kind=main), compte Twitch connecté. Scopes chat, modération, clips, métadonnées et planning retournés disponibles par le runtime.
- **Minuteur réellement configuré** : la source OBS existante `Navigateur web` a déjà `http://127.0.0.1:48133/overlay/timer/` ; un POST optimiste `PUT /api/v2/settings` a déclaré `timerBrowserSource='Navigateur web'`. `GET /api/v2/timer/overlay` indique `ready=true` dans la scène courante INTRO. Second PUT optimiste a défini `requireTimerOverlayOnStart=true`. Aucune création, suppression, déplacement ou déclenchement de source OBS.
- D'après la collection OBS enregistrée, cette source timer se trouve dans INTRO, PAUSE (y compris variante) et FIN mais pas directement dans JEU ou CHATTING. Aucune édition de ces scènes sans décision de placement visuel de l'utilisateur.
- **Google Calendar** : compte connecté, 4 calendriers accessibles ; cible initiale conservée, calendrier Google primaire modifiable. Le planning QA était vide et sans lastSyncedAt. Lecture des routes Google vérifiée : POST /api/v1/google/sync lit les événements distants et ne les publie pas. Synchronisation lancée une seule fois sous garde hors live : 53 événements locaux importés, tous `source=GOOGLE`, `category=personal`, `ownership=EXTERNAL`, zéro `desiredPublication.twitch=true` ; lastSyncedAt désormais présent et aucune erreur Google. Pas d'écriture distante sur Google/Twitch.
- **Soundboard** : GET /api/v1/soundboard/obs/status retourne ready=true, active=true et connecté ; aucune nouvelle source créée. 6 actions, 1 macro enregistrée ; replay buffer disponible/activé mais inactif hors live.
- **Audio** : micro OBS `micro` non muet, environ -4.5 dB ; source nommée `jeu` muette (~-31 dB) et plusieurs autres captures audio présentes ; pas d'unmute aveugle. Spotify Windows contrôlable, mais pas de preuve de lecture réelle. Dans les fichiers OBS enregistrés, `VodTrackEnabled=true`, `VodTrackIndex=6` et la source `spotify` a le masque mixers 223, excluant cette piste. Vérifier la séparation VOD par enregistrement test avant de déclarer la réception audio complète.
- **Providers absents** : Discord non configuré, Streamlabs OAuth + historique non configurés, WizeBot `NOT_CONFIGURED`, DJI `unavailable`. Aucun jeton créé, copié, supprimé ou demandé dans le chat.

## Laptop QA : modification de la topologie
- Avant : ordinateur FIXE reconnu comme unique `obs-executor`, mais `routes.planning` et `routes.cloud` désignaient encore le laptop (révision 2), incohérent avec l'autorité unique FIXE.
- Le laptop QA a été fermé proprement, port local 48135 libre, installation-v2.json vérifié (version 2, preset dual-pc, runtimeProfile device-runtime, maître actif à `https://192.168.1.15:48136` avec rôle services et capacités planning/cloud). Pas de transition `.pending`.
- Sauvegarde native unique `.backup` de la révision 2 puis mise à jour atomique révision 3 de **seules destinations** planning et cloud vers FIXE. OBS/clips restent FIXE ; chat, audio, visionneuses, stockage et raccourcis restent locaux. Aucune donnée OAuth, compte ou planning du laptop copiée/écrasée.
- Redémarrage QA laptop réussi sur le même binaire, rôle client confirmé, aucun obs-executor local, aucun minuteur local, HTTPS `https://192.168.1.15:48136/api/v1/health` HTTP 200. Révision 3 et nouvelles destinations relues sur disque. Association authentifiée depuis l'UI du client vers FIXE **pas encore réceptionnée** de bout en bout.

## Restant et garde-fous
- Vérifier sur Android physique le jumelage, la fraîcheur des données, la synchronisation du minuteur et les commandes authentifiées, sans action Twitch publique. Le fait que FIXE ait deux associations enregistrées ne prouve pas qu'elles soient actuellement connectées.
- Vérifier en OBS de test le son jeu, les pistes VOD (Spotify absent), la visibilité timer sur JEU/CHATTING selon l'intention, et le parcours d'arrêt/reprise hors live.
- Discord nécessite un vrai bot/token + serveur/salon ; Streamlabs nécessite OAuth/token ; WizeBot nécessite endpoint/token. DJI nécessite un équipement/relai donnant des mesures réelles.
- **Aucune gate G3/G4/G5 nouvellement qualifiée**, aucune édition de projet RC2/WorldPrep, aucune diffusion ni minuteur déclenché. Aucun changement de code produit pendant cette configuration.
