# Cartographie observée des flux

SC3-FLOW-ONESHOT-001. Audit du code sur FIXE, pas une observation réseau de production. Les 22 flux détaillés (propriétaire, contrat, cadence, erreurs, reconnexion, persistance, preuves) sont dans SERVICE_FLOW_DETAILS.json. Une latence non mesurée reste null ; 2500 ms désigne une période de lecture, pas une mesure Wi-Fi.

| Flux | Source → destination | Transport | Catégorie | Authentification / résultat |
|---|---|---|---|---|
| FLOW-01 | UI Windows FIXE/laptop → runtime local nommé, régie critique sur FIXE | HTTP loopback + IPC Electron | B | Session locale bornée au frame Electron ; permissions des routes ; État/reçu de commande ; lecture de retour |
| FLOW-02 | Windows laptop → FIXE | HTTPS via IPC requestPeer ; empreinte TLS | B | Device appairé + rôles + pin maître ; Reçu corrélé, identité maître explicite |
| FLOW-03 | Android WebView → FIXE | HTTPS via PeerBridge et empreinte TLS | B | Device appairé + permissions, secrets conservés côté natif ; Snapshot compte + receipt Helix, pas de message optimiste |
| FLOW-04 | FIXE → OBS | WebSocket OBS v5 | B | Identifiants OBS locaux ; rôle obs-executor ; RequestId/confirmation de scène/état selon commande |
| FLOW-05 | Agent V2 optionnel FIXE → OBS | WebSocket v5 + contrat Agent | B | Identité contrôleur, capacités, epoch, journal durable ; AgentReceipt UUID + lecture de retour |
| FLOW-06 | Twitch Chat → runtime Windows du compte nommé | EventSub WebSocket TLS | A | OAuth FIXE user:read:chat ; session EventSub ; IDs messages, dédoublonnage serveur |
| FLOW-07 | Runtime Windows du compte nommé → Twitch Helix | HTTPS REST | A | Jeton OAuth FIXE ; user:write:chat + scopes par action ; message_id ou résultat incertain ; pas de retry d'effet |
| FLOW-08 | Android compte local explicite → Twitch Chat | IRC TLS 6697 + Helix HTTPS pour envoyer | A | OAuth Android propre : chat:read ; Helix user:write:chat ; Messages par ID, envoi natif reçu persisté |
| FLOW-09 | Chat FIXE relayé → UI Android | GET /api/v1/twitch/chat/state | C | Permissions Device + chat ; identité du broadcaster dans snapshot ; Snapshot borné à 200, IDs et ordre d'arrivée |
| FLOW-10 | Clients → Planning et configuration FIXE | GET autonomy + POST autonomy/sync | C | Gestion appairée ; workspace + edit id + base ; Reçu durable applied/conflict/uncertain ; comparaison 3 voies |
| FLOW-11 | FIXE → Google Calendar | OAuth + HTTPS REST v3 | A | OAuth Windows propre ; calendar.events + calendar.calendarlist.readonly ; Identifiants provider et conflits de projection |
| FLOW-12 | Android espace autonome → Google Calendar | AuthorizationClient natif + HTTPS | A | Compte Android propre ; calendar.events + calendar.readonly ; État provider et reçus ; planning du workspace sélectionné |
| FLOW-13 | FIXE → Discord | HTTPS REST v10 | A | Bot local ; droits du salon configuré ; ID message ; erreur 429 affichée |
| FLOW-14 | FIXE/compte explicite → WizeBot | Catalogue HTTP + commandes par Twitch Helix | A | Compte Twitch et accès catalogue ; permission chat ; Envoi Twitch distinct de la réponse WizeBot |
| FLOW-15 | Streamlabs → FIXE | Socket.IO/Engine.IO sur WebSocket TLS | A | Socket token/OAuth FIXE ; jamais transmis aux clients ; Événement fournisseur vers feed et moments |
| FLOW-16 | FIXE → Spotify Windows | PowerShell contrôle lecteur local | B | Permission du PC ; aucun OAuth Spotify ajouté ; dispatched signifie commande remise, pas lecture confirmée |
| FLOW-17 | Clients → Soundboard FIXE | API actions/soundboard vers runtime et OBS | B | Permission audio ; destinations explicitement configurées ; Reçu et événements de lecture ; stop explicite |
| FLOW-18 | Clients → Mixeur FIXE | API streamcockpit-mixer puis OBS | B | Gestion/permissions + source UUID OBS et état fraîcheur ; Relecture/rollback selon résultat ; incertitude visible |
| FLOW-19 | Événements OBS/Streamlabs/Twitch → Moments FIXE | Producteurs internes + SQLite ; API read-only clients | C | Scopes du producteur ; permission de lecture clients ; Identifiants corrélés, journal et projections |
| FLOW-20 | Clients → Clips simples FIXE | Preview/confirm + OBS ReplayBuffer / Twitch Helix | B | Gestion chat/cloud/clips + scopes Twitch ; UUID à usage unique ; Reçu exact ou uncertain ; lecture du journal sans renvoyer |
| FLOW-21 | OBS/minuteur/santé FIXE → Clients | Snapshots HTTPS ; WS optionnel pour certains anciens clients | C | Observation appairée ; pin de l'identité FIXE ; workspace/révisions/observation de l'horloge maître |
| FLOW-22 | Windows/Android → Mise à jour | Provenance build, artefacts, updater | B | Signature de confiance et installation autorisée séparément ; Validation des octets/signatures, migrations/repli requis |

Le chat de la nouvelle interface se rafraîchit par HTTP ; son rendu ne dépend pas de la diffusion WebSocket de l’état global. Twitch arrive sur FIXE par EventSub, est filtré par broadcaster et dédoublonné par ID avant la réponse REST. Les clients plus anciens peuvent employer le WS à ticket. Aucun mécanisme WS supplémentaire ni deuxième backend n’a été ajouté.

La présence de production-obs-writer.ts prouve une implémentation Agent V2, pas son activation sur l’installation. Le runtime historique FIXE et l’Agent V2 ne doivent jamais devenir deux écrivains simultanés.

Le laptop conserve aussi le chat de son compte Windows local lorsque cette source est nommée : control.js choisit localEndpoint pour la fenêtre Windows, live-monitor.js relaie sa source explicite, et les mêmes modules client/eventsub sont réutilisés dans ce runtime local. Ce compte n’est jamais un deuxième propriétaire OBS/minuteur. Le choix Android est désormais explicite et utilise FIXE par défaut.
