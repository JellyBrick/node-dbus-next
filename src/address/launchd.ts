import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Resolve the session bus address on macOS, where the D-Bus session bus is
 * managed by launchd. The socket path is exposed via the
 * `DBUS_LAUNCHD_SESSION_BUS_SOCKET` variable, which is read from the
 * environment when present, or otherwise queried through `launchctl getenv`
 * (the variable is usually scoped to the launchd session, not inherited).
 * Returns `null` when the socket cannot be located.
 */
export const getDbusAddressFromLaunchd = async (): Promise<string | null> => {
  const fromEnv = process.env.DBUS_LAUNCHD_SESSION_BUS_SOCKET;
  if (fromEnv) {
    return `unix:path=${fromEnv}`;
  }

  try {
    const { stdout } = await execFileAsync(
      'launchctl',
      ['getenv', 'DBUS_LAUNCHD_SESSION_BUS_SOCKET'],
      { encoding: 'utf8' },
    );
    const socket = stdout.trim();
    if (socket) {
      return `unix:path=${socket}`;
    }
  } catch {
    // launchctl is unavailable or the variable is unset; fall through to null
  }

  return null;
};
