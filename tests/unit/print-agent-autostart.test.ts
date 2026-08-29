import { describe, expect, it, vi } from 'vitest';
import { AutostartController } from '../../apps/print-agent/src/desktop/main/autostart';

describe('AutostartController', () => {
  it('starts hidden and preserves an explicit opt-out', () => {
    const app = {
      setLoginItemSettings: vi.fn(),
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    };
    const controller = new AutostartController(app);
    expect(controller.isEnabled()).toBe(false);
    controller.setEnabled(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, args: ['--hidden'] });
    controller.setEnabled(false);
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false, args: [] });
  });
});
