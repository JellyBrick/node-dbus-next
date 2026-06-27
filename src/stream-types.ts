import type { Duplex } from 'node:stream';

export interface DBusStream extends Duplex {
  supportsUnixFd?: boolean;
  setNoDelay?(noDelay?: boolean): this;
}
