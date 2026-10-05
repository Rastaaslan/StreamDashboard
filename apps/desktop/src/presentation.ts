import { screen, type BrowserWindow } from 'electron';

/** Restore hidden/minimized windows, including a monitor removed since launch. */
export function presentWindow(window: BrowserWindow) {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  const bounds = window.getBounds();
  const visible = screen.getAllDisplays().some(({ workArea: area }) =>
    bounds.x < area.x + area.width && bounds.x + bounds.width > area.x &&
    bounds.y >= area.y && bounds.y < area.y + area.height);
  if (!visible) {
    const area = screen.getPrimaryDisplay().workArea;
    window.setBounds({ x: area.x, y: area.y, width: Math.min(bounds.width, area.width), height: Math.min(bounds.height, area.height) });
  }
  window.show();
  window.focus();
}
