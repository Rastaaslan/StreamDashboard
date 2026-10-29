# Agent Windows read-only QA RC2

STREAMDASHBOARD — AGENT WINDOWS READ-ONLY QA RC2
Qualification du 28 octobre 2026
===============================================

Ce paquet lit seulement GetStats et GetStreamStatus sur OBS local (127.0.0.1).
Il ne lance ni n'arrete une diffusion. Il n'installe aucun service, ne configure
pas le pare-feu et n'ouvre aucun port LAN. Aucun lancement automatique Windows.

PREREQUIS
- Windows, Node.js 22+, OBS WebSocket active AVEC authentification.
- Utiliser un dossier QA distinct de votre application active.
- Conserver le ZIP RC1 et la configuration existante pour revenir en arriere.

LECTURE UNIQUE
Ouvrir PowerShell dans ce dossier :
    .\Start-Agent-ReadOnly.ps1 -DeviceId FIXE_QA

SURVEILLANCE LOCALE
    .\Start-Agent-ReadOnly.ps1 -Monitor -DeviceId FIXE_QA
Arret : Ctrl+C.

COFFRE DPAPI CURRENTUSER — OPTION EXPLICITE
Le mode historique charge le mot de passe OBS deja configure uniquement en
memoire. La RC2 peut utiliser exclusivement une cle obs_password preprovisionnee
dans WindowsAgentSecretStore, sous le meme compte/profil Windows.

Le provisionnement se fait explicitement par l'API WindowsAgentSecretStore.set
du depot source/compile qualifie. Ce ZIP n'ajoute pas d'assistant de migration.
Ne placez jamais le mot de passe dans une commande, une variable d'environnement,
un rapport ou ce dossier distribue. Aucun secret reel n'est fourni dans le ZIP.

Pour activer un magasin DEJA provisionne dans le PowerShell de QA :
    $env:SD_AGENT_DPAPI_DIR = Join-Path $env:LOCALAPPDATA 'StreamDashboard\AgentV2\secure'
    $env:SD_AGENT_DPAPI_OPT_IN = 'I_ACCEPT_CURRENT_USER_DPAPI'
    .\Start-Agent-ReadOnly.ps1 -DeviceId FIXE_QA

Les deux variables sont obligatoires. Chemins relatifs et UNC refuses.
Le port OBS et l'authentification restent verifies depuis la configuration
locale OBS. Si le magasin, obs_password ou DPAPI est absent/corrompu, le
programme refuse la connexion SANS utiliser le mot de passe de configuration
comme secours. Le Buffer dechiffre est efface apres decodage ; l'API OBS exige
ensuite une chaine JavaScript dont l'effacement memoire complet n'est pas garanti.

Pour revenir au mode historique, APRES avoir arrete le processus QA :
    Remove-Item Env:SD_AGENT_DPAPI_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:SD_AGENT_DPAPI_OPT_IN -ErrorAction SilentlyContinue

RETOUR ARRIERE
1. Arreter uniquement le processus QA par Ctrl+C.
2. Retirer les deux variables ci-dessus dans ce PowerShell, si utilisees.
3. Reutiliser le dossier RC1 conserve ou supprimer le dossier extrait RC2.
4. Conserver un magasin DPAPI provisionne tant qu'il sert ; sa suppression
   n'est jamais automatique et n'est pas necessaire au rollback du programme.
Aucune application active, configuration OBS ou installation Windows n'est remplacee.

PREUVES ET LIMITES
- 8 tests coffre + 4 tests de raccordement ajoutes ; tests Agent, types et audit
  securite passes. Les nombres complets figurent dans le manifeste de qualification.
- DPAPI natif sur FIXE/Node22 : roundtrip, corruption, changement d'identite et
  mauvaise entropie refuses, uniquement avec donnees factices. Dossier QA supprime.
- Le nouvel usage DPAPI -> connexion OBS reelle n'a pas ete execute : les tests
  de raccordement utilisent un faux magasin, sans lire de secret OBS reel.
- Les anciens essais OBS physiques du RC1 ne certifient pas a eux seuls la RC2.
- Pas de service supervise, controle OBS ecriture, bascule Android ou Dashboard
  NEXT complet. Version QA, pas une release de production.
- DPAPI protege pour le compte Windows courant ; pas une barriere contre un
  programme malveillant sous le meme compte. Un futur service doit utiliser le
  meme compte/profil. Pas de deploiement automatique.
- Ecriture fichier synchronisee et remplacement atomique ; durabilite des
  metadonnees apres coupure electrique Windows non qualifiee. Verrou abandonne :
  inspection requise, pas de recuperation silencieuse.

Provenance et résultats détaillés : `AGENT_READONLY_RC2_QUALIFICATION_20261028.json`.
Preuve physique factice : `AGENT_DPAPI_WINDOWS_FAKESECRET_20261028.txt`.

## Reproduire depuis le depot isole

```bash
npm ci
npm test
npx tsc --noEmit --pretty false
npm run security:check
node scripts/build-agent-readonly-qa.mjs
```

Le provisionnement avance utilise le module `dist/apps/agent/src/windows-secret-store.js`
genere par le build normal. Il doit etre fait sous le compte Windows concerne,
avec une entree secrete en memoire et `WindowsAgentSecretStore.set('obs_password', bytes)`.
Ne pas extraire automatiquement le secret de la configuration OBS.

Le ZIP RC2 est une archive deterministe des quatre fichiers produits par le builder :

```python
from pathlib import Path
import zipfile
root = Path('dist/agent-readonly-qa')
files = ['LISEZ-MOI-Agent-ReadOnly-QA.txt', 'MANIFEST-QA.json',
         'Start-Agent-ReadOnly.ps1', 'StreamAgent-ReadOnly.mjs']
with zipfile.ZipFile('dist/StreamDashboard-AgentV2-ReadOnly-Windows-QA-RC2-20261028.zip',
                     'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in sorted(files):
        info = zipfile.ZipInfo(name, date_time=(2026, 10, 28, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (root / name).read_bytes(),
                         compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
```
