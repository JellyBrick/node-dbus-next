import type { Readable } from 'node:stream';

const closedError = (): Error => new Error('stream closed while waiting for a line');

const waitForReadable = (stream: Readable): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!stream.readable) {
      reject(closedError());
      return;
    }
    const onReadable = (): void => {
      cleanup();
      resolve();
    };
    const onClose = (): void => {
      cleanup();
      reject(closedError());
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const cleanup = (): void => {
      stream.off('readable', onReadable);
      stream.off('end', onClose);
      stream.off('close', onClose);
      stream.off('error', onError);
    };
    stream.on('readable', onReadable);
    stream.on('end', onClose);
    stream.on('close', onClose);
    stream.on('error', onError);
  });
};

export const readLine = async (stream: Readable): Promise<Buffer> => {
  const bytes: number[] = [];
  let b: number | undefined;
  while (b !== 0x0a) {
    const buf: unknown = stream.read(1);
    b = Buffer.isBuffer(buf) ? buf[0] : undefined;
    if (b === undefined) {
      await waitForReadable(stream);
    } else if (b !== 0x0a) {
      bytes.push(b);
    }
  }
  return Buffer.from(bytes);
};
