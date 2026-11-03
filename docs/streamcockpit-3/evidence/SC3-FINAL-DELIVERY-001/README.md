# Preuves SC3-FINAL-DELIVERY-001

Journaux exécutés sur FIXE le 03/11/2026. `original-logs.zip` contient les octets des journaux PowerShell originaux, y compris les campagnes échouées. `original-log-hashes.json` en conserve les SHA-256 et chemins d’origine. Les copies `.txt` normalisent uniquement l’encodage UTF-8, les séquences ANSI et les espaces de fin de ligne pour la lecture dans Git ; aucun résultat n’est modifié.

Campagnes finales : `frozen-vitest.txt` (2255 PASS / 108 skipped), `node-sequential.txt` (351 PASS / 6 skipped), `network.txt` (35 PASS), `integrated-targets.txt` (45 PASS), `electron-source-smoke.txt` (2 PASS), `qa-guard.txt` (6 PASS), `package-unit.txt` (11 PASS). `full-vitest.txt` et `node-built.txt` sont les premières campagnes échouées, conservées sans les qualifier. Les essais de fixtures échoués ont aussi leurs journaux.

Le test Electron final démarre le vrai mode régie --agent sans fenêtre avant de vérifier l’identité locale, sur profil temporaire et faux serveur OBS. Aucune preuve matérielle laptop/Android ou signature de production n’est déduite de ces tests.
