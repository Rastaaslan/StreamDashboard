# Live Cockpit

Le Cockpit accompagne un LIVE sans remplacer OBS. Son statut opérationnel est indépendant
du brouillon et utilise les états internes `PLANNED`, `PREPARING`, `READY`, `LIVE`,
`FINISHED`, `CANCELLED`, présentés en français dans une bannière dédiée.

## Workflow visible

Une seule action principale est proposée à la fois : **Préparer le live**, **Marquer prêt**,
**Je suis en live**, puis **Terminer le live**. Chaque transition affiche une confirmation
visible et désactive son bouton pendant l'écriture. Le premier passage à `LIVE` enregistre
`actualStartAt` une seule fois.

## Clôture explicite

**Terminer le live** ne change pas l'état. Si des tâches `AFTER` restent à faire, le Cockpit
propose d'y revenir ou de clôturer maintenant. Un dialogue accessible propose une fin réelle,
l'humeur et une note contrôlée. Seule l'action **Valider et clôturer le live** appelle
`CockpitService.completeLive`, qui valide que la fin suit le début puis sauvegarde en une
écriture `actualEndAt`, humeur, note et `FINISHED`.

Les horaires planifiés `startAtUtc` / `endAtUtc` sont conservés. La clôture n'appelle ni le
service de synchronisation, ni Google, ni Twitch : leurs créneaux prévus ne sont jamais
ajustés à la durée réelle.

## Historique et notes

Un live terminé reste au créneau prévu dans Today, Planning et Agenda, avec sa durée réelle.
Sa note et son humeur peuvent être corrigées via **Enregistrer les notes** ; cette opération
ne modifie jamais `actualStartAt` ou `actualEndAt`.
