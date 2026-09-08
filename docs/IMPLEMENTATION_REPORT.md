# Rapport V1 Desktop

La V1 fournit un cockpit desktop autonome : tableau de bord, checklist de préparation, console live et timer, planning local persistant, scènes/mixeur/diffusion/enregistrement OBS, Control Deck, Fun Deck, réglages et diagnostics. Les mutations utilisent le contrat unique `DashboardCommand` et l'état temps réel est distribué par `DashboardEvent`.

Le launcher quotidien ne dépend plus de StreamTool ou damPlanner. Le code de pairing, le manifest PWA, les routes device et la navigation responsive mobile ont été retirés conformément au périmètre desktop. Les sources historiques sous `_integration_sources` n'ont pas été modifiées.
