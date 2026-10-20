export interface SuiteOutput { name: string; type: string; active: boolean }
type VendorRequest = (type: string, data: Record<string, string>) => Promise<unknown>;

/** Aitum Stream Suite 1.2.4 vendor protocol, verified against tag d7d1420.
 * start_output acknowledges a routed hotkey, not a successful public broadcast.
 * The common controller confirms the resulting Twitch/YouTube platform state.
 */
export class AitumSuiteOutputs {
  constructor(private request: VendorRequest) {}

  private async call(type: string, data: Record<string, string> = {}) {
    const value = await this.request(type, data);
    if (!value || typeof value !== 'object' || (value as {success?:unknown}).success !== true) {
      const error = value && typeof value === 'object' ? (value as {error?:unknown}).error : undefined;
      throw new Error(`Stream Suite : ${typeof error === 'string' ? error.slice(0,300) : 'réponse non confirmée'}`);
    }
    return value as Record<string, unknown>;
  }

  async list(): Promise<SuiteOutput[]> {
    const response = await this.call('get_outputs');
    if (!Array.isArray(response.outputs)) throw new Error('Liste des sorties Stream Suite invalide.');
    return response.outputs.map(value => {
      if (!value || typeof value.name !== 'string' || !value.name || value.name.length > 200 || typeof value.type !== 'string' || typeof value.active !== 'boolean') throw new Error('État de sortie Stream Suite invalide.');
      return { name:value.name, type:value.type, active:value.active };
    });
  }

  async inspect() {
    const version = await this.call('version');
    if (typeof version.version !== 'string') throw new Error('Version Stream Suite indisponible.');
    return { version: version.version, outputs: await this.list() };
  }

  async set(name: string, active: boolean) {
    if (!name.trim()) throw new Error('Sortie Stream Suite non sélectionnée.');
    const matches = (await this.list()).filter(output => output.name === name);
    if (matches.length !== 1) throw new Error('Sortie Stream Suite absente ou ambiguë. Relancez la détection.');
    const output = matches[0];
    if (output.type !== 'stream') throw new Error('Choisissez une sortie de diffusion Stream Suite, pas un enregistrement ou une caméra virtuelle.');
    if (output.active === active) return;
    await this.call(active ? 'start_output' : 'stop_output', { output: name });
    // Deliberately no "start_all_*" and no automatic mutation retry.
  }
}
