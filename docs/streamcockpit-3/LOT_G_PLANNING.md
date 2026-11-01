# Lot G — Planning assisté F06, incrément isolé

Base : `627dca3`, branche `streamcockpit/3.0-lot-g`. Implémentation sans qualification matérielle. La matrice partagée reste inchangée.

## Fichiers livrés

- `packages/core/src/streamcockpit-planning.ts` : observations, créneaux libres, chevauchements, date Paris, proposition de duplication et confirmation en mémoire.
- `apps/mobile/control/streamcockpit-planning.js` : panneau de revue indépendant, erreurs visibles, annulation, préparation d'un brouillon sans sauvegarde.
- `tests/streamcockpit3-planning.test.ts` : contrats du moteur et de la confirmation.
- `tests/streamcockpit3-planning-ui.test.ts` : contrat DOM du panneau (fixture, pas navigateur réel).
- `docs/streamcockpit-3/LOT_G_PLANNING.md` : ce rapport.

Le ticket `LOT_G_TICKET.md` était déjà présent non suivi au démarrage ; il n'est pas inclus dans le commit.

## Interfaces et fonctionnement

`PlanningObservation[]` exige exactement une observation locale et une Google. Google peut être explicitement `disabled` avec une liste vide ; une panne ne doit jamais être convertie en désactivation. Chaque observation active comporte sa date de lecture, sa couverture et des `CalendarItem` canoniques. L'âge maximal accepté est cinq minutes, les horodatages futurs sont refusés. La couverture doit inclure toute la fenêtre demandée. Aucun accès réseau, stockage ou provider n'est effectué par ce module.

`suggestPlanningSlots(observations, { from, to, durationMinutes, stepMinutes?, limit? }, now)` retourne les premiers créneaux libres selon les seuls événements observés. Fenêtre maximale 31 jours, durée maximale 24 h, pas par défaut 30 minutes, limite par défaut 5 (maximum 100). Les suggestions sont une grille de temps écoulé depuis `from`, sans classement statistique ni restriction implicite aux heures de bureau. Les intervalles sont semi-ouverts : deux événements adjacents ne se chevauchent pas.

`inspectPlanningSlot` retourne les conflits avec provenance et identité d'occurrence. Les événements Google journée entière utilisent leurs dates civiles avec fin exclusive à minuit Paris, y compris les journées de 23/25 heures. Les instants datés exigent un fuseau explicite. `parisInstant` convertit une saisie `YYYY-MM-DDTHH:mm` ; une heure inexistante est refusée, une heure répétée nécessite `earlier` ou `later`.

Le moteur de séquences existant `expandRecurringItems` est appelé directement, comme `planning-model`. Il conserve cadences quotidienne/hebdomadaire/mensuelle, intervalles, until inclusif, clés d'occurrence et exceptions annulées/déplacées. Sa politique canonique DST reste celle de l'existant : première occurrence lors d'un repli, décalage vers l'avant dans un trou. Les saisies manuelles ont la politique stricte décrite ci-dessus.

`proposeSessionDuplicate(observations, { source, id, occurrenceKey? }, slot, now)` capture un aperçu indépendant des entrées. Pour un maître récurrent, une occurrence précise dans une observation de 31 jours maximum doit être choisie. La duplication porte uniquement sur cette session, jamais la série entière. `cancel()` est terminal. `confirm(latestObservations, now)` revérifie fraîcheur, couverture, conflit, date future et contenu des observations ; un changement impose une nouvelle proposition (seul le rafraîchissement de `observedAt` est permis). Une confirmation unique produit un `CalendarItem` brouillon avec UUID sécurisé, propriété locale, aucun lien externe, aucune récurrence, publication Google/Twitch désactivée. La fonction ne sauvegarde rien et ne réserve pas le créneau.

`mountPlanningProposal(root, { proposal, readLatest, now? })` monte un panneau séparé, affiche les dates Paris et expose `confirm()`, `cancel()`, `getDraft()` et `destroy()`. `readLatest` doit être une relecture sans écriture. Le texte utilisateur distingue explicitement brouillon préparé, enregistré et publié. La destruction/annulation pendant une lecture ignore son résultat tardif. Le panneau utilise `textContent` pour les titres et erreurs.

## Branchements requis par l'intégrateur

1. Sur la régie maîtresse FIXE, fournir des observations complètes depuis le planning local et le cache Google existant, sans filtrage UI qui masquerait des événements occupés. Utiliser les dates de lecture réelles, les bornes réellement couvertes et les erreurs du provider. Convertir les données Google via le modèle canonique existant, jamais en interprétant des RRULEs brutes ici. Préserver les exceptions/occurrences annulées. Ne pas traiter une page partielle comme une couverture complète.
2. Importer/bundler le module core dans le parcours Planning, proposer les créneaux et monter le panneau avec la session/occurrence choisie. Aucun entrypoint, `planning.js`, module Google ou script de build n'a été modifié.
3. Après revue, récupérer `getDraft()` et passer par la création locale autorisée existante, avec vérification atomique de disponibilité et unicité d'ID au moment de la sauvegarde sur FIXE. Le brouillon préparé n'est pas une preuve de persistance ; deux propositions indépendantes peuvent viser le même créneau.
4. La publication Google/Twitch nécessite une autre intention explicite, les permissions et le circuit existant de confirmation/relecture. Aucun appel à `PlanningOrchestrator.create`, OBS ou Twitch n'est fait ici. Aucun fallback d'autorité vers laptop/Android.

## Limites

- Pas de validation matérielle FIXE/laptop/Android, pas de test navigateur réel, pas de qualification F06.
- Récurrences personnalisées et récurrences journée entière : refus explicite, pas de disponibilité inventée. Les séries classiques datées sont prises en charge par le moteur canonique.
- Les observations conflictuelles, invalides ou avec suppression en attente bloquent le calcul. Pas de résolution automatique de conflit.
- Pas de copie d'une série entière ni de réécriture de ses exceptions ; la duplication est celle d'une occurrence/session.
- Pas de réservation, verrou distribué, persistance, publication, préflight OBS ou score de recommandation historique. La comparaison conservatrice des observations peut exiger une nouvelle revue après un simple réordonnancement des items.
- Les observations constituent une frontière de confiance : l'adaptateur doit déclarer honnêtement couverture, fraîcheur et complétude.

## Vérifications

Les deux premiers lancements Vitest avec la configuration du dépôt ont échoué avant les tests : `EROFS` sur `node_modules/.vite-temp` (dépendances partagées en lecture seule). Relance avec configuration native et cache `/tmp`, sans modification des dépendances partagées.


- `./node_modules/.bin/vitest run tests/streamcockpit3-planning.test.ts tests/streamcockpit3-planning-ui.test.ts tests/recurrence.test.ts --maxWorkers=1 --config /tmp/streamcockpit3-lot-g-vitest.mjs --configLoader native` : **33 tests PASS, 3 fichiers**, dernière exécution 2026-11-01 (659 ms après cache).
- `./node_modules/.bin/tsc -p tsconfig.json --noEmit` : **PASS**, sans génération de fichiers.
- `node --check apps/mobile/control/streamcockpit-planning.js` : **PASS**.
- `git diff --cached --check` : **PASS** avant commit.

Configuration temporaire reproductible (hors dépôt) :

```js
export default {
  cacheDir: '/tmp/streamcockpit3-lot-g-vite-cache',
  test: { include: ['tests/**/*.test.ts'], exclude: ['node_modules/**', 'dist/**'], maxWorkers: 1 }
};
```

Aucun build Windows/Android, aucune donnée utilisateur modifiée, aucun appel réel OBS/Twitch/Google, aucun push ou déploiement.
