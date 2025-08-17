const fs = require('fs');

function getDbusAddressFromFs () {
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

  const machineId = fs.readFileSync('/var/lib/dbus/machine-id').toString().trim();
  const dbusInfo = fs.readFileSync(`${home}/.dbus/session-bus/${machineId}-${displayNum}`).toString().trim();
  for (let line of dbusInfo.split('\n')) {
    line = line.trim();
    if (line.startsWith('DBUS_SESSION_BUS_ADDRESS=')) {
      let address = line.split('DBUS_SESSION_BUS_ADDRESS=')[1];
      if (!address) {
        throw new Error('DBUS_SESSION_BUS_ADDRESS variable is set incorrectly in dbus info file');
      }

      const removeQuotes = /^['"]?(.*?)['"]?$/;
      address = address.match(removeQuotes)[1];
      return address;
    }
  }

  throw new Error('DBUS_SESSION_BUS_ADDRESS was not set in dbus info file');
}

module.exports = {
  getDbusAddressFromFs: getDbusAddressFromFs,
};
