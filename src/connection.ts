import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createConnection as netCreateConnection } from 'node:net';
import { Duplex } from 'node:stream';

import { resolveSessionBusAddress } from '@/address';
import { clientHandshake } from '@/handshake';
import { messageToJsFmt, marshallMessage } from '@/marshall-compat';
import { unmarshalMessages } from '@/message';
import { Message } from '@/message-type';

import type { DBusBufferOptions } from '@/dbus-buffer';
import type { AuthMethod, HandshakeOptions } from '@/handshake';
import type { RawMessage } from '@/message';
import type { DBusStream } from '@/stream-types';

export interface ConnectionOptions extends HandshakeOptions, DBusBufferOptions {
  busAddress?: string;
  negotiateUnixFd?: boolean;
}

export interface SystemBusOptions {
  negotiateUnixFd?: boolean;
}

export interface SessionBusOptions {
  authMethods?: AuthMethod[];
  busAddress?: string;
}

const createStream = async (opts: ConnectionOptions): Promise<DBusStream> => {
  // TODO according to the dbus spec, we should start a new server if the bus
  // address cannot be found.
  let busAddress = opts.busAddress;
  if (!busAddress) {
    busAddress = process.env.DBUS_SESSION_BUS_ADDRESS;
  }
  if (!busAddress) {
    busAddress = await resolveSessionBusAddress();
  }

  const addresses = busAddress.split(';');
  for (let i = 0; i < addresses.length; ++i) {
    const address = addresses[i];
    const isLast = i === addresses.length - 1;
    if (address === undefined) {
      continue;
    }
    const familyParams = address.split(':');
    const family = familyParams[0];
    const paramsStr = familyParams[1];
    if (family === undefined || paramsStr === undefined) {
      if (!isLast) {
        continue;
      }
      throw new Error(`invalid bus address (missing parameters): ${address}`);
    }
    const params: Record<string, string> = {};
    paramsStr.split(',').forEach(function (p) {
      const eq = p.indexOf('=');
      if (eq > 0) {
        params[p.slice(0, eq)] = p.slice(eq + 1);
      }
    });

    try {
      switch (family.toLowerCase()) {
        case 'tcp': {
          const host = params.host || 'localhost';
          const port = params.port;
          if (!port) {
            throw new Error(
              "not enough parameters for 'tcp' connection. you need to specify a 'port'",
            );
          }
          return netCreateConnection(Number(port), host);
        }
        case 'unix': {
          if (params.socket) {
            return netCreateConnection(params.socket);
          }
          if (params.abstract) {
            return netCreateConnection('\u0000' + params.abstract);
          }
          if (params.path) {
            return netCreateConnection(params.path);
          }
          throw new Error(
            "not enough parameters for 'unix' connection. you need to specify 'socket' or 'abstract' or 'path' parameter",
          );
        }
        case 'unixexec': {
          const command = params.path;
          if (!command) {
            throw new Error(
              "not enough parameters for 'unixexec' connection. you need to specify a 'path'",
            );
          }
          const args: string[] = [];
          for (let n = 1; ; n++) {
            const arg = params[`arg${n}`];
            if (arg === undefined) {
              break;
            }
            args.push(arg);
          }
          const child = spawn(command, args);
          const childStdout = child.stdout;
          const childStdin = child.stdin;
          if (!childStdout || !childStdin) {
            throw new Error('failed to open stdio for unixexec connection');
          }
          const stream: DBusStream = new Duplex({
            read() {},
            write(chunk, _encoding, callback) {
              childStdin.write(chunk, (err) => callback(err));
            },
          });
          childStdout.on('data', (chunk) => stream.push(chunk));
          childStdout.on('end', () => stream.push(null));
          childStdout.on('error', (err) => stream.destroy(err));
          // duplex socket is auto connected so emit connect event next tick
          queueMicrotask(() => stream.emit('connect'));
          return stream;
        }
        default: {
          throw new Error('unknown address type:' + family);
        }
      }
    } catch (e) {
      if (!isLast) {
        console.warn(e instanceof Error ? e.message : String(e));
        continue;
      }
      throw e;
    }
  }
  throw new Error(`could not connect to any bus address: ${busAddress}`);
};

interface DBusConnectionEvents {
  connect: [];
  message: [message: Message];
  end: [];
}

export class DBusConnection extends EventEmitter<DBusConnectionEvents> {
  stream?: DBusStream;
  guid?: string;
  state?: 'connected' | 'ended';
  private readonly _messages: RawMessage[] = [];
  private readonly _opts: ConnectionOptions;

  constructor(opts?: ConnectionOptions) {
    super();
    this._opts = opts ?? {};

    // pre-connect: buffer messages until connected, then flush
    this.once('connect', () => {
      this.state = 'connected';
      for (const msg of this._messages) {
        this._write(msg);
      }
      this._messages.length = 0;
    });

    // resolving the bus address (or opening the socket) failed; surface the
    // error so the caller has a chance to attach an 'error' listener instead of
    // getting a synchronous throw
    createStream(this._opts)
      .then((stream) => {
        this._wireStream(stream);
      })
      .catch((err: unknown) => {
        this.emit('error', err);
      });
  }

  private _wireStream(stream: DBusStream): void {
    this.stream = stream;
    stream.setNoDelay?.();

    stream.on('error', (err: Error) => {
      // forward network and stream errors
      this.emit('error', err);
    });

    stream.on('end', () => {
      this.emit('end');
      this.state = 'ended';
    });

    const afterHandshake = (guid: string): void => {
      this.guid = guid;
      this.emit('connect');
      unmarshalMessages(
        stream,
        (rawMessage) => {
          try {
            this.emit('message', new Message(messageToJsFmt(rawMessage)));
          } catch (err) {
            this.emit('error', err);
            return;
          }
        },
        this._opts,
      );
    };

    stream.once('connect', () => {
      clientHandshake(stream, this._opts)
        .then(afterHandshake)
        .catch((err: unknown) => {
          this.emit('error', err);
        });
    });
  }

  private _write(msg: RawMessage): void {
    const stream = this.stream;
    if (!stream || !stream.writable) {
      throw new Error('Cannot send message, stream is closed');
    }
    const [data, fds] = marshallMessage(msg);
    if (stream.supportsUnixFd) {
      stream.write({ data, fds });
    } else {
      if (fds.length > 0) {
        console.warn('Sending file descriptors is not supported in current bus connection');
      }
      stream.write(data);
    }
  }

  message(msg: RawMessage): void {
    if (this.state !== 'connected') {
      this._messages.push(msg);
      return;
    }
    this._write(msg);
  }

  end(): this {
    this.stream?.end();
    return this;
  }
}

export const createConnection = (opts?: ConnectionOptions) => new DBusConnection(opts);
