import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('widget composition', () => {
  it('switches between timed, untimed, and idle compositions from canonical state', async () => {
    const js = await readFile('web/widget/app.js', 'utf8');
    const html = await readFile('web/widget/index.html', 'utf8');
    expect(js).toContain("state.mode!=='idle' && state.timerVisible");
    expect(js).toContain('timed.hidden=!show');
    expect(js).toContain("untimed.hidden=show || state.mode==='idle'");
    expect(js).toContain("show?'timed':'untimed'");
    expect(html).toContain('class="timed"');
    expect(html).toContain('class="untimed"');
    expect(html).not.toContain('visibility: hidden');
  });

  it('keeps the OBS surface transparent and the theme modern and configurable', async () => {
    const css = await readFile('themes/campfire.css', 'utf8');
    expect(css).toMatch(/background:\s*transparent\s*!important/);
    expect(css).toContain('--overlay-y: 8%');
    expect(css).toContain('top: var(--overlay-y)');
    expect(css).toContain('--phrase-size:');
    expect(css).toContain('--timer-size:');
    expect(css).toContain('--ember-main: #bd78ff');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('.overlay[data-layout="untimed"] .glow-line');
    expect(css).not.toMatch(/Georgia|Times New Roman|#ffb36b/i);
    expect(css).not.toMatch(/bottom:\s*9%/);
  });
});
