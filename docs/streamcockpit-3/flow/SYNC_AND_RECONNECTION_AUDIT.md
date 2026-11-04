# Synchronisation et reconnexion

Les contrats existants sont conservés : workspace maître, ressources avec base de comparaison, identifiant edit et journal applied/conflict/uncertain ; pin TLS et identité d’installation ; client-authorityEndpoint refuse une régie ambiguë ou disparue ; projection du minuteur dérivée du timerObservedAt maître avec expiration de 15 s. Les snapshots autonomy utilisent private, no-store.

Le code de la nouvelle UI effectue un polling HTTP 2500 ms ; l’affichage du compteur à 250 ms n’est pas une horloge autonome. Le chat a son polling séparé et ne dépend pas de la réussite du rafraîchissement OBS/configuration. Le WS à ticket à usage unique reste présent pour d’autres clients.

Séquence au retour : invalider observations, vérifier la source/pin/compte, charger le snapshot, réconcilier les éditions par id/base, signaler les conflits et conserver les reçus incertains. Le lot ajoute les barrières manquantes au composant chat sur visibilité/online/offline/pagehide/pageshow. Un GET tardif pré-veille ne peut réactiver l’envoi. Aucune commande critique ne rejoint une outbox de retry.

| Rupture | Comportement logiciel observé | Preuve physique du code courant |
|---|---|---|
| FIXE indisponible | Commandes maître bloquées, aucune bascule vers compte Android | NON TESTÉ |
| OBS coupé | Autorité/état inconnu selon transport ; commandes refusées | NON TESTÉ |
| OAuth expiré / scopes manquants | UI suspendue ou permissions explicites ; refresh fournisseur existant | NON TESTÉ |
| Wi-Fi coupé / online | Chat invalidé et nouvelle lecture requise ; aucun POST rejoué | NON TESTÉ |
| Veille / retour | Génération de lecture invalidée, ancien résultat ignoré | Simulation Edge PASS ; Android NON TESTÉ |
| Deux clients | Journal/idempotence et conflits existants ; un maître | Tests existants à requalifier ; trio NON TESTÉ |
| Redémarrage Agent | Reçus/époque persistés selon sous-système ; inconnu conservé | Ancienne QA a38305f seulement, pas ce commit |

Limites : les 200 messages de chat ne forment pas un historique durable et Twitch ne rejoue pas nécessairement les événements manqués. Le journal d’éditions de configuration (AtomicJsonStore) est distinct des reçus d’exécution OBS/Twitch SQLite ; ne pas attribuer à tous les flux les mêmes garanties de persistance. Aucune panne secteur réelle n’a été provoquée.
