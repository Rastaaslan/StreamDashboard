export interface MicMeterRow {
  inputName: string;
  inputLevelsMul?: number[][];
}
export interface MicHealth {
  inputName: string;
  state: 'unknown' | 'offline' | 'idle' | 'muted' | 'unavailable' | 'healthy' | 'monitoring';
  /** Approximate activity on a -70 dB to 0 dB scale; not a voice or battery percentage. */
  levelPercent: number | null;
  secondsSilent: number | null;
  lastSignalAt: string | null;
  warning: string | null;
  batteryPercent: null;
  batterySource: 'unavailable';
}
interface MeterEvidence {
  level: number;
  lastMeterAt: number;
  lastSoundAt: number | null;
  firstStrongAt: number | null;
  strongFrames: number;
  signalConfirmed: boolean;
  zeroSince: number | null;
  zeroFrames: number;
}

/**
 * Safety-first OBS mic monitor. OBS InputVolumeMeters is not speech recognition.
 *
 * Previous behavior sampled only one frame every 750 ms and treated every
 * amplitude <= 0.017 (~-35 dB) as silence. That creates false warnings for
 * quiet voices, filters (expander/noise suppression) and bursts between frames.
 *
 * Never claim a silent microphone merely because a signal is "low":
 *   1. Process EVERY meter event (the caller throttles UI updates, not reads).
 *   2. Count all finite positive energy down to near-digital-zero as activity.
 *   3. Arm the watchdog ONLY after sustained verified positive input.
 *
 * Genuine TX disconnect alerts are separately sourced from DJI USB telemetry.
 * There is intentionally no attempt to derive battery or recognize speech.
 */
export class MicHealthWatch {
  private sources = new Map<string, MeterEvidence>();
  private wasLive = false;

  // Any OBS amplitude above -94 dB resets the zero-meter timer. Very quiet
  // speech MUST NOT be ignored simply because it falls below the old -35 dB.
  private readonly digitalZeroFloor = 0.00002;
  // Require multiple substantial observations before we even arm an alarm.
  private readonly evidenceFloor = 0.001;
  private readonly minimumEvidenceMs = 1_200;
  private readonly minimumStrongFrames = 5;
  private readonly staleAfterMs = 8_000;

  updateStream(streaming: boolean, _now = Date.now()): void {
    if (streaming === this.wasLive) return;
    this.wasLive = streaming;
    // Never preserve sound or silence evidence across different live sessions.
    this.sources.clear();
  }

  observe(rows: readonly MicMeterRow[], now = Date.now()): boolean {
    if (!this.wasLive || !Array.isArray(rows)) return false;
    let observed = false;
    for (const row of rows) {
      if (!row || typeof row.inputName !== 'string' || !row.inputName ||
        !Array.isArray(row.inputLevelsMul)) continue;

      let level = -1;
      for (const channel of row.inputLevelsMul) {
        if (!Array.isArray(channel)) continue;
        for (const sample of channel) {
          if (typeof sample === 'number' && Number.isFinite(sample) &&
              sample >= 0 && sample <= 10 && sample > level) level = sample;
        }
      }
      if (level < 0) continue;
      const prev = this.sources.get(row.inputName);
      // Guard out-of-order meter frames so they cannot revive stale readings.
      if (prev && now < prev.lastMeterAt) continue;

      const substantial = level >= this.evidenceFloor;
      const active = level > this.digitalZeroFloor;
      const firstStrongAt = substantial
        ? prev?.firstStrongAt ?? now : prev?.firstStrongAt ?? null;
      const strongFrames = (prev?.strongFrames ?? 0) + (substantial ? 1 : 0);
      const signalConfirmed = prev?.signalConfirmed === true ||
        (firstStrongAt !== null && now - firstStrongAt >= this.minimumEvidenceMs &&
          strongFrames >= this.minimumStrongFrames);

      this.sources.set(row.inputName, {
        level, lastMeterAt: now,
        lastSoundAt: active ? now : prev?.lastSoundAt ?? null,
        firstStrongAt, strongFrames, signalConfirmed,
        zeroSince: active ? null : signalConfirmed
          ? prev?.zeroSince ?? now : null,
        zeroFrames: active ? 0 : signalConfirmed
          ? (prev?.zeroFrames ?? 0) + 1 : 0,
      });
      observed = true;
    }
    return observed;
  }

  state(inputName: string,
    options: { connected: boolean; streaming: boolean; muted?: boolean; exists?: boolean },
    now = Date.now()): MicHealth {
    const base: MicHealth = {
      inputName, state: 'unknown', levelPercent: null, secondsSilent: null,
      lastSignalAt: null, warning: null, batteryPercent: null, batterySource: 'unavailable',
    };
    if (!inputName) return {
      ...base, warning: 'Choisissez votre source micro principale dans la configuration OBS.',
    };
    if (!options.connected) return {
      ...base, state: 'offline',
      warning: 'Connexion OBS indisponible : impossible de surveiller le micro.',
    };
    if (!options.exists) return {
      ...base, state: 'unavailable', warning: 'Source micro introuvable dans OBS.',
    };
    if (options.muted) return {
      ...base, state: 'muted', warning: 'Micro coupé dans OBS.',
    };
    if (!options.streaming || !this.wasLive) return { ...base, state: 'idle' };

    const meter = this.sources.get(inputName);
    if (!meter || now < meter.lastMeterAt ||
        now - meter.lastMeterAt > this.staleAfterMs) {
      return {
        ...base, state: 'unavailable',
        warning: 'Mesure audio OBS indisponible ou périmée. Impossible de conclure à un silence du micro.',
      };
    }

    // Visual amplitude is a perceptual *relative* level in dB, not volume in
    // percent of speech or battery. Do not display "0%" for a -50 dB voice.
    const db = meter.level > 0 ? 20 * Math.log10(meter.level) : -70;
    const relativeLevel = meter.level > this.digitalZeroFloor
      ? Math.max(1, Math.min(100, Math.round((db + 70) * (100 / 70)))) : 0;
    const silentMs = meter.zeroSince === null ? 0 : Math.max(0, now - meter.zeroSince);
    // Visual status only: 0 audio activity is NOT sufficient evidence that
    // the audience cannot hear the speaker (Voicemeeter can use another bus).
    // Deliberately no sound/silence warning or "quiet" alert state.
    const monitoring = meter.level <= this.digitalZeroFloor;

    return {
      ...base,
      state: monitoring ? 'monitoring' : 'healthy',
      levelPercent: relativeLevel,
      secondsSilent: monitoring && meter.zeroSince !== null
        ? Math.floor(silentMs / 1000) : 0,
      lastSignalAt: meter.lastSoundAt === null ? null :
        new Date(meter.lastSoundAt).toISOString(),
      warning: null,
    };
  }
}
