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

interface ServerReply {
  command: string;
  args: string;
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

const readReply = async (stream: DBusStream): Promise<ServerReply> => {
  const line = (await readLine(stream)).toString('ascii').trim();
  const separator = line.indexOf(' ');
  if (separator === -1) {
    return { command: line, args: '' };
  }
  return { command: line.slice(0, separator), args: line.slice(separator + 1) };
};

const cancel = (stream: DBusStream): Promise<ServerReply> => {
  stream.write('CANCEL\r\n');
  return readReply(stream);
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

const answerCookieChallenge = async (stream: DBusStream, challenge: string): Promise<void> => {
  const [cookieContext = '', cookieId = '', serverChallenge = ''] = Buffer.from(challenge, 'hex')
    .toString()
    .split(' ');
  // any random 16 bytes should work, sha1(rnd) to make it simplier
  const clientChallenge = randomBytes(16).toString('hex');
  const cookie = await getCookie(cookieContext, cookieId);
  const response = sha1([serverChallenge, clientChallenge, cookie].join(':'));
  stream.write(`DATA ${hexlify(`${clientChallenge} ${response}`)}\r\n`);
};

const authenticate = async (
  stream: DBusStream,
  authMethod: string,
  id: string,
): Promise<ServerReply | undefined> => {
  switch (authMethod) {
    case 'EXTERNAL':
    case 'DBUS_COOKIE_SHA1':
      stream.write(`AUTH ${authMethod} ${id}\r\n`);
      break;
    case 'ANONYMOUS':
      stream.write('AUTH ANONYMOUS \r\n');
      break;
    default:
      console.error(`Unsupported auth method: ${String(authMethod)}`);
      return undefined;
  }

  let reply = await readReply(stream);
  if (reply.command === 'DATA' && authMethod === 'DBUS_COOKIE_SHA1') {
    try {
      await answerCookieChallenge(stream, reply.args);
    } catch {
      return cancel(stream);
    }
    reply = await readReply(stream);
  }
  if (reply.command === 'DATA' || reply.command === 'ERROR') {
    return cancel(stream);
  }
  return reply;
};

const tryAuth = async (stream: DBusStream, methods: string[]): Promise<string> => {
  const getuid = process.getuid;
  const uid = getuid !== undefined ? getuid.call(process) : 0;
  const id = hexlify(`${uid}`);

  let serverMechanisms: Set<string> | undefined;
  let lastReply: ServerReply | undefined;
  for (const authMethod of methods) {
    if (serverMechanisms !== undefined && !serverMechanisms.has(authMethod)) {
      continue;
    }

    const reply = await authenticate(stream, authMethod, id);
    if (reply === undefined) {
      continue;
    }
    if (reply.command === 'OK') {
      const guid = reply.args;
      if (stream.supportsUnixFd) {
        await negotiateUnixFd(stream);
      } else {
        stream.write('BEGIN\r\n');
      }
      return guid;
    }
    if (reply.command === 'REJECTED' && reply.args !== '') {
      serverMechanisms = new Set(reply.args.split(' '));
    }
    lastReply = reply;
  }

  if (lastReply === undefined) {
    throw new Error('No authentication methods left to try');
  }
  throw new Error(`authentication failed: ${lastReply.command} ${lastReply.args}`.trimEnd());
};

export const clientHandshake = (stream: DBusStream, opts: HandshakeOptions): Promise<string> => {
  const authMethods = opts.authMethods ?? defaultAuthMethods;
  stream.write('\0');
  return tryAuth(stream, authMethods.slice());
};
