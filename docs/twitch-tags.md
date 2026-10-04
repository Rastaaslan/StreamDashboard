# Moteur local de tags Twitch

API partagée : `packages/core/src/twitch-tags.ts`. Aucune dépendance réseau, IA,
clé, scope ou saisie obligatoire. Le moteur ne publie rien et ne modifie aucun état.

```ts
import { generateTwitchTags } from './packages/core/src/twitch-tags.js';

const tags = generateTwitchTags({
  category: 'Minecraft',
  title: 'Découverte en co-op',
  description: 'Un défi en détente',
  language: 'fr',
});
// ['Minecraft', 'French', 'Coop', 'FirstPlaythrough', 'Challenge', 'Chill']
```

Tous les champs sont facultatifs. `generateTwitchTags()` retourne `['Live']`.
`game` complète la catégorie ; `context` accepte des textes supplémentaires.
`preferredTags` et `defaultTags` constituent des signaux facultatifs.
Le champ `twitch` accepte directement les champs `title` et `gameName` des
métadonnées déjà obtenues par le client existant, plus `tags` et `language` si
l'appelant en dispose. Aucun chargement supplémentaire n'est effectué. Les champs
explicites `category`, `title`, `language` remplacent les valeurs Twitch, même vides.

Ordre stable : catégorie/jeu, langue explicite connue, thèmes locaux FR/EN dans
l'ordre des règles, tags Twitch disponibles, préférences, tags par défaut.
Les thèmes sont détectés par mots/expressions complets, séparément dans chaque
champ. Le texte libre inconnu n'est pas transformé en tags ; la langue n'est pas
déduite du texte. Les règles sont des heuristiques simples, sans analyse de négation
ni classification exhaustive des jeux. L'appelant doit fournir des signaux Twitch
pertinents pour le live courant, plutôt que des tags anciens sans rapport.

Normalisation NFKD, retrait des accents et caractères autres que lettres/chiffres
Unicode, rejet des valeurs vides ou dépassant 25 points de code (sans troncature).
Déduplication insensible à la casse, première graphie conservée, maximum 10 tags.
`normalizeTwitchTag` et `isValidTwitchTag` sont également exportées. La validation
porte sur le format ; elle ne prédit pas la modération Twitch.

Vérification : `npx vitest run tests/twitch-tags.test.ts` et `npm run build`.

## Intelligence v2 (CB-107)

Le serveur utilise désormais `TwitchTagIntelligence` dans
`packages/core/src/tag-intelligence.ts`. L’API pure CB-100 ci-dessus et l’adaptateur
`localTagEngine` restent compatibles. `resolveTags` conserve les tags enregistrés
et les overrides manuels avant toute génération ; seule une régénération explicite
les remplace dans le formulaire, avant enregistrement par l’utilisateur.

### Twitch et latence

Une observation appelle exclusivement Helix `GET /streams?game_id=…&first=100`,
avec le jeton et le Client-Id existants. Aucun scope supplémentaire, catalogue de
tags, pagination ou retry d’authentification sur ce chemin facultatif. Une session
expirée utilise le fallback ; le cycle habituel du client renouvelle la session.

Le cache runtime par jeu dure six heures, y compris pour une liste vide. Il garde
au maximum 200 jeux. Les appels concurrents pour un jeu partagent une promesse.
Un cache frais ne déclenche aucun appel ; un cache absent/périmé déclenche un
refresh en arrière-plan et renvoie immédiatement les suggestions locales ou les
observations précédentes. Les erreurs conservent le cache précédent et imposent
60 secondes avant un nouvel essai automatique. Une course avec timeout de 800 ms
borne même un transport ignorant AbortSignal ; les réponses tardives sont ignorées.

`POST /api/v1/planning/tags/regenerate` accepte `refreshTwitch: true` pour attendre
au plus ce court refresh. Le bouton Régénérer utilise cette option. Sans cette
option, ni le formulaire ni la génération du preflight n’attendent le réseau
Twitch d’observation. Les autres opérations réseau du preflight sont inchangées.
`invalidate(gameId)` supprime le cache et le délai de retry ; un redémarrage vide
le cache runtime. Ce choix évite un nouveau fichier de stockage et toute infra.

### Scores explicables

`scoreTags` expose `{ tag, score, sources }` pour diagnostic, sans modifier la
réponse historique `{ tags, warning? }` ni ajouter de bruit à l’interface.

- Préférences chaîne : 10 ; règles titre/description/langue : 20 ; série : 30.
- Observations Twitch : 45 + 15 × poids cumulé / nombre de streams.
- Historique du même game_id : 65 ; catégorie et règles de catégorie : 75.
- Chaque stream compte une fois par tag normalisé. Son poids est 1, augmenté
  d’au plus 0,25 pour l’audience logarithmique, 0,15 / rang et 0,25 pour la langue
  explicitement préférée (par exemple FR). Deux streams pèsent plus qu’une star.
- Le score final retient le signal le plus fort et conserve toutes les provenances.
  Spooktober/Halloween dans le titre ou la description ajoute Halloween (35) et
  renforce Horror (62). Aucun raisonnement sur le mois : Halloween/Spooktober
  observés ou appris sont exclus des suggestions hors de ce contexte explicite.

Normalisation, déduplication, validité Unicode et limite de dix restent appliquées.
Les tags manuels conservés par `resolveTags` ont priorité sur tout score.

### Apprentissage et préférences

Les tags enregistrés dans le planning persistant sont les exemples validés :
corrections manuelles et suggestions que l’utilisateur a choisi d’enregistrer.
La génération et le preflight n’écrivent jamais dans cet historique. Les futurs
lives du même game_id en bénéficient, ainsi que les occurrences identifiées par
seriesId (ou l’id de leur série récurrente). On ne devine pas les formats depuis
un titre : une série est l’identifiant fiable disponible aujourd’hui.

Les patches d’exception ne sont jamais parcourus pour apprendre, et les objets
portant occurrenceKey sont exclus. Pour généraliser un choix spécial, modifier
explicitement les tags de la série avec le flux existant « modifier la série ».
Une modification remplace l’exemple ; supprimer l’événement retire son influence.
Compromis : pas de journal d’apprentissage indépendant conservant les événements
supprimés, et le premier accès après redémarrage utilise le fallback local.

L’API de paramètres existante accepte `tagPreferences: { preferredTags, language }`
pour la chaîne. Les préférences d’événement complètent les tags préférés et leur
langue explicite prime sur celle de la chaîne. Ces champs sont facultatifs et
persistants ; aucun nouveau réglage obligatoire n’est ajouté à l’UI.

### Vérifications

Les fixtures de `tests/tag-intelligence.test.ts` couvrent Dead Island 2 +
Spooktober, fréquence/audience/rang/langue, normalisation, TTL, single-flight,
invalidations, timeouts, erreurs et jeux sans stream. `tests/tags-integration.test.ts`
vérifie l’API réelle, l’apprentissage après redémarrage, l’isolation des exceptions,
les tags manuels et le preflight. Un transport bloqué est utilisé pour vérifier
une réponse normale sous 500 ms et un refresh explicite sous 1300 ms ; les tests
unitaires à horloge simulée fixent le timeout exactement à 800 ms.
