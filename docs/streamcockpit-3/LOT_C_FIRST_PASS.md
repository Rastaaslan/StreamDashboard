# Lot C — Première passe F03 / F07

Base : `79c7de3951d0590fa0977fc16ff9b2a2e964e186`.
Branche : `streamcockpit/3.0-lot-c`. Propriétaire exclusif des nouveaux modules : Lot C.

Implémentation isolée de sélection de **présentations**, sans exécution de macro,
commande OBS/Twitch, minuteur, réseau, stockage ou abonnement à des événements.
F03/F07 restent partiels, non qualifiés. Aucun gate global n'est déclaré acquis.
F05/F06 ne sont pas traités par cette passe.

## Fichiers réellement créés

- `packages/core/src/streamcockpit-context.ts` : types, validateurs et sélecteur pur.
- `apps/mobile/control/streamcockpit-context-renderer.js` : HTML échappé et remplacement du contenu d'un conteneur fourni.
- `apps/mobile/control/streamcockpit-context-renderer.d.ts` : contrat TypeScript du rendu mobile.
- `tests/streamcockpit3-context.test.ts` : 37 cas ciblés.
- `docs/streamcockpit-3/LOT_C_FIRST_PASS.md` : ce compte rendu et contrat de branchement.

Le ticket `LOT_C_TICKET.md`, présent avant la passe et non suivi, est laissé inchangé
et hors du commit. Aucun fichier existant, point d'entrée ou matrice partagée modifié.

## Contrats et choix déterministes

`parseContextConfig(unknown)` et `parseContextSnapshot(unknown)` valident les données
et renvoient une copie. `selectContextPresentation(config, snapshot)` valide à chaque
appel. Une entrée invalide lève `TypeError` ; elle n'est pas silencieusement transformée
en permission ou configuration de repli. Les entrées doivent provenir de données JSON,
pas d'objets exécutables ou de proxies JavaScript.

Configuration v1, plateforme littérale `twitch` : actions `{id,label,roles,capabilities}`,
banques `{id,label,actionIds}`, règles `{id,priority,bankId,when}` et `fallbackBankId`.
Aucun champ supplémentaire admis à ces niveaux. IDs uniques par collection,
références obligatoirement résolues, priorités entières sûres, chaînes non vides
(maximum 256 caractères), listes limitées à 512 éléments. Pas de champ commande,
script, expression, template exécutable ou payload. Les identifiants de capacités
sont des chaînes opaques ; ils ne créent aucune intégration plateforme.

Snapshot complet obligatoire : `scene`, `game`, `streamState`, `role`, `capabilities`,
`network`. `null` signifie inconnu/absent ; l'intégrateur doit convertir les absences
amont en `null`, sans inventer un jeu ou un état. États : `offline`, `starting`, `live`,
`stopping`, ou `null`. Rôles : `stream-pc`, `gaming-pc`, `android`, ou `null`.
Réseau : `online`, `offline`, `unknown` ; il désigne la liaison avec l'Agent maître.

Les prédicats de règle sont combinés par ET, égalité exacte sensible à la casse.
Un prédicat omis est libre ; un `null` explicite correspond uniquement à l'inconnu.
Les capacités de règle doivent toutes être présentes ; un ensemble inconnu ne satisfait
même pas une liste vide explicite. Un `when: {}` correspond toujours.
Les règles sont triées par priorité décroissante, puis ID croissant selon l'ordre des
chaînes JavaScript (sans dépendance à la locale). La première choisit une seule banque.
`matchedRuleIds` expose tous les candidats ordonnés pour expliquer les conflits.
Aucun match donne la banque de repli. Une banque vide après filtrage reste vide :
aucune substitution implicite vers une autre banque potentiellement privilégiée.

Quand le réseau est déconnecté ou inconnu, scène, jeu, état de stream et capacités
sont invalidés pour la sélection, même si le snapshot contient d'anciennes valeurs.
Des règles explicitement fondées sur l'inconnu ou le rôle peuvent encore correspondre.
Toutes les actions visibles deviennent indisponibles. Le rôle local est conservé.
Un rôle inconnu masque toutes les actions. Les actions hors rôle sont supprimées ;
les capacités absentes/inconnues désactivent la présentation avec un motif explicite.
L'ordre des actions suit celui de la banque. Aucun état précédent n'est conservé.

## Branchement réservé à l'intégrateur

1. Importer directement le module core (pas de modification d'un barrel partagé).
2. Traduire un snapshot fiable de l'Agent maître vers le contrat ci-dessus. Fournir
   les capacités vérifiées et le rôle résolu, jamais une affirmation du client utilisée
   comme autorisation. La fraîcheur et la provenance sont à établir en amont ; une
   donnée périmée doit devenir `null`, une liaison perdue `offline`/`unknown`.
3. Recalculer sur chaque changement de scène, catégorie Twitch/jeu, état, rôle,
   capacités et liaison, y compris reconnexion. Ne pas réutiliser un snapshot périmé.
4. Importer l'adaptateur ES module mobile ; appeler
   `mountContextPresentation(container, presentation)` avec un conteneur dédié.
   Le rendu remplace les cartes précédentes. `renderContextPresentation` est aussi
   disponible pour composer un rendu. Les libellés sont échappés, aucun attribut
   de routage d'action, bouton exécutable ou gestionnaire d'événement n'est généré.
5. En cas d'erreur de validation, retirer l'ancienne présentation et afficher une
   erreur d'intégration ; le module ne possède pas de UI globale d'erreur.
6. Toute future activation utilisateur doit passer séparément par la régie maître,
   identité, capacités, préconditions, confirmations, idempotence et journal.
   `available` est un indicateur de présentation, **jamais une autorisation**.

Les noms de capacités des tests (`twitch:marker`, `obs:scene`) sont des fixtures de
contrat et doivent être traduits vers le vocabulaire vérifié de l'Agent à l'intégration.
Le module n'enregistre pas de route serveur et n'est pas encore chargé par l'UI.

## Vérifications exécutées

Depuis ce worktree uniquement :

```sh
./node_modules/.bin/vitest run tests/streamcockpit3-context.test.ts --maxWorkers=1
```

Échec avant collecte : `EROFS` lors de la création du cache `.vite-temp` dans les
dépendances partagées en lecture seule. Aucun test exécuté par cette tentative.

```sh
./node_modules/.bin/vitest run tests/streamcockpit3-context.test.ts --maxWorkers=1 --configLoader runner --cache=false
```

Succès : **1 fichier, 37 tests passés**. Changement de scène, jeu absent, état inconnu,
perte réseau/reprise, règles concurrentes, rôles et capacités, validation stricte,
absence de mutation, remplacement du rendu et échappement HTML. Tests de rendu
sur chaîne/conteneur minimal, sans navigateur ni appareil réel.

```sh
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext packages/core/src/streamcockpit-context.ts apps/mobile/control/streamcockpit-context-renderer.d.ts tests/streamcockpit3-context.test.ts
```

Succès : code de sortie 0, aucun diagnostic. Vérification limitée aux nouveaux contrats
et tests ; aucun build Windows/Android ou build global.

## Limites et preuves restant à obtenir

Pas d'intégration serveur/mobile, de test tactile ou d'accessibilité sur navigateur,
de parcours FIXE/laptop/Android, de connexion OBS/Twitch réelle, d'exécution ou de
journal de macro, ni de preuve de fraîcheur de l'état amont. Le rendu est une liste
sémantique réutilisable ; son habillage et son placement restent à intégrer.
Les déconnexions testées sont des transitions synthétiques de snapshot.
Cette passe fournit une base de revue pour G1, pas une livraison finale ni une
qualification F03/F07. G2 à G5 et la matrice restent à la charge de l'intégration.
