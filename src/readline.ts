import { once } from 'node:events';

import type { Readable } from 'node:stream';

export const readLine = async (stream: Readable): Promise<Buffer> => {
  const bytes: number[] = [];
  let b: number | undefined;
  while (b !== 0x0a) {
    const buf: unknown = stream.read(1);
    b = Buffer.isBuffer(buf) ? buf[0] : undefined;
    if (b === undefined) {
      await once(stream, 'readable');
    } else if (b !== 0x0a) {
      bytes.push(b);
    }
  }
  return Buffer.from(bytes);
};
