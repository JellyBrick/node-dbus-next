import { describe, it, expect } from 'vitest';

import { DBusConnection } from '@/connection';

describe('connection graceful degradation (no-X / Wayland / headless)', () => {
  it('does not throw synchronously and emits an Error when no bus address can be resolved', async () => {
    const savedAddress = process.env.DBUS_SESSION_BUS_ADDRESS;
    const savedDisplay = process.env.DISPLAY;
    const savedXdg = process.env.XDG_RUNTIME_DIR;
    const savedLaunchd = process.env.DBUS_LAUNCHD_SESSION_BUS_SOCKET;
    delete process.env.DBUS_SESSION_BUS_ADDRESS;
    delete process.env.DISPLAY;
    delete process.env.XDG_RUNTIME_DIR;
    delete process.env.DBUS_LAUNCHD_SESSION_BUS_SOCKET;
    try {
      const err = await new Promise<unknown>((resolve) => {
        // constructing must NOT throw synchronously
        const conn = new DBusConnection({});
        conn.on('error', resolve);
      });
      expect(err).toBeInstanceOf(Error);
    } finally {
      if (savedAddress !== undefined) process.env.DBUS_SESSION_BUS_ADDRESS = savedAddress;
      if (savedDisplay !== undefined) process.env.DISPLAY = savedDisplay;
      if (savedXdg !== undefined) process.env.XDG_RUNTIME_DIR = savedXdg;
      if (savedLaunchd !== undefined) process.env.DBUS_LAUNCHD_SESSION_BUS_SOCKET = savedLaunchd;
    }
  });

  it('emits an Error (does not crash) when the bus address is unreachable', async () => {
    const err = await new Promise<unknown>((resolve) => {
      const conn = new DBusConnection({
        busAddress: 'unix:path=/tmp/dbus-next-nonexistent-socket-xyz',
      });
      conn.on('error', resolve);
    });
    expect(err).toBeInstanceOf(Error);
  });
});
