const libraryOptions = {
  bigIntCompat: false,
};

export const getBigIntCompat = (): boolean => {
  return libraryOptions.bigIntCompat;
};

export const setBigIntCompat = (val: boolean): void => {
  if (typeof val !== 'boolean') {
    throw new Error('dbus.setBigIntCompat() must be called with a boolean parameter');
  }
  libraryOptions.bigIntCompat = val;
};
