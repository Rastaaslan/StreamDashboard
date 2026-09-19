# Audit StreamDashboard Mobile — HEAD PR #48

Date d'audit : 2026-09-19. Branche : `codex/audit-mobile`. Base et SHA initial :
`6c066473e4e5924a79c9fc0f815085d0a45e7e14`. L'archive de la PR #49 et son
libellé détaillé MOB-001…024 n'étaient pas présents dans ce clone ; les lignes
ci-dessous requalifient donc les thèmes vérifiables du registre, sans prétendre
reconstituer mot pour mot les anciens constats.

## Architecture et niveaux de preuve

Le release Android ouvre `preview.html?runtime=1` dans un WebView à origine locale.
Ce shell V2 donne accès à Accueil, Live, Sons et Planning. Le panneau **Le camp**
transmet une cible via `localStorage`, puis ouvre le shell complet `index.html?legacy=1`
pour Checklist, Notes, Templates, Automatisations, Soutiens, Connexions, Réglages et
Diagnostics. Les deux shells partagent `transport.js`, `command-controller.js`, le
credential chiffré natif et l'état serveur.

Les commandes passent par HTTP `POST /api/v1/commands`; le WebSocket ne sert qu'aux
snapshots/événements et utilise un ticket court à usage unique. Le serveur projette
un `RemoteDashboardState` sans secrets et applique l'allowlist de
`remote-policy.ts`. Companion synchronise Planning, Notes, Checklist et Templates
par révisions, queue, ACK, tombstones et conflits explicites. Le Service Worker ne
s'active qu'en contexte sécurisé ; Android embarque les assets synchronisés et
utilise son propre cache WebView. OBS et les providers restent canoniques côté PC,
sauf publication autonome Twitch/Google via le bridge Android borné.

Les mentions **inspecté**, **test unitaire/intégration/smoke**, **CI**, **WebView** et
**matériel** sont volontairement distinctes. Cet audit local n'affirme jamais une
validation OBS, Twitch, notification ou téléphone réel sans le matériel associé.

## Cartographie des surfaces

| Surface | Entrée / fichier | Données et transport | Backend | Preuve / statut |
|---|---|---|---|---|
| Accueil V2 | nav, `preview.html/js` | snapshot HTTP/WS, Control Hub | state + commands | inspecté, tests WebView existants |
| Live / scènes / audio / timer | nav Live, `preview.js` | `command-controller` HTTP | command service, OBS | intégration simulée ; vrai OBS requis |
| Soundboard | nav Sons | API soundboard HTTP | OBS Soundboard | tests serveur/simulés ; vrai OBS requis |
| Planning rapide | nav Planning | REST planning, snapshot | planning core/providers | tests intégration ; providers réels requis |
| Préparation / Checklist | Le camp → shell complet | Companion + command | sync/checklist | tests intégration |
| Notes | Le camp → Préparation | Companion queue | companion sync | tests intégration |
| Templates | Le camp → Préparation | Companion queue | companion sync | tests unitaires |
| Automatisations | Le camp → Plus/Live | REST CRUD/test | automation runtime | tests intégration, options filtrées par capabilities |
| Streamer Pings | dialogue global | snapshot/WS + ACK HTTP | EventCore/Twitch | tests automatiques ; background réel requis |
| Chat / Audience / modération | shell complet → Live | REST + Control Hub | Twitch | inspecté ; compte/scopes réels requis |
| VOD / Clips | shell complet → Live | REST | Twitch | inspecté ; compte réel requis |
| Soutiens | Le camp → Live | REST | Streamlabs/support runtime | intégration simulée |
| Connexions | Le camp | pairing HTTP, credential natif | remote auth | smoke réel serveur ; téléphone requis |
| Réglages | Le camp → shell complet | localStorage/bridge | Android | inspecté + tests stockage |
| Diagnostics | Le camp → shell complet | `GET /api/v1/events` | EventCore | inspecté |
| Discord | planning / intégrations | REST | Discord client | tests intégration ; provider réel requis |
| Google/Twitch autonome | réglages shell complet | bridge Java borné | APIs providers | tests Java/statiques ; OAuth réel requis |
| Streamlabs/WizeBot | état/intégrations | état serveur | transports providers | tests intégration ; provider réel requis |

## Inventaire des problèmes

| ID | Priorité | Surface | Problème / cause | Impact | Correction | Preuve | Statut |
|---|---:|---|---|---|---|---|---|
| MOB-025 | P2 | Android/navigation | Back ne consultait que l'historique WebView, sans fermer dialogue/panneau ni revenir à Accueil. | sortie ou changement de shell surprenant | contrat Back dans les deux shells, fallback natif seulement si non consommé | test unitaire/statique | corrigé ; matériel requis |
| MOB-026 | P2 | Planning V2 | date initiale obtenue par ISO UTC | mauvais jour près de minuit selon fuseau | formatage depuis le calendrier local | test unitaire | corrigé |

La recherche statique a aussi couvert handlers vides, `console.log`, TODO/FIXME,
listeners multiples, `catch {}`, contrôles désactivés et mocks runtime. Les `catch {}`
restants concernent JSON/cache optionnels ou messages WS malformés ; ils ne valident
pas une commande et ne produisent pas de faux succès. Les fixtures ne sont activées
qu'avec `fixture` + `preview=1`.

## Relecture MOB-001 → MOB-024

| ID | Ancien thème/constat de contrôle | État HEAD actuel | Preuve | Action |
|---|---|---|---|---|
| MOB-001 | commande bloquée si WS non OPEN | corrigé | contrôleur HTTP sans dépendance WS + tests | aucune |
| MOB-002 | absence de lock/double clic | corrigé | lock par ressource + tests | aucune |
| MOB-003 | timeout/ACK tardif non réconcilié | corrigé | timeout critique + `readState/reconcile` | aucune |
| MOB-004 | snapshot ancien écrase l'état | corrigé | `acceptsSnapshot` + tests | aucune |
| MOB-005 | échec auth silencieux | corrigé | 401/403 effacent credential et rouvrent pairing | aucune |
| MOB-006 | ticket WS réutilisable | corrigé | smoke pairing/ticket/replay | aucune |
| MOB-007 | révocation non propagée | corrigé | auth ferme sockets et UI retourne au pairing | validation matériel restante |
| MOB-008 | planning mobile incomplet | partiel assumé | shell complet porte édition/récurrence ; V2 est rapide | garder l'accès avancé |
| MOB-009 | intention `desiredPublication.local` perdue | corrigé serveur | create/sanitize force le canon local à `true` | aucune |
| MOB-010 | Notes non persistées/offline | corrigé | Companion queue + tests | aucune |
| MOB-011 | Checklist non synchronisée | corrigé | Companion + endpoint/command borné | aucune |
| MOB-012 | Templates fantômes | corrigé | module déterministe + tests UI/store | aucune |
| MOB-013 | Automatisations options fictives | corrigé | capabilities serveur et éditeur multi conditions/actions | provider réel requis |
| MOB-014 | Streamer Ping sans ACK multi-client | corrigé | ACK serveur + état WS | Twitch/téléphone réel requis |
| MOB-015 | notification/haptique absente | implémenté, non validé matériel | bridge + permission Android 13 | test appareil |
| MOB-016 | contrôles OBS hors allowlist | corrigé | remote policy scènes/modes/audio/media | vrai OBS requis |
| MOB-017 | Soundboard fallback audio local | non observé | chemin API vers OBS uniquement | vrai OBS requis |
| MOB-018 | état Twitch/scopes trompeur | corrigé en architecture | capabilities/erreurs exposées | compte ancien réel requis |
| MOB-019 | secrets providers exposés | corrigé | projection Remote + bridge ne renvoient aucun token | security check |
| MOB-020 | shell/service worker incomplet | corrigé | allowlist d'assets et check shipped JS | startup offline WebView à valider |
| MOB-021 | préférences non restaurées | corrigé | storage/localStorage + tests | aucune |
| MOB-022 | contrôleurs qui s'écrasent | corrigé en chargement | bootstrap unique puis imports déterministes | aucune refonte |
| MOB-023 | bouton Android Back incohérent | encore présent sur HEAD initial | test ajouté | corrigé MOB-025 |
| MOB-024 | date Planning sensible à UTC | encore présent sous une autre forme | test ajouté | corrigé MOB-026 |

> Les intitulés MOB-002…024 ci-dessus sont des thèmes de requalification et non des
> citations de la PR #49 indisponible. Une comparaison documentaire exacte nécessite
> l'export de cette PR.

## API, commandes et autorisations observées

Routes mobile : state, pairing, ticket WS, commands, Companion sync/conflits,
planning/occurrence, soundboard, automations/capabilities/test, supports/events,
Twitch channel/categories/chat/chatters/modération/videos/clips, Discord status et
publication, Streamer Ping ACK. Commandes visibles : prepare/start/stop, modes
intro/live/pause/end, Chatting configuré, timer start/pause/reset/add, mute/volume
des entrées actives et restart des médias connus. L'allowlist refuse les scènes OBS
arbitraires, l'enregistrement et l'administration desktop. Les scopes Twitch sont
évalués côté serveur ; les scopes autonomes Android sont limités au planning.

## Companion, OBS, Soundboard et Android

Les scénarios de queue, reprise, double flush, idempotence, conflit, tombstone et
restart sont couverts par les suites Companion existantes et ont été relus. Aucun
backend provider réel n'a été utilisé pendant cet audit. OBS/Soundboard ont été
testés automatiquement avec doubles et serveur ; aucun vrai OBS n'a été utilisé.
Android a été inspecté statiquement et construit/testé via Gradle local lorsque
disponible ; aucune rotation, notification Android 13, clavier, background prolongé,
installation/update/signature stable ni vibration n'a été validée sur appareil.

## Backend utile non exposé directement dans V2

L'édition avancée Planning, Notes, Checklist, Templates, Automatisations, modération,
VOD et diagnostics ne sont pas dupliqués dans V2 : ils restent accessibles via **Le
camp** et le shell complet. L'enregistrement OBS, les settings secrets, la gestion
des appareils et les scènes arbitraires restent volontairement desktop-only. Il
n'est pas recommandé de les ajouter au Remote sans nouveau modèle d'autorisation.

## Risques et validation matérielle restante

* La navigation V2 → shell complet repose encore sur une transition document et un
  relais `localStorage`; elle est testée automatiquement, pas sur appareil.
* Le processus tué ne reçoit pas de Streamer Ping : aucun service Android permanent
  n'existe, conformément à la limite annoncée.
* OAuth provider, scopes Twitch historiques, Discord/Streamlabs/WizeBot réels,
  OBS reconnect et publication concurrente exigent les comptes/matériels réels.
* Vérifier sur téléphone : Back (dialogue, Le camp, onglet, sortie), rotation,
  clavier/focus, safe areas, installation de deux APK signés successifs, pairing et
  révocation, Wi-Fi off/on, notification+haptique, vrai OBS et vrai live privé.
