/**
 * Utility functions to validate bus names, interface names, and object paths.
 *
 * @module validators
 */

import type { Assert } from '@/guards';

const busNameRe = /^[A-Za-z_-][A-Za-z0-9_-]*$/;
/**
 * Validate the string as a valid bus name.
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol-names-bus}
 *
 * @static
 * @param {string} name - The name to validate as a valid bus name.
 * @returns {boolean} - Whether the string is a valid bus name.
 */
export const isBusNameValid = (name: unknown): name is string => {
  if (typeof name !== 'string') {
    return false;
  }

  if (name.startsWith(':')) {
    // a unique bus name
    return true;
  }

  // a well-known bus name
  return !!(
    name.length > 0 &&
    name.length <= 255 &&
    name[0] !== '.' &&
    name.includes('.') &&
    name.split('.').every((n) => n && busNameRe.test(n))
  );
};

/**
 * Throws an error if the given string is not a valid bus name.
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol-names-bus}
 *
 * @static
 * @param {string} name - The name to validate as a bus name.
 */
export const assertBusNameValid: Assert<string> = (name) => {
  if (!isBusNameValid(name)) {
    throw new Error(`Invalid bus name: ${String(name)}`);
  }
};

const pathRe = /^[A-Za-z0-9_]+$/;
/**
 * Validate the string as a valid object path.
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol-marshaling-object-path}
 *
 * @static
 * @param {string} path - The string to validate as an object path.
 * @returns {boolean} - Whether the string is a valid object path.
 */
export const isObjectPathValid = (path: unknown): path is string => {
  return !!(
    typeof path === 'string' &&
    path &&
    path[0] === '/' &&
    (path.length === 1 ||
      (path[path.length - 1] !== '/' &&
        path
          .split('/')
          .slice(1)
          .every((p) => p && pathRe.test(p))))
  );
};

/**
 * Throws an error if the given string is not a valid object path.
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol-marshaling-object-path}
 *
 * @static
 * @param {string} path - The string to validate as an object path.
 * @returns {boolean} - Whether the string is a valid object path.
 */
export const assertObjectPathValid: Assert<string> = (path) => {
  if (!isObjectPathValid(path)) {
    throw new Error(`Invalid object path: ${String(path)}`);
  }
};

const elementRe = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * Validate the string as a valid interface name.
 * see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol-names-interface}
 *
 * @static
 * @param {string} name - The string to validate as an interface name.
 * @returns {boolean} - Whether the string is a valid interface name.
 */
export const isInterfaceNameValid = (name: unknown): name is string => {
  return !!(
    typeof name === 'string' &&
    name &&
    name.length > 0 &&
    name.length <= 255 &&
    name[0] !== '.' &&
    name.includes('.') &&
    name.split('.').every((n) => n && elementRe.test(n))
  );
};

/**
 * Throws an error if the given string is not a valid interface name.
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol-names-interface}
 *
 * @static
 * @param {string} name - The string to validate as an interface name.
 */
export const assertInterfaceNameValid: Assert<string> = (name) => {
  if (!isInterfaceNameValid(name)) {
    throw new Error(`Invalid interface name: ${String(name)}`);
  }
};

/**
 * Validate the string is a valid member name
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol-names-interface}
 *
 * @static
 * @param {string} name - The string to validate as a member name.
 * @returns {boolean} - Whether the string is a valid member name.
 */
export const isMemberNameValid = (name: unknown): name is string => {
  return !!(
    typeof name === 'string' &&
    name &&
    name.length > 0 &&
    name.length <= 255 &&
    elementRe.test(name)
  );
};

/**
 * Throws an error if the string is not a valid member name.
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol-names-interface}
 *
 * @static
 * @param {string} name - The string to validate as a member name.
 */
export const assertMemberNameValid: Assert<string> = (name) => {
  if (!isMemberNameValid(name)) {
    throw new Error(`Invalid member name: ${String(name)}`);
  }
};
