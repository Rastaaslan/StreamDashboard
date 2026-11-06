# F02 — Péremption des observations AutoMod (06/11/2026)

## Périmètre et propriété
- Développement exclusivement sur FIXE Windows 11 via Remote Desktop Commander, dépôt `StreamCockpit-3.0-FullExperience` et branche canonique.
- Préflight PLAN / feature-matrix / CONTINUITY / MIGRATION relu ; base HEAD `9620b29`, origin synchronisé lors du contrôle, aucune opération Git inachevée détectée.
- Fichiers du mixeur F05 et `CONTINUITY.md` déjà modifiés par un autre propriétaire : laissés intacts, jamais stagés.
- OBS/StreamDashboard utilisateur observés uniquement ; aucune action sur eux, aucun POST Twitch réel, aucune installation ni publication.

## Défaut reproduit et correction
Un `automod.message.hold` observé par FIXE pouvait rester indéfiniment dans la liste après une approbation, un refus ou une expiration non reçus via EventSub. Ce cache partiel n'est pas la file Twitch autoritative. Une régression avec horloge injectée a reproduit le défaut : **6 PASS / 1 FAIL / 0 skipped**.

Le cache F02 horodate maintenant la réception locale de chaque observation. Une lecture manuelle retire de sa mémoire les entrées âgées de 15 minutes ou dont l'horloge a reculé. Une nouvelle notification valide redevient visible. Le statut reste `partial-observation`, jamais `complete` ou une preuve d'absence de messages Twitch. Aucun changement d'état de modération et aucune requête Twitch ne sont produits par cette opération.

## Qualification de ce sous-lot
- Trois suites ciblées `streamcockpit3-automod-observation{,-http,-browser}.test.ts` : **12 PASS / 0 FAIL / 0 skipped**, dont **1 scénario Microsoft Edge réel 320 px**, avec EventSub et fournisseur simulés.
- `npm run build:types` : PASS.
- `npm run check:browser-types` : PASS.
- `npm run security:check` : PASS (**6 775 fichiers** au moment du contrôle).
- `git diff --check` : PASS, avertissements de conversion CRLF non bloquants.
- Revue du diff limitée au cache F02, à la régression et à la présente preuve. Aucun build de distribution ni suite générale : les tests ont porté sur un checkout partagé avec modifications concurrentes F05 non attribuées au lot.

## Limites et suite
La fenêtre de 15 minutes ne prouve **pas** qu'un message AutoMod est encore en attente ; elle limite seulement l'âge de son observation. Une mise à jour manquante peut toujours laisser un faux positif durant cette fenêtre ; consulter Twitch pour la décision réelle. Aucun compte OAuth public, réception Android/laptop, migration, signature ou rollback qualifié. **F02 partial, G2 in_progress, G3–G5 open**.

Priorité de convergence : fermer les manques F02 (gestion réelle des messages retenus, historique viewer et scopes) sans fausse file complète ; achever les écarts bloquants des autres F00–F10 ; ensuite réception G3, artefacts de production/signatures/rollback G4 et accord opérateur G5. ClipForge avancé est hors périmètre 3.0 (V4).
