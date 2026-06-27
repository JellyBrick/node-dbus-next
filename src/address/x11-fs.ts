import { readFile } from 'node:fs/promises';

export const getDbusAddressFromFs = async (): Promise<string> => {
  const home = process.env.HOME;
  const display = process.env.DISPLAY;
  if (!display) {
    throw new Error('could not get DISPLAY environment variable to get dbus address');
  }

  const reg = /.*:([0-9]+)\.?.*/;
  const match = display.match(reg);

  if (!match || !match[1]) {
    throw new Error('could not parse DISPLAY environment variable to get dbus address');
  }

  const displayNum = match[1];

  const machineId = (await readFile('/var/lib/dbus/machine-id')).toString().trim();
  const dbusInfo = (await readFile(`${home}/.dbus/session-bus/${machineId}-${displayNum}`))
    .toString()
    .trim();
  for (const rawLine of dbusInfo.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('DBUS_SESSION_BUS_ADDRESS=')) {
      const value = line.split('DBUS_SESSION_BUS_ADDRESS=')[1];
      if (!value) {
        throw new Error('DBUS_SESSION_BUS_ADDRESS variable is set incorrectly in dbus info file');
      }

      const removeQuotes = /^['"]?(.*?)['"]?$/;
      const quoted = value.match(removeQuotes);
      return quoted?.[1] ?? value;
    }
  }

  throw new Error('DBUS_SESSION_BUS_ADDRESS was not set in dbus info file');
};
