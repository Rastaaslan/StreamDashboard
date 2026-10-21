import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckAction } from '../packages/contracts/src/control.js';
import { installControllerKeys } from '../apps/desktop/src/controller.js';

const native = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  callbacks: new Map<string, () => void>(),
  unavailable: new Set<string>(),
  register: vi.fn(),
  unregisterAll: vi.fn(),
  getCredential: vi.fn(),
  setCredential: vi.fn(),
  getBindings: vi.fn(),
  setBindings: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, callback: (...args: any[]) => any) => native.handlers.set(name, callback),
    removeHandler: (name: string) => native.handlers.delete(name),
  },
  globalShortcut: { register: native.register, unregisterAll: native.unregisterAll },
}));
vi.mock('../apps/desktop/src/secrets.js', () => ({ ElectronSecretStore: class {
  getController = native.getCredential;
  setController = native.setCredential;
  getControllerBindings = native.getBindings;
  setControllerBindings = native.setBindings;
} }));

const shortcut = 'Control+Alt+Shift+F1';
const action = (changes: Partial<DeckAction> = {}): DeckAction => ({
  id: 'micro', label: 'Micro', type: 'mic.toggle', value: '', color: 'purple', shortcut, ...changes,
});
let owner: any, stop: (() => void) | undefined;
const fetchMock = vi.fn<typeof fetch>();
const origin = 'http://127.0.0.1:48134';
const invoke = (name: string, value?: unknown, event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame }) => native.handlers.get(name)!(event, value);
const configure = (actions = [action()], server = 'http://192.168.1.158:48133', credential = 'synthetic-paired-device') => invoke('controller:configure', { server, credential, actions });
const status = () => invoke('controller:status');
const response = (result: unknown = { status: 'succeeded', message: 'Confirmed' }, code = 200) => new Response(JSON.stringify(result), { status: code, headers: { 'Content-Type': 'application/json' } });
const drain = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  native.handlers.clear(); native.callbacks.clear(); native.unavailable.clear();
  native.register.mockImplementation((accelerator: string, callback: () => void) => {
    if (native.unavailable.has(accelerator)) return false;
    native.callbacks.set(accelerator, callback); return true;
  });
  native.unregisterAll.mockImplementation(() => native.callbacks.clear());
  native.getCredential.mockResolvedValue({ credential: 'synthetic-paired-device' });
  native.setCredential.mockResolvedValue(undefined);
  native.getBindings.mockResolvedValue(null); native.setBindings.mockResolvedValue(undefined);
  owner = {
    isDestroyed: () => false,
    isVisible: vi.fn(() => false), isFocused: vi.fn(() => false), isMinimized: vi.fn(() => true),
    show: vi.fn(), focus: vi.fn(), restore: vi.fn(),
    webContents: { mainFrame: { url: origin + '/mobile/control/?role=client' }, isDestroyed: () => false, send: vi.fn() },
  };
  fetchMock.mockReset(); fetchMock.mockResolvedValue(response()); vi.stubGlobal('fetch', fetchMock);
  stop = installControllerKeys(() => owner, '/tmp/controller-tests', origin);
});
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('global controller macros without foreground dependency', () => {
  it('dispatches from the main process while the window is hidden and minimized', async () => {
    expect(configure().registered).toEqual([shortcut]);
    native.callbacks.get(shortcut)!(); await drain();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('http://192.168.1.158:48133/api/v2/actions');
    expect(request).toMatchObject({ method: 'POST', headers: { Authorization: 'Device synthetic-paired-device' } });
    expect(JSON.parse(request!.body as string)).toMatchObject({ action: 'micro', trigger: 'keyboard', id: expect.any(String), issuedAt: expect.any(String) });
    expect(status().lastResult).toMatchObject({ status: 'succeeded' });
    for (const method of ['show','focus','restore','isVisible','isFocused','isMinimized']) expect(owner[method]).not.toHaveBeenCalled();
  });

  it('accepts the real private Tailscale target used by the game PC', async () => {
    configure([action()], 'http://100.126.186.44:48133');
    native.callbacks.get(shortcut)!(); await drain();
    expect(fetchMock.mock.calls[0][0]).toBe('http://100.126.186.44:48133/api/v2/actions');
    expect(status().registered).toEqual([shortcut]);
  });

  it('retains native mappings across a failed request and only retries on a new keypress', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network unavailable'));
    configure(); const press = native.callbacks.get(shortcut)!;
    press(); await drain();
    expect(status()).toMatchObject({ registered: [shortcut], lastResult: { status: 'uncertain' } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    press(); await drain();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(status().lastResult).toMatchObject({ status: 'succeeded' });
    const ids = fetchMock.mock.calls.map(([, request]) => JSON.parse(request!.body as string).id);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('retries a refused native binding without renderer polling, focus or a second configuration', async () => {
    native.unavailable.add(shortcut);
    expect(configure()).toMatchObject({ registered: [], unavailable: [shortcut] });
    native.unavailable.delete(shortcut);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(status()).toMatchObject({ registered: [shortcut], unavailable: [] });
    native.callbacks.get(shortcut)!(); await drain();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(owner.focus).not.toHaveBeenCalled();
  });

  it('reports a busy macro without queueing or replaying a second key', async () => {
    let complete!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>(resolve => { complete = resolve; }));
    configure(); const press = native.callbacks.get(shortcut)!;
    press(); press();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(status().lastResult).toMatchObject({ status: 'failed', message: expect.stringContaining('ignoré') });
    complete(response()); await drain(); await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps live.stop behind explicit dashboard confirmation', async () => {
    configure([action({ id: 'stop-live', type: 'live.stop' })]);
    native.callbacks.get(shortcut)!(); await drain();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status().lastResult).toMatchObject({ status: 'failed', message: expect.stringContaining('Confirmez') });
  });

  it('stores a result when the renderer cannot receive it, without repeating the mutation', async () => {
    owner.webContents.send.mockImplementation(() => { throw new Error('Renderer unavailable'); });
    configure(); native.callbacks.get(shortcut)!(); await drain();
    expect(status().lastResult).toMatchObject({ status: 'succeeded' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([409, 500])('keeps an uncertain or ambiguous server response uncertain (%s)', async code => {
    fetchMock.mockResolvedValueOnce(response({ error: { code: code === 409 ? 'ACTION_UNCERTAIN' : 'INTERNAL_ERROR', message: 'Résultat non confirmé.' } }, code));
    configure(); native.callbacks.get(shortcut)!(); await drain();
    expect(status().lastResult).toEqual({ status: 'uncertain', message: 'Résultat non confirmé.' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([{status:403,code:'REMOTE_SCOPE_DENIED'},{status:409,code:'DEVICE_ROLE_STOPPED'}])('reports an explicit HTTP refusal as failed instead of an uncertain dispatch ($code)', async ({status:statusCode,code}) => {
    fetchMock.mockResolvedValueOnce(response({ error: { code, message: 'Appareil révoqué.' } }, statusCode));
    configure(); native.callbacks.get(shortcut)!(); await drain();
    expect(status().lastResult).toEqual({ status: 'failed', message: 'Appareil révoqué.' });
  });
});

describe('native macro configuration ownership', () => {
  it('clears the previous host mappings when switching to an autonomous workspace without a server', () => {
    configure(); const previous = native.callbacks.get(shortcut)!;
    expect(configure([], '', '')).toMatchObject({ registered: [], unavailable: [] });
    expect(native.callbacks.size).toBe(0);
    previous(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates all mappings before replacing working registrations', () => {
    configure(); const previous = native.callbacks.get(shortcut)!;
    expect(() => configure([action(), action({ id: 'duplicate-key' })])).toThrow('invalide');
    expect(native.callbacks.get(shortcut)).toBe(previous);
    expect(status().registered).toEqual([shortcut]);
    expect(() => configure([action(), { ...action({ id: 'broken' }), shortcut: 'F1' }])).toThrow('invalide');
    expect(native.callbacks.get(shortcut)).toBe(previous);
  });

  it('does not leave a stale callback enabled after a mapping or target change', async () => {
    configure(); const previous = native.callbacks.get(shortcut)!;
    configure([action({ id: 'scene-pause', type: 'mode.set' })], 'http://192.168.1.159:48133', 'new-synthetic-device');
    previous(); expect(fetchMock).not.toHaveBeenCalled();
    native.callbacks.get(shortcut)!(); await drain();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('http://192.168.1.159:48133/api/v2/actions');
    expect(request!.headers).toMatchObject({ Authorization: 'Device new-synthetic-device' });
    expect(JSON.parse(request!.body as string).action).toBe('scene-pause');
  });

  it('discards a late result from the previous workspace and cancels its client request', async () => {
    let complete!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>(resolve => { complete = resolve; }));
    configure(); native.callbacks.get(shortcut)!();
    const signal = fetchMock.mock.calls[0][1]!.signal!;
    configure([], '', '');
    expect(signal.aborted).toBe(true);
    complete(response({ status: 'succeeded', message: 'Old workspace' })); await drain();
    expect(status()).not.toHaveProperty('lastResult');
    expect(owner.webContents.send).not.toHaveBeenCalled();
  });

  it('rejects another frame and another origin before touching native keys or credentials', async () => {
    const config = { server: 'http://127.0.0.1:48133', credential: '', actions: [action()] };
    const childEvent = { sender: owner.webContents, senderFrame: { url: origin + '/child' } };
    expect(() => invoke('controller:configure', config, childEvent)).toThrow('non autorisée');
    await expect(invoke('controller:credential:get', undefined, childEvent)).rejects.toThrow('non autorisée');
    owner.webContents.mainFrame.url = 'https://untrusted.example/';
    expect(() => invoke('controller:configure', config)).toThrow('non autorisée');
    owner.webContents.mainFrame.url = 'not a URL';
    expect(() => invoke('controller:configure', config)).toThrow('non autorisée');
    expect(native.register).not.toHaveBeenCalled(); expect(native.getCredential).not.toHaveBeenCalled();
  });

  it('stops native retries, in-flight requests and callbacks during cleanup', async () => {
    native.unavailable.add('Control+Alt+Shift+F2');
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => {}));
    configure([action(), action({ id: 'pause', shortcut: 'Control+Alt+Shift+F2', type: 'mode.set' })]);
    const previous = native.callbacks.get(shortcut)!; previous();
    const signal = fetchMock.mock.calls[0][1]!.signal!, attempts = native.register.mock.calls.length;
    stop!(); stop = undefined;
    expect(signal.aborted).toBe(true); expect(native.callbacks.size).toBe(0); expect(native.handlers.size).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000); previous();
    expect(native.register).toHaveBeenCalledTimes(attempts); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});


it('restores verified shortcuts without a renderer and never replays a command on boot',async()=>{
 stop?.();owner=null;
 native.getBindings.mockResolvedValue({server:'http://127.0.0.1:48133',credential:'',actions:[action()]});
 fetchMock.mockResolvedValue(response({configuration:{actions:[action()]}}));
 const keys=installControllerKeys(()=>null,'/tmp/controller-tests',origin);stop=keys;
 await keys.restore();
 expect(native.callbacks.has(shortcut)).toBe(true);
 expect(fetchMock).toHaveBeenCalledTimes(1);expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
 native.callbacks.get(shortcut)!();await drain();expect(fetchMock).toHaveBeenCalledTimes(2);
 expect(fetchMock.mock.calls[1][1]?.method).toBe('POST');
});
it('refuses to restore a shortcut whose executor action changed while the controller was stopped',async()=>{
 stop?.();owner=null;
 native.getBindings.mockResolvedValue({server:'http://127.0.0.1:48133',credential:'',actions:[action()]});
 fetchMock.mockResolvedValue(response({configuration:{actions:[action({type:'live.start'})]}}));
 const keys=installControllerKeys(()=>null,'/tmp/controller-tests',origin);stop=keys;
 await keys.restore();expect(native.callbacks.size).toBe(0);
});

it('a secure-store failure cannot trigger a receipt/render/write loop',async()=>{
 native.setBindings.mockRejectedValue(Error('Keyring unavailable'));
 owner.webContents.send.mockImplementation(()=>{configure();});
 configure();await drain();
 for(let i=0;i<30;i++)configure();
 await drain();
 expect(native.setBindings).toHaveBeenCalledTimes(1);
 expect(owner.webContents.send).toHaveBeenCalledTimes(1);
 expect(status().registered).toEqual([shortcut]);
});
it('persists changed action parameters once without rewriting identical mappings on refresh',async()=>{
 configure([action({value:'First mic'})]);await drain();
 configure([action({value:'First mic'})]);await drain();
 configure([action({value:'Second mic'})]);await drain();
 expect(native.setBindings).toHaveBeenCalledTimes(2);
 expect(native.setBindings.mock.calls.at(-1)?.[0].actions[0].value).toBe('Second mic');
});

it('dispatches separate physical destinations without a workspace and refuses a replaced device',async()=>{
 const second=action({id:'second',shortcut:'Control+Alt+Shift+F2'}),definition=action({id:'remote-mic',value:'Mic B'});
 fetchMock.mockImplementation(async input=>String(input).endsWith('/device')?response({device:{id:String(input).includes('two.local')?'two':'wrong'}}):response());
 invoke('controller:configure',{server:'',credential:'',actions:[action(),second],destinations:{micro:{server:'http://one.local:48133',credential:'one-secret',deviceId:'one',definition},second:{server:'http://two.local:48133',credential:'two-secret',deviceId:'two',definition}}});
 native.callbacks.get(shortcut)!();await drain();expect(fetchMock.mock.calls.some(([url])=>String(url).endsWith('/actions'))).toBe(false);
 await vi.advanceTimersByTimeAsync(300);native.callbacks.get(second.shortcut)!();await drain();
 const post=fetchMock.mock.calls.find(([url])=>String(url).endsWith('/actions'))!;
 expect(post[0]).toBe('http://two.local:48133/api/v2/actions');expect(JSON.parse(post[1]!.body as string)).toMatchObject({action:'remote-mic',expectedAction:definition});
 expect(post[1]!.headers).toMatchObject({Authorization:'Device two-secret'});
});
it('headless restoration keeps a reachable destination while another executor is offline',async()=>{
 const second=action({id:'second',shortcut:'Control+Alt+Shift+F2'});
 native.getBindings.mockResolvedValue({server:'',credential:'',actions:[action(),second],destinations:{micro:{server:'http://one.local:48133',credential:'one-secret',deviceId:'one',definition:action()},second:{server:'http://two.local:48133',credential:'two-secret',deviceId:'two',definition:second}}});
 fetchMock.mockImplementation(async input=>{if(String(input).includes('one.local'))throw Error('offline');return String(input).endsWith('/device')?response({device:{id:'two'}}):response({configuration:{actions:[second]}});});
 await (stop as any).restore();expect(status().registered).toEqual([second.shortcut]);
 expect(fetchMock.mock.calls.every(([url])=>!String(url).endsWith('/actions'))).toBe(true);
});

it('a disabled Pilotage role keeps definitions but never registers global shortcuts',async()=>{
 stop?.();stop=installControllerKeys(()=>owner,'/unused',origin,fetchMock,false);
 configure();expect(native.register).not.toHaveBeenCalled();expect(status().registered).toEqual([]);
 expect(status().lastResult?.message).toContain('désactivé');
 await (stop as any).restore();expect(fetchMock).not.toHaveBeenCalled();
});
