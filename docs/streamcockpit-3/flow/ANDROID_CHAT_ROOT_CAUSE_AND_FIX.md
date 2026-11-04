# Chat Android : cause reproduite et correction

Le défaut de routage est reproduit dans un vrai Edge à 320 px, avec un pont Android et un fournisseur simulés. Ce n’est pas une capture du téléphone de Dam : le lien exact avec son installation sera confirmé en réception.

Avant : native=true imposait nativeRequest, donc une session Twitch Android distincte même avec FIXE associé. Après : le chat utilise le compte de la régie sélectionnée par défaut. Une liste Source du chat Twitch permet de choisir explicitement le compte Android existant. Une coupure FIXE ne change jamais l’expéditeur. Changer de source efface le brouillon et les anciens messages ; les outils de régie conservent leur identité FIXE.

Autres corrections : modération à 320 px selon permissions, capacités rechargées au changement de compte, invalidation des lectures antérieures à la veille et reprise GET-only, refus d’un reçu failed/uncertain même avec messageId. Le brouillon et le résultat incertain sont conservés ; aucun retry automatique.

## Comparaison isolée

| Critère | Relais FIXE retenu par défaut | Compte Android direct existant |
|---|---|---|
| Compte | Compte FIXE authentifié, aucune nouvelle connexion Android | OAuth Android propre, aucun jeton Windows copié |
| Transport | EventSub sur FIXE puis HTTPS appairé | IRC TLS natif + Helix pour envoyer |
| Disponibilité FIXE éteint | Indisponible, état honnête | Autonome après sélection et connexion explicites |
| Scopes | user:read:chat et user:write:chat sur FIXE | chat:read pour IRC, user:write:chat pour Helix |
| Envoi isolé | Un seul appel host, aucun appel natif | Un seul appel natif, aucun POST host |
| Déconnexion | Aucun basculement d’identité, aucun rejeu | Reconnexion native existante, hors réception physique |
| Latence Wi-Fi / batterie / réseau réel | NON MESURÉS | NON MESURÉS |
| Déploiement | Réutilise API et appairage existants | Réutilise le pont existant ; pas de second backend créé |

Le bénéfice matériel d’une bascule générale vers la connexion directe n’est pas démontré. Le relais est donc conservé pour 3.0 ; l’autonomie existante reste une option explicitement choisie. Twitch documente séparément les scopes IRC et EventSub : https://dev.twitch.tv/docs/chat/irc/ et https://dev.twitch.tv/docs/chat/authenticating/ (consultés le 04/11/2026). L’audit n’a pas trouvé de mauvais scope IRC dans ProviderBridge : chat:read était déjà demandé ; ne pas attribuer ce faux diagnostic à la panne.

Preuve RED finale : cinq scénarios en échec sur le code initial après correction du harnais de test. GREEN ciblé : 44 PASS / 0 FAIL / 0 skipped sur cinq suites. Les premiers échecs de harnais (import.meta.url et assertions) ne sont pas des preuves produit. Résultats de qualification générale dans evidence/qualification.json. Chat physique, véritable envoi, modération publique, clavier Android et Wi-Fi/veille réels restent NON TESTÉS.
