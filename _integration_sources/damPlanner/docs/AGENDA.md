# Agenda et Daily Hub

## Modèle unifié

`PlannerEvent` reste la source de vérité locale et le seul type modifiable. `CalendarItem`
réunit, uniquement pour la présentation, les événements locaux, les occurrences Google et
les segments Twitch. Un élément Google/Twitch externe a `ownership: EXTERNAL` et
`editable: false`; il n'est ni copié, ni modifié, ni supprimé.

La déduplication utilise d'abord `extendedProperties.private.damplannerEventId`, puis
l'identifiant de publication enregistré (`calendarId|eventId` pour Google). Aucun
rapprochement n'est fait sur le titre seul. Google est interrogé avec `singleEvents=true` :
les récurrences sont donc des occurrences, et `end.date` reste exclusif pour le all-day.

## Adoption

« Gérer dans DamPlanner » demande confirmation, crée le `PlannerEvent`, puis attache la
publication à l'identifiant Google existant. Cette opération ne déclenche aucune création
Google. Après adoption seulement, les mises à jour locales peuvent mettre à jour Google.

## Cache et mode hors connexion

Le hub partage un cache mémoire de cinq minutes entre Aujourd'hui, Planning et Agenda.
Une actualisation manuelle l'invalide. Si les fournisseurs sont indisponibles, les données
locales restent disponibles et le dernier cache distant est affiché comme périmé. Le cache
n'est jamais utilisé comme source de vérité lors d'une modification.

## Brouillons, modèles et préparation

Un brouillon conserve les intentions Google/Twitch mais ne publie rien avant l'action de
publication. Les modèles sont conservés dans la table SQLite additive `event_templates`.
Les champs de buffer et checklist sont stockés dans le JSON versionné de l'événement afin
de préserver les anciennes lignes. Les buffers sont des avertissements, pas des conflits.

## Récurrence

Le domaine sait développer une récurrence journalière ou hebdomadaire dans le fuseau de
l'événement (donc sans dérive lors d'un changement DST). Google doit recevoir une vraie
règle lorsque la publication distante de séries sera activée. Twitch ne signale jamais une
récurrence comme synchronisée : son API et ses contraintes doivent être traitées occurrence
par occurrence.

## Sécurité

Les appels passent par le preload et chaque payload IPC est validé par Zod. Les événements
externes ne transportent aucun jeton. OAuth demeure dans le main process et les jetons sont
uniquement dans `safeStorage`.

## Live Cockpit

Un LIVE peut ouvrir un Cockpit persistant avec routine par phases, progression, actions
locales sécurisées et lifecycle prévu/réel. Voir [LIVE_COCKPIT.md](LIVE_COCKPIT.md),
[ROUTINES.md](ROUTINES.md) et [LOCAL_ACTIONS.md](LOCAL_ACTIONS.md).
