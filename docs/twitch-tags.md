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
