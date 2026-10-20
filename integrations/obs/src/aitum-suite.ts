export interface SuiteOutput { name: string; type: string; active: boolean }
type VendorRequest = (type: string, data: Record<string, string>) => Promise<unknown>;
type HotkeyList = () => Promise<string[]>;
const validName = (name: string) => !!name.trim() && name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(name);

/** Aitum Stream Suite 1.2.4 vendor protocol, verified against tag d7d1420.
 * start_output acknowledges a routed hotkey, not a successful public broadcast.
 * The common controller confirms the resulting Twitch/YouTube platform state.
 */
export class AitumSuiteOutputs {
  constructor(private request: VendorRequest, private hotkeys: HotkeyList) {}

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
      if (!value || typeof value.name !== 'string' || !validName(value.name) || typeof value.type !== 'string' || typeof value.active !== 'boolean') throw new Error('État de sortie Stream Suite invalide.');
      return { name:value.name, type:value.type, active:value.active };
    });
  }

  async inspect() {
    const version = await this.call('version');
    if (typeof version.version !== 'string') throw new Error('Version Stream Suite indisponible.');
    return { version: version.version, outputs: await this.list() };
  }

  async set(name: string, active: boolean, assertCurrent: () => void = () => {}) {
    if (!validName(name)) throw new Error('Nom de sortie Stream Suite invalide ou non sélectionné.');
    assertCurrent();
    const matches = (await this.list()).filter(output => output.name === name);
    assertCurrent();
    if (matches.length !== 1) throw new Error('Sortie Stream Suite absente ou ambiguë. Relancez la détection.');
    const output = matches[0];
    if (output.type !== 'stream') throw new Error('Choisissez une sortie de diffusion Stream Suite, pas un enregistrement ou une caméra virtuelle.');
    if (output.active === active) return;
    // The vendor resolves an OBS frontend hotkey by exact name and chooses the
    // last match. A unique displayed output alone does not prove unique routing.
    const hotkeys = await this.hotkeys();
    assertCurrent();
    if (!Array.isArray(hotkeys) || hotkeys.some(value => typeof value !== 'string')) throw new Error('Routage Stream Suite indisponible. Relancez la détection.');
    for (const operation of ['Start', 'Stop']) {
      const expected = `AitumStreamSuite${operation}Output${name}`;
      if (hotkeys.filter(value => value === expected).length !== 1) throw new Error('Routage Stream Suite absent ou ambigu. Vérifiez les noms des sorties dans OBS puis relancez la détection.');
    }
    await this.call(active ? 'start_output' : 'stop_output', { output: name });
    // Deliberately no "start_all_*", native fallback or automatic mutation retry.
  }
}
