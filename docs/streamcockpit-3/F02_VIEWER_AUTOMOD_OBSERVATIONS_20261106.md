# F02 — Historique AutoMod observé par viewer (06/11/2026)

## Mission et préflight
- Machine FIXE Windows 11 via Remote Desktop Commander uniquement, branche `streamcockpit/3.0-full-experience`, origin `Rastaaslan/StreamDashboard`.
- Sources d'autorité relues avant mutation : PLAN, feature-matrix, CONTINUITY, MIGRATION_TO_FIXE et audit final.
- HEAD initial `e63062e` synchronisé ; aucun lock/merge/rebase ; modifications F05/mixeur et `CONTINUITY.md` préexistantes, préservées hors index. OBS et EXE QA utilisateur non manipulés ; aucune commande OBS/Twitch publique, aucune installation/release, aucun accès aux autres machines/projets/secrets.

## Défaut fonctionnel et intégration
Auparavant, l'interface de modération montrait seulement les messages retenus actuellement observés sur la connexion EventSub FIXE. Dès la notification `automod.message.update`, un message disparaissait sans historique local consultable pour son viewer. La consultation de l'activité AutoMod n'était donc pas réalisable depuis le cockpit.

- **Données et périmètre** : `ObservedAutoModQueue` retient maintenant au plus **100 événements par message**, en mémoire uniquement, pendant **15 minutes** (purge en cas de recul d'horloge) ; chaque entrée ne contient que l'identifiant Twitch du viewer, le statut `held/approved/denied/expired` et l'horodatage de réception. **Aucun texte de chat, aucun OAuth, aucun historique Twitch global** dans cet historique. Les données sont détruites à la perte d'EventSub ou au changement de broadcaster.
- **Route** : GET `/api/v1/twitch/advanced/moderation/viewer/:userId` sur l'unique maître FIXE, reconnue dans la politique remote uniquement pour un ID Twitch numérique, permissions appairées `chat+cloud`, acteur/rôle et hôte revalidés **avant et après** la lecture. Refus 401/403/409/405/400 sans fuite de message, cache `private, no-store`. Aucun POST ni fournisseur appelé.
- **Interface Desktop/Android partagée** : bouton volontaire « Voir l’activité AutoMod observée » sur une retenue d'un viewer valide ; lecture GET explicite, affichage échappé des seuls statuts et dates, indication visible de la couverture **partielle**, aucune extrapolation en « historique complet Twitch ». Nettoyage des observations et rejet des réponses tardives après rafraîchissement, déconnexion ou changement de source. Aucun affichage automatique au montage.

## Preuves logicielles
- Test RED ajouté avant implémentation : **7 PASS / 1 FAIL / 0 skipped** (`viewerHistory` absent).
- Test final combiné de six suites F02 : **29 PASS / 0 FAIL / 0 skipped**, avec **4 scénarios Microsoft Edge 320 px réels**, notamment affichage volontaire, sortie offline et invalidation d'une réponse en vol après un rafraîchissement. Twitch/EventSub simulés ; appairage HTTP loopback réel et garde d'autorité vérifiés.
- TypeScript `build:types`, types navigateur `check:browser-types`, `security:check` (**6 775 fichiers**) et `git diff --check` : PASS avant documentation, avertissements CRLF sans faute.
- Pas de campagne générale ni packaging distribuable pour éviter le conflit avec le chantier F05 et les installations de QA actives.

## Qualification non acquise et prochaine priorité
**F02 partial, G2 in_progress, G3/G4/G5 open.** Cette fonctionnalité observe uniquement les événements reçus depuis la connexion ; elle **ne** valide pas le véritable historique Twitch d'un viewer ni les décisions AutoMod à distance. Contrôles OAuth sur compte réel, actions manuelles sur retenues, tests physiques FIXE/laptop/Android, signatures et rollback encore requis. Suite prioritaire : workflow à consentement unique des décisions AutoMod retenues, avec vérification des scopes, effets incertains non réémis et réception G3 distincte. F05, F09 et F10 restent des blocages de convergence G2.
