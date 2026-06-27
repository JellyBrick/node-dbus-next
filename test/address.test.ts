import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDbusAddressFromLaunchd, getDbusAddressFromXdg } from '@/address';

describe('XDG session bus address', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a unix:path address when $XDG_RUNTIME_DIR/bus exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbus-xdg-'));
    const socket = join(dir, 'bus');
    writeFileSync(socket, '');
    vi.stubEnv('XDG_RUNTIME_DIR', dir);
    try {
      expect(await getDbusAddressFromXdg()).toEqual(`unix:path=${socket}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when the socket does not exist', async () => {
    vi.stubEnv('XDG_RUNTIME_DIR', join(tmpdir(), 'dbus-xdg-missing-987654'));
    expect(await getDbusAddressFromXdg()).toBeNull();
  });

  it('returns null when XDG_RUNTIME_DIR is not set', async () => {
    vi.stubEnv('XDG_RUNTIME_DIR', '');
    expect(await getDbusAddressFromXdg()).toBeNull();
  });
});

describe('launchd session bus address', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses DBUS_LAUNCHD_SESSION_BUS_SOCKET from the environment when set', async () => {
    vi.stubEnv('DBUS_LAUNCHD_SESSION_BUS_SOCKET', '/tmp/dbus-next-launchd-test');
    expect(await getDbusAddressFromLaunchd()).toEqual('unix:path=/tmp/dbus-next-launchd-test');
  });
});
