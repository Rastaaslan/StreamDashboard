# Complément F05 et paquet de travail Windows

Journaux FIXE du 03/11/2026. L’archive conserve les octets originaux, y compris les échecs ; hashes dans original-log-hashes.json. Copies texte : UTF-8, ANSI et espaces de fin de ligne normalisés uniquement.

Preuve F05 finale : mixer-qualified-targets.txt, **80 PASS / 0 FAIL / 0 skipped**. Le test de révocation a été reproduit rouge dans mixer-auth-race-red.txt avant correction. Les premiers timeouts de fixture et délais trop courts sont conservés séparément. Le délai du cas de perte est explicitement vérifié inférieur à sept secondes, sans assouplir l’interdiction de renvoi.

Les preuves Windows clean-build/windows-package/electron-packaged-smoke concernent exclusivement **99ac62622c3055366201dc481c0ed9121115bd1c**, avant ce complément F05. Voir windows-preparatory-manifest.json : EXE x64 NotSigned, deux essais isolés PASS, aucune APK construite, aucune installation ou publication. Elles ne qualifient pas le nouveau code F05, G3, G4 ou G5.
