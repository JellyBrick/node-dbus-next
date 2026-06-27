export class Put {
  _offset = 0;
  private readonly chunks: Buffer[] = [];

  word8(value: number): this {
    const buf = Buffer.alloc(1);
    buf.writeUInt8(value & 0xff, 0);
    this.chunks.push(buf);
    return this;
  }

  word16le(value: number): this {
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(value & 0xffff, 0);
    this.chunks.push(buf);
    return this;
  }

  word32le(value: number): this {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(value >>> 0, 0);
    this.chunks.push(buf);
    return this;
  }

  put(buffer: Buffer): this {
    this.chunks.push(buffer);
    return this;
  }

  buffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

export const put = (): Put => {
  return new Put();
};
