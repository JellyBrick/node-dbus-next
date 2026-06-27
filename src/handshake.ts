import { createHash, randomBytes } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { defaultAuthMethods } from '@/constants';
import { readLine } from '@/readline';

import type { DBusStream } from '@/stream-types';

export type AuthMethod = 'EXTERNAL' | 'DBUS_COOKIE_SHA1' | 'ANONYMOUS';

export interface HandshakeOptions {
  authMethods?: string[];
}

const sha1 = (input: string): string => {
  const shasum = createHash('sha1');
  shasum.update(input);
  return shasum.digest('hex');
};

const getUserHome = (): string => {
  const home = process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'];
  if (home === undefined) {
    throw new Error('could not determine the user home directory');
  }
  return home;
};

const hexlify = (input: string): string => {
  return Buffer.from(input.toString(), 'ascii').toString('hex');
};

const getCookie = async (context: string, id: string): Promise<string> => {
  // http://dbus.freedesktop.org/doc/dbus-specification.html#auth-mechanisms-sha
  const home = getUserHome();
  const dirname = join(home, '.dbus-keyrings');
  // > There is a default context, "org_freedesktop_general" that's used by servers that do not specify otherwise.
  const ctx = context.length === 0 ? 'org_freedesktop_general' : context;
  const filename = join(dirname, ctx);

  // check it's not writable by others and readable by user
  const st = await stat(dirname);
  if (st.mode & 0o22) {
    throw new Error('User keyrings directory is writeable by other users. Aborting authentication');
  }
  const getuid = process.getuid;
  if (getuid !== undefined && st.uid !== getuid.call(process)) {
    throw new Error(
      'Keyrings directory is not owned by the current user. Aborting authentication!',
    );
  }

  const keyrings = await readFile(filename, 'ascii');
  for (const line of keyrings.split('\n')) {
    const data = line.split(' ');
    if (id === data[0] && data[2] !== undefined) {
      return data[2];
    }
  }
  throw new Error('cookie not found');
};

const negotiateUnixFd = async (stream: DBusStream): Promise<void> => {
  stream.write('NEGOTIATE_UNIX_FD\r\n');
  const res = (await readLine(stream)).toString('ascii').trim();
  if (res === 'AGREE_UNIX_FD') {
    // ok
  } else if (res === 'ERROR') {
    stream.supportsUnixFd = false;
  } else {
    throw new Error(`unix fd negotiation failed: ${res}`);
  }
  stream.write('BEGIN\r\n');
};

const tryAuth = async (stream: DBusStream, methods: string[]): Promise<string> => {
  const getuid = process.getuid;
  const uid = getuid !== undefined ? getuid.call(process) : 0;
  const id = hexlify(`${uid}`);

  for (let i = 0; i < methods.length; i++) {
    const authMethod = methods[i];

    switch (authMethod) {
      case 'EXTERNAL':
        stream.write(`AUTH ${authMethod} ${id}\r\n`);
        break;
      case 'DBUS_COOKIE_SHA1': {
        stream.write(`AUTH ${authMethod} ${id}\r\n`);
        const parts = (await readLine(stream)).toString().split(' ');
        const challenge = parts[1];
        if (challenge === undefined) {
          throw new Error('invalid DBUS_COOKIE_SHA1 challenge');
        }
        const data = Buffer.from(challenge.trim(), 'hex').toString().split(' ');
        const cookieContext = data[0] ?? '';
        const cookieId = data[1] ?? '';
        const serverChallenge = data[2] ?? '';
        // any random 16 bytes should work, sha1(rnd) to make it simplier
        const clientChallenge = randomBytes(16).toString('hex');
        const cookie = await getCookie(cookieContext, cookieId);
        const response = sha1([serverChallenge, clientChallenge, cookie].join(':'));
        const reply = hexlify(clientChallenge + response);
        stream.write(`DATA ${reply}\r\n`);
        break;
      }
      case 'ANONYMOUS':
        stream.write('AUTH ANONYMOUS \r\n');
        break;
      default:
        console.error(`Unsupported auth method: ${String(authMethod)}`);
        break;
    }

    const line = await readLine(stream);
    const ok = line.toString('ascii').match(/^([A-Za-z]+) (.*)/);
    if (ok && ok[1] === 'OK') {
      const guid = ok[2] ?? ''; // ok[2] = guid. Do we need it?
      if (stream.supportsUnixFd) {
        await negotiateUnixFd(stream);
      } else {
        stream.write('BEGIN\r\n');
      }
      return guid;
    }

    // TODO: parse error!
    if (i === methods.length - 1) {
      throw new Error(`authentication failed: ${line.toString('ascii').trim()}`);
    }
  }

  throw new Error('No authentication methods left to try');
};

export const clientHandshake = (stream: DBusStream, opts: HandshakeOptions): Promise<string> => {
  const authMethods = opts.authMethods ?? defaultAuthMethods;
  stream.write('\0');
  return tryAuth(stream, authMethods.slice());
};
