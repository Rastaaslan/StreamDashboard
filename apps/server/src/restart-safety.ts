export interface RestartSafetySource {
  obsEnabled: boolean;
  stopped(): boolean;
  pending(): boolean;
  revision(): string;
  configuration(): { outputs: Record<string, { kind: string; name: string }> };
  obs: {
    state: { connected: boolean; streamingKnown?: boolean; streaming: boolean; recording: boolean };
    readonly connectionGeneration: number;
    refresh(): Promise<unknown>;
    outputs(): Promise<Array<{ outputName?: string; outputActive?: boolean; outputFlags?: unknown }>>;
    streamSuiteOutputs(): Promise<{ outputs: Array<{ name: string; type: string; active: boolean | null }> }>;
  };
}

/** A fresh observation, never the dashboard's cached platform indicators. */
export async function assessRestartSafety(source: RestartSafetySource): Promise<{ safe: boolean; reason?: string }> {
  const refuse = (reason: string) => ({ safe: false, reason });
  if (source.stopped()) return refuse('La régie est déjà en cours d’arrêt.');
  if (source.pending()) return refuse('Une commande est en cours. Attendez son résultat avant de redémarrer.');
  // The control-only runtime cannot acquire an OBS connection or start outputs.
  if (!source.obsEnabled) return { safe: true };
  const generation = source.obs.connectionGeneration;
  const revision = source.revision();
  const selected = source.configuration().outputs;
  const configuration = JSON.stringify(selected);
  if (!source.obs.state.connected) return refuse('OBS est indisponible : l’arrêt des diffusions ne peut pas être confirmé.');
  try {
    const [native, suite] = await Promise.all([
      source.obs.outputs(),
      Object.values(selected).some(output => output.kind === 'aitum-suite')
        ? source.obs.streamSuiteOutputs() : Promise.resolve({ outputs: [] }),
      source.obs.refresh(),
    ]);
    if (source.stopped() || source.pending() || revision !== source.revision()
      || configuration !== JSON.stringify(source.configuration().outputs)
      || generation !== source.obs.connectionGeneration || !source.obs.state.connected) {
      return refuse('L’état de la régie a changé pendant la vérification. Réessayez.');
    }
    const state = source.obs.state;
    if (state.streamingKnown !== true || typeof state.recording !== 'boolean') return refuse('État de diffusion ou d’enregistrement OBS inconnu.');
    if (state.streaming || state.recording) return refuse('Une diffusion ou un enregistrement OBS est en cours.');
    if (native.some(output => output.outputActive !== false && typeof output.outputFlags === 'object'
      && output.outputFlags !== null && (output.outputFlags as Record<string, unknown>).OBS_OUTPUT_SERVICE === true)) {
      return refuse('Une sortie de diffusion OBS est active.');
    }
    if (suite.outputs.some(output => output.type === 'stream' && output.active !== false)) return refuse('Une sortie Aitum est active ou son état est inconnu.');
    for (const output of Object.values(selected)) {
      if (output.kind === 'main' || output.kind === 'unconfigured') continue;
      const matches = output.kind === 'output' ? native.filter(item => item.outputName === output.name).map(item => item.outputActive)
        : output.kind === 'aitum-suite' ? suite.outputs.filter(item => item.type === 'stream' && item.name === output.name).map(item => item.active) : [];
      if (matches.length !== 1 || matches[0] !== false) return refuse('Une destination configurée est active ou ne peut pas être vérifiée.');
    }
    return { safe: true };
  } catch {
    return refuse('La vérification fraîche des sorties OBS et Aitum a échoué. Réessayez avant de redémarrer.');
  }
}
