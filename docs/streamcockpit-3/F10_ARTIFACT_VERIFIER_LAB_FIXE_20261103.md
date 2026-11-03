# F10 — Vérificateur de provenance EXE/APK, laboratoire hors release (2026-11-03)

## Périmètre
Développé exclusivement sur FIXE Windows 11 via Remote Desktop Commander, dépôt canonique `streamcockpit/3.0-full-experience`. Le lot F08 de verrouillage Twitch étant en cours dans d'autres fichiers du même dépôt, ce sous-lot F10 ne modifie **aucun** fichier F08 ni le service worker. Ce vérificateur est un outil **en lecture seule**, sans génération de clés, build, installation, publication, signature ni commande OBS/Twitch. La branche Q, la RC2 et les autres machines restent intactes.

## Contrat du vérificateur
- `npm run streamcockpit3:artifacts -- <chemin absolu d'un manifeste QA>` lance `scripts/streamcockpit3-artifact-verifier.mjs`. Une invocation sans manifeste échoue. Le manifeste strict contient `schemaVersion=1`, un commit Git 40 hex et deux chemins ABSOLUS distincts (Windows `.exe`, Android `.apk`) avec SHA-256 chacun.
- Vérifie l'identité du commit Git `HEAD`, l'absence de modifications locales et les SHA-256 lus directement des deux artefacts. Les fichiers symlink et hardlink sont refusés ; les chemins de signature sont en lecture seule, sans shell.
- Windows : `Get-AuthenticodeSignature` via PowerShell non interactif, statut `Valid`, empreinte du certificat comparée à `SC3_TRUSTED_WINDOWS_CERT_SHA1` (pin indépendant du manifeste).
- Android : `java -jar <apksigner.jar>` en mode `verify --verbose --print-certs`, sans passer par un `.bat` ou un shell. Chemin `SC3_APKSIGNER_JAR` requis, digest certificat SHA-256 attendu via `SC3_TRUSTED_ANDROID_CERT_SHA256` (pin indépendant). Refus des signataires multiples et des empreintes erronées.
- Les empreintes et le commit sont revérifiés après les appels externes ; une modification en cours de vérification fait échouer le contrôle. Les erreurs, les binaires/outils manquants, un arbre Git sale ou les paramètres de confiance non fournis restent bloquants.
- **Verrou de sécurité conservé : le contrôle refuse encore la qualification avec `SC3_ARTIFACT_EMBEDDED_SAME_COMMIT_ATTESTATION_MISSING`**. Une valeur `sourceCommit` dans un manifeste externe est une déclaration non fiable : elle ne prouve pas que l'EXE et l'APK contiennent réellement ce commit. Il faut encore générer puis vérifier une attestation de build embarquée dans *chacun* des deux artefacts, liée cryptographiquement aux octets signés. Aucun `verified:true` ne peut être produit ici.

## Preuves et limites
Tests ciblés sur les contrats (manifestes invalides, pins absents, APK signataires multiples/erronés, absence de manifeste, scripts F10) uniquement. Ne prétend pas valider une véritable signature de production : aucun artefact release connu, ni outil SDK Android identifié dans `ANDROID_HOME`/`ANDROID_SDK_ROOT` lors de ce passage. Les certificats réels, signatures, Attestation Windows/Android, rollback et migrations ne sont **pas** qualifiés.

**G0/G1 historically qualified, G2 in_progress, G3/G4/G5 open ; F10 partial.** Ce laboratoire ne modifie pas `release:check` (déjà fail-closed) et ne doit pas être présenté comme une RC ni une preuve de signature.
