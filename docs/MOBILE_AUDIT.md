# Audit fonctionnel et technique de StreamDashboard Mobile

Audit statique et automatisé réalisé le 19 septembre 2026. Les mentions **inspecté**,
**test automatisé** et **non vérifié sur matériel** sont volontairement distinctes.
Le smoke réseau démarre un vrai serveur et utilise son API LAN, mais aucun OBS, compte
Twitch/Google/Discord/Streamlabs ni téléphone physique n'était disponible.

## Architecture et cartographie

Le mobile est une application HTML/ES modules servie sous `/mobile/` et embarquée dans
une WebView Android. `mobile.js` orchestre l'interface, `transport.js` centralise HTTP et
WebSocket, `companion-store.js` persiste la réplication dans `localStorage`, et le bridge
Android conserve la credential hors du DOM. Le PC reste canonique. Les commandes passent
par `/api/v1/commands`; `/ws/v1` pousse les snapshots et n'est pas le canal de commande.
La réplication utilise `/api/v1/companion/sync`, un curseur global, des révisions par objet,
des tombstones, une file persistante, un journal d'idempotence serveur et des conflits
explicites. OBS et les providers sont toujours pilotés par le backend PC.

| Écran / surface | Route / composant | Fonction et données | API principales | État audité / actions |
|---|---|---|---|---|
| Appairage | `/mobile/`, `#pairing` | URL PC, lien, challenge, device | `POST /remote/pair` | Test automatisé : création credential, erreurs auth visibles |
| Accueil | `data-view=home` | état live, activité, prochain live | state, WS, commands | Inspecté : préparer, scènes, clip, micro et outils |
| Live | `data-view=live` | Twitch, audio, médias, outils live | commands, Twitch, soundboard | Inspecté et tests de politique ; OBS réel non vérifié |
| Sons | `data-view=sounds` | catalogue, recherche, favoris, lecture/stop | soundboard GET/PUT/POST | États vide/offline présents ; périphérique audio non vérifié |
| Planning | `data-view=planning` | CRUD, récurrence, providers, export, Discord | planning, companion, Discord | Unit/intégration ; partage Android non vérifié physiquement |
| Préparation | `data-view=prepare` | checklist, notes, templates | companion sync | CRUD/cache/conflits testés automatiquement |
| Réglages | `data-view=settings` | auth, providers, préférences, sync, diagnostic | sync, events | Diagnostic sync et action manuelle ajoutés |
| Plus | `data-view=more` | navigation secondaire/intégrations | état projeté | Inspecté ; aucune destination sans panneau |
| Palette | `#command-palette` | commandes et favoris récents | commands, Twitch, soundboard | Inspecté ; erreurs rendues dans le toast live |
| Scènes | `#scene-sheet` | presets autorisés uniquement | commands | Politique allowlist testée ; OBS réel non vérifié |
| Éditeurs | dialogs slot/note/template/conflict | CRUD et résolution | planning/companion | Fermeture, annulation et handlers inspectés |

Les vues ne sont pas des routes URL séparées : `selectTab` commute les panneaux et conserve
le dernier onglet. Le retour système ferme d'abord les `dialog` via la WebView ; aucune
promesse de deep-link vers une vue interne n'est faite.

## Inventaire des interactions

| Écran | Élément / comportement attendu | Handler → API/backend → résultat UI | Statut |
|---|---|---|---|
| Appairage | Appairer | `pair` → remote pair → credential sécurisée → connexion | test automatisé |
| Accueil | Préparer | handler HTTP prioritaire → `session.prepare` → snapshot | test automatisé |
| Accueil/Live | Start/Stop | confirmation → command service → état OBS canonique → rendu | backend testé ; OBS réel non vérifié |
| Accueil/Live | scène/micro/clip | commandes allowlist/Twitch → ACK → toast/snapshot | inspecté ; intégrations réelles non vérifiées |
| Live | sliders/mute/média | `obs.volumeDb`, `obs.mute`, `obs.media.restart` → ACK | politique testée ; OBS réel non vérifié |
| Twitch | titre/catégorie/chat/modération/VOD | routes Twitch → réponse → toast/liste | erreurs/scopes inspectés ; compte réel non vérifié |
| Sons | filtres/favori/play/stop | soundboard runtime → ACK → rechargement | intégration simulée/testée |
| Automatisations | CRUD/toggle/test | automation runtime → résultat/rechargement | tests runtime ; audio réel non vérifié |
| Planning | créer/modifier/supprimer/récurrence | planning ou sync fallback → snapshot → liste | test automatisé |
| Planning | export/Discord | canvas/partage ou upload → confirmation | génération testée ; partage/service réel non vérifié |
| Checklist | ajouter/cocher/supprimer | mutation locale → sync → snapshot | test automatisé |
| Notes | ajouter/éditer/supprimer | mutation locale → sync → snapshot | test automatisé |
| Templates | CRUD/appliquer | mutation locale → formulaire planning | test automatisé |
| Réglages | préférences | localStorage/bridge natif → rendu | inspecté |
| Réglages | resynchroniser | sync authentifiée + state → compteurs/toast | test statique ajouté |
| Conflit | garder PC/téléphone | résolution serveur → snapshot suivant | test sync automatisé |
| Diagnostics | filtrer | events API → liste ou état vide | inspecté |

## Appels réseau mobile

Toutes les routes ci-dessous utilisent `Authorization: Device …`, sauf le pairing. Les
mutations JSON utilisent `Content-Type: application/json`; le transport applique un timeout
de 15 secondes et transforme les réponses non-2xx en erreur utilisateur.

| Méthode | Route(s) | Usage / réponse exploitée |
|---|---|---|
| GET | `/api/v1/state` | snapshot réduit canonique |
| POST | `/api/v1/remote/pair`, `/remote/ws-ticket` | credential puis ticket WS à usage unique |
| WS | `/ws/v1?ticket=…` | `state.updated`, reconnexion bornée |
| POST | `/api/v1/commands` | modes, session, timer, audio, média ; état ACK rendu |
| POST | `/api/v1/companion/sync`, `/companion/conflicts/:id/resolve` | ACK, snapshot, conflits |
| POST/PUT/DELETE | `/api/v1/planning[/…]`, occurrence | CRUD/récurrence, fallback sync sur refus remote |
| GET/PUT/POST | `/api/v1/soundboard[/…]` | catalogue, favori, play/stop |
| GET/POST/PUT/DELETE | `/api/v1/automations[/…]` | CRUD et événement test |
| GET | `/api/v1/supports`, `/api/v1/events` | historique/diagnostic |
| GET/POST/DELETE | `/api/v1/twitch/*` | catégories, chaîne, clips, VOD, chat, modération |
| GET/PUT/POST | `/api/v1/discord/*` | guildes/salons, destination, planning PNG |

Routes backend volontairement non exposées au mobile : réglages/secrets desktop, chemins
locaux, administration des devices, calendriers Google et diagnostics complets. L'audit
inverse n'a pas identifié d'autre route indispensable à la fonction télécommande qui soit
à la fois déjà implémentée et absente de l'UI actuelle. L'enregistrement OBS et le choix
d'une scène arbitraire sont explicitement hors allowlist, donc ne sont pas des contrôles
fantômes à ajouter.

## Registre des constats

| ID | Écran / élément | Problème et cause | Impact | Priorité | Front | Backend | Sync | Correction / test | Statut |
|---|---|---|---|---|---|---|---|---|---|
| MOB-001 | Contrôles OBS | `command()` exigeait un WebSocket ouvert bien que la commande soit HTTP | boutons morts durant reconnexion | P1 | oui | non | non | dépendance WS retirée ; test source | corrigé |
| MOB-002 | Planning/création | `desiredPublication.local` valait `false` dans le handler principal | intention locale incohérente, risque de dépublication | P0 | oui | non | oui | valeur `true` + test | corrigé |
| MOB-003 | Réglages/sync | curseur, file, conflits et device invisibles | diagnostic impossible | P2 | oui | non | oui | panneau d'état persistant | corrigé |
| MOB-004 | Réglages/sync | aucune relance manuelle visible | reconnexion sans action utilisateur | P2 | oui | non | oui | bouton sync, loading, succès/erreur | corrigé |
| MOB-005 | Planning/édition | ancien handler créait au lieu d'éditer | doublon possible | P1 | oui | oui | oui | interception dédiée existante, test régression | déjà corrigé |
| MOB-006 | Planning/suppression | mutation remote pouvait être refusée | suppression impossible | P1 | oui | oui | oui | fallback transactionnel compagnon existant | déjà corrigé |
| MOB-007 | Notes | ancienne vue ne proposait pas édition/suppression complète | CRUD incomplet | P1 | oui | non | oui | contrôleur live-feedback + tests | déjà corrigé |
| MOB-008 | Checklist | état desktop absent du cache initial | liste vide/offline | P1 | oui | oui | oui | seed révisionné + test | déjà corrigé |
| MOB-009 | Start/Stop | dépendance à l'état socket et retour insuffisant | action silencieuse | P1 | oui | oui | non | HTTP + vérification état + test | déjà corrigé |
| MOB-010 | Auth | credential révoquée | boucle de reconnexion possible | P0 | oui | oui | non | purge sur 401/403 et pairing visible | testé automatiquement |
| MOB-011 | Auth | ticket WS rejouable | usurpation/replay | P0 | non | oui | non | ticket à usage unique | testé end-to-end serveur |
| MOB-012 | Auth | révocation ne fermait potentiellement pas le socket | contrôle résiduel | P0 | non | oui | non | fermeture immédiate | testé end-to-end serveur |
| MOB-013 | Cache | JSON de préférences/cache corrompu | crash au démarrage | P1 | oui | non | oui | migration/defaults protégés | testé unitairement |
| MOB-014 | Cache/sync | double envoi concurrent | replay d'opération | P0 | oui | oui | oui | single-flight + idempotence | testé unitairement |
| MOB-015 | Sync | conflit concurrent écrasable | perte silencieuse | P0 | oui | oui | oui | dialogue et résolution explicite | testé unitairement |
| MOB-016 | Sync | suppression non durable | résurrection après restart | P0 | non | oui | oui | tombstones persistants | testé unitairement |
| MOB-017 | Audio | état pouvait être optimiste | mute trompeur | P1 | oui | oui | non | rendu depuis ACK/snapshot, erreurs visibles | inspecté/test politique |
| MOB-018 | Menus/listes | résultats vides sans explication | écran fantôme | P2 | oui | non | non | empty states sons/chat/activité/planning | inspecté |
| MOB-019 | Icônes seules | nom accessible absent | accessibilité | P3 | oui | non | non | `aria-label` sur contrôles concernés | inspecté |
| MOB-020 | Actions sensibles | stop live/VOD/suppression | action accidentelle | P1 | oui | non | non | confirmations contextualisées | inspecté |
| MOB-021 | OBS réel | aucune instance disponible pendant l'audit | validation matériel absente | P1 | — | — | — | protocole/mock seulement | restant |
| MOB-022 | Android réel | aucun téléphone/émulateur instrumenté | back, clavier, rotation et safe areas non certifiés | P2 | — | — | — | build/lint uniquement | restant |
| MOB-023 | Providers réels | aucun compte test Twitch/Google/Discord/Streamlabs | OAuth/publication non certifiés | P1 | — | — | — | clients et erreurs testés isolément | restant |
| MOB-024 | Réseau physique | pas de coupure Wi-Fi réelle | bascule radio non certifiée | P1 | — | — | oui | événements offline/online inspectés | restant |

## Scénarios de synchronisation

Les tests couvrent : PC vers mobile, mobile vers PC, file offline puis ACK, modifications
disjointes fusionnées, conflit sur même champ, choix PC/Android, création, mise à jour,
suppression/tombstone, idempotence et restauration du cache. Le smoke couvre auth LAN,
commande, ticket WS, replay et révocation. Le redémarrage processus et la persistance JSON
serveur sont testés dans la suite. La coupure Wi-Fi réelle, la mort forcée de la WebView et
la reconnexion à un OBS réel restent **non vérifiées sur matériel**.

## Risques et recommandations bornées

1. Exécuter le protocole de `ANDROID_DEVICE_VALIDATION.md` sur un téléphone, avec rotation,
   clavier, retour système, kill/restart et Wi-Fi coupé/rétabli.
2. Valider Start/Stop, scènes, mute et volume avec une instance OBS de préproduction ; ne
   déclarer ces parcours end-to-end qu'après observation de l'état OBS canonique.
3. Utiliser des comptes sandbox pour Twitch/Google/Discord/Streamlabs et conserver les
   captures de réponses/événements, sans credentials dans les artefacts.
4. Ajouter à terme un test WebView instrumenté. Les tests DOM actuels prouvent le câblage et
   les services, pas la géométrie tactile de chaque appareil Android.
