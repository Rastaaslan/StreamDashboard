# Routines

Une routine ordonnée contient des phases `BEFORE`, `DURING`, `AFTER` et les types `CHECK`,
`OPEN_APP`, `OPEN_URL`, `OPEN_FILE`, `LOCAL_HTTP`, `SEPARATOR`, `TEXT`. Les routines sont
des modèles SQLite; l'attachement crée une instance indépendante dans le JSON du LIVE.
La réinitialisation ne touche qu'aux valeurs `done` de cette instance.

## Éditeur

Réglages propose un CRUD par formulaires : nom, phases, type et libellé de chaque étape,
cible d’action, ajout, duplication, suppression et ordre accessible avec les boutons haut/bas.
Les changements restent locaux à l’éditeur jusqu’à **Enregistrer la routine**. Fermer un
éditeur modifié demande confirmation. Dupliquer régénère les UUID de la routine et de toutes
ses étapes.

Les chemins OPEN_APP/OPEN_FILE ne traversent jamais le renderer : `actions:create-local`
ouvre le dialogue natif et persiste la cible côté main, puis retourne uniquement son UUID et
son nom. Modifier une routine ne touche jamais aux copies `routineSteps` déjà attachées aux
événements.
