# Décisions

- **Local-first** : un échec distant ne revient jamais sur le CRUD local.
- **Publications indépendantes** : aucune compensation ne supprime le fournisseur déjà réussi.
- **Soft delete** : conservation de l'audit et retry possible.
- **Conflits permissifs** : avertissement, hash du créneau et de la liste, confirmation renouvelée après changement.
- **Twitch at-most-once** : réconciliation avant toute répétition d'un POST ambigu.
- **Google déterministe** : ID dérivé de l'UUID et propriété privée `damplannerEventId`.
- **Vie privée** : une description PERSONAL n'entre jamais dans le payload Twitch ; seul le titre public dédié y entre.
