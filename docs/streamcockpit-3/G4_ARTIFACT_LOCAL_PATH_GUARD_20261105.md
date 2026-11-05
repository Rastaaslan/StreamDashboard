# G4 — rejet des chemins réseau et périphérique dans le manifeste (05/11/2026)

## Préflight et périmètre
- Exécution exclusivement via Remote Desktop Commander sur FIXE ; PLAN, feature-matrix, CONTINUITY et MIGRATION lus ; branche `streamcockpit/3.0-full-experience`, remote GitHub canonique et HEAD initial `1363272`.
- Cinq fichiers F05/CONTINUITY étaient déjà modifiés par un autre propriétaire : aucune écriture, aucun index ni commit dans ces fichiers. Pas de construction concurrente, d'installation, d'action OBS/Twitch publique ni d'accès aux autres machines/projets.
- Lot autonome et restreint à `scripts/streamcockpit3-artifact-verifier.mjs`, son test, ce rapport et l'entrée F10 de la matrice.

## Défaut reproduit puis corrigé
- Sous Windows, `path.isAbsolute('\\\\fileserver\\share\\app.exe')` vaut vrai, ce qui permettait à `validateArtifactManifest` d'accepter une source UNC / partagée malgré la politique déclarée de vérification de binaires locaux. Les préfixes de périphériques `\\\\?\\C:\\...` et chemins root-relatifs Windows ne doivent pas contourner cette politique.
- Test RED sur source antérieure : **6 PASS / 1 FAIL / 0 skipped** (`.git/sc3-g4-unc-red-20261105.log`). Échec d'assertion réel : un chemin interdit était accepté.
- Correctif fail-closed : accepter les chemins absolus locaux avec lettre de lecteur Windows, conserver les chemins POSIX natifs seulement hors Windows pour CI, refuser les préfixes UNC / device et les chemins relatifs à la racine Windows. Aucune commande de signature, d'installation ou de publication ajoutée.
- Test GREEN ciblé : **7 PASS / 0 FAIL / 0 skipped** (`.git/sc3-g4-unc-targeted-final-20261105.log`). Scénarios Windows UNC, device, root-relative, relatif, URL et mauvais type d'artefact, avec chemins locaux valides toujours acceptés. Revalidation finale après mise à jour de la matrice : **10 PASS / 0 FAIL / 0 skipped** (7 vérificateur + 3 roadmap ; `.git/sc3-g4-unc-final-20261105.log`).
- `npm run build:types` PASS, `npm run check:browser-types` PASS, `npm run security:check` PASS (**6750 fichiers**, dont les F05 non commités) ; `git diff --check` PASS. Logs `.git/sc3-g4-unc-{types,browser,security,diff}-20261105.log` ; pas de nouvelle suite générale ni de build de distribution.

## Portée et limites
- Correction pure de validation de schéma et tests locaux sur Windows, **pas** une signature Windows Authenticode réelle, ni une vérification sur APK de production ; le vérificateur exige toujours l'attestation indépendante de provenance embarquée avant de qualifier G4.
- État conservateur : F10 partial ; G2 in_progress ; G3/G4/G5 open. Aucun test matériel FIXE/laptop/Android, migration/rollback ni nouvelle candidate.
- `CONTINUITY.md` volontairement non modifié car fichier détenu par le chantier F05 ; cette note et la matrice sont le relais documentaire à fusionner après libération du fichier, sans écrasement.

## Suite prioritaire
Réception matérielle autorisée de la paire QA et clôture des scénarios G3. Ensuite, signer Windows/Android avec les identités de production existantes et prouver migration/repli ainsi que provenance embarquée indépendante avant G4/G5. Ne pas rouvrir ClipForge V4 pour la 3.0.
