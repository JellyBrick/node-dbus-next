import { getDbusAddressFromLaunchd } from './launchd';
import { getDbusAddressFromFs } from './x11-fs';
import { getDbusAddressFromXdg } from './xdg';

/**
 * Discover the session bus address using platform-aware fallbacks. This is
 * tried after an explicit `busAddress` option and the
 * `DBUS_SESSION_BUS_ADDRESS` environment variable. Throws if no address can be
 * determined.
 */
export const resolveSessionBusAddress = async (): Promise<string> => {
  if (process.platform === 'darwin') {
    const fromLaunchd = await getDbusAddressFromLaunchd();
    if (fromLaunchd !== null) {
      return fromLaunchd;
    }
  }

  const fromXdg = await getDbusAddressFromXdg();
  if (fromXdg !== null) {
    return fromXdg;
  }

  // legacy X11 fallback (~/.dbus/session-bus keyed by $DISPLAY)
  try {
    return await getDbusAddressFromFs();
  } catch {
    const tried =
      process.platform === 'darwin'
        ? 'launchd, $XDG_RUNTIME_DIR/bus, and the X11 session bus file'
        : '$XDG_RUNTIME_DIR/bus and the X11 session bus file';
    throw new Error(`could not determine the D-Bus session bus address (tried ${tried})`);
  }
};
