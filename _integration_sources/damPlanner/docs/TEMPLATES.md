# Templates enrichis

Les templates mémorisent durée, providers souhaités, catégorie/titre Twitch, description,
buffers, routine, tags, participants, rappel et couleur. Les placeholders autorisés sont
`{date}`, `{day}`, `{game}`, `{participants}`; les autres restent littéraux et aucun langage
de script n'est évalué. Une duplication repart sans publication, conflit accepté ni case
cochée.

## Gestion dans Réglages

L’éditeur permet de gérer explicitement nom, type, durée, description, intentions Google et
Twitch, titre/catégorie Twitch, buffers, routine, tags, participants, rappel et couleur. Une
suppression de routine met à `null` les références des templates concernés sans modifier les
événements existants. Création, modification et duplication ne servent que de valeurs par
défaut pour les futurs événements.
