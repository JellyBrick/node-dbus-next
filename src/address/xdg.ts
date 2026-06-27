import { access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Resolve the session bus address from the systemd / XDG runtime directory
 * (`$XDG_RUNTIME_DIR/bus`). This is the modern session bus location and is
 * independent of the display server, so it works on both Wayland and X11.
 * Returns `null` when the socket cannot be located.
 */
export const getDbusAddressFromXdg = async (): Promise<string | null> => {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (!runtimeDir) {
    return null;
  }
  const socketPath = join(runtimeDir, 'bus');
  try {
    await access(socketPath);
  } catch {
    return null;
  }
  return `unix:path=${socketPath}`;
};
