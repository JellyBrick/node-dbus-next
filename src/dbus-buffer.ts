import { endianness } from '@/constants';
import { parseSignature } from '@/signature';

import type { SignatureNode } from '@/signature';

const LE = endianness.le;
const SHIFT_32 = BigInt(32);

export interface DBusBufferOptions {
  ayBuffer?: boolean;
}

// Buffer + position + global start position ( used in alignment )
export class DBusBuffer {
  options: { ayBuffer: boolean };
  buffer: Buffer;
  endian: number;
  fds: number[] | null | undefined;
  startPos: number;
  pos: number;

  constructor(
    buffer: Buffer,
    startPos: number | undefined,
    endian: number,
    fds?: number[] | null,
    options?: DBusBufferOptions,
  ) {
    this.options = {
      ayBuffer: options?.ayBuffer === undefined ? true : options.ayBuffer,
    };
    this.buffer = buffer;
    this.endian = endian;
    this.fds = fds;
    this.startPos = startPos || 0;
    this.pos = 0;
  }

  align(power: number): void {
    const allbits = (1 << power) - 1;
    const paddedOffset = ((this.pos + this.startPos + allbits) >> power) << power;
    this.pos = paddedOffset - this.startPos;
  }

  readInt8(): number {
    this.pos++;
    return this.buffer[this.pos - 1] ?? 0;
  }

  readSInt16(): number {
    this.align(1);

    const res =
      this.endian === LE ? this.buffer.readInt16LE(this.pos) : this.buffer.readInt16BE(this.pos);

    this.pos += 2;
    return res;
  }

  readInt16(): number {
    this.align(1);

    const res =
      this.endian === LE ? this.buffer.readUInt16LE(this.pos) : this.buffer.readUInt16BE(this.pos);

    this.pos += 2;
    return res;
  }

  readSInt32(): number {
    this.align(2);

    const res =
      this.endian === LE ? this.buffer.readInt32LE(this.pos) : this.buffer.readInt32BE(this.pos);

    this.pos += 4;
    return res;
  }

  readInt32(): number {
    this.align(2);

    const res =
      this.endian === LE ? this.buffer.readUInt32LE(this.pos) : this.buffer.readUInt32BE(this.pos);

    this.pos += 4;
    return res;
  }

  readDouble(): number {
    this.align(3);

    const res =
      this.endian === LE ? this.buffer.readDoubleLE(this.pos) : this.buffer.readDoubleBE(this.pos);

    this.pos += 8;
    return res;
  }

  readString(len: number): string {
    if (len === 0) {
      this.pos++;
      return '';
    }
    const res = this.buffer.toString('utf8', this.pos, this.pos + len);
    this.pos += len + 1; // dbus strings are always zero-terminated ('s' and 'g' types)
    return res;
  }

  readTree(tree: SignatureNode): unknown {
    switch (tree.type) {
      case '(':
      case '{':
      case 'r':
        this.align(3);
        return this.readStruct(tree.child);
      case 'a': {
        if (!tree.child || tree.child.length !== 1) {
          throw new Error('Incorrect array element signature');
        }
        const childType = tree.child[0];
        if (childType === undefined) {
          throw new Error('Incorrect array element signature');
        }
        return this.readArray(childType, this.readInt32());
      }
      case 'v':
        return this.readVariant();
      default:
        return this.readSimpleType(tree.type);
    }
  }

  read(signature: string): unknown[] {
    const tree = parseSignature(signature);
    return this.readStruct(tree);
  }

  readVariant(): [SignatureNode[], unknown[]] {
    const signature = this.readSimpleType('g');
    if (typeof signature !== 'string') {
      throw new Error('variant signature was not a string');
    }
    const tree = parseSignature(signature);
    return [tree, this.readStruct(tree)];
  }

  readStruct(struct: SignatureNode[]): unknown[] {
    const result: unknown[] = [];
    for (const ele of struct) {
      result.push(this.readTree(ele));
    }
    return result;
  }

  readArray(eleType: SignatureNode, arrayBlobSize: number): unknown[] | Buffer {
    const start = this.pos;

    // special case: treat ay as Buffer
    if (eleType.type === 'y' && this.options.ayBuffer) {
      this.pos += arrayBlobSize;
      return this.buffer.subarray(start, this.pos);
    }

    // end of array is start of first element + array size
    // we need to add 4 bytes if not on 8-byte boundary
    // and array element needs 8 byte alignment
    if (['x', 't', 'd', '{', '(', 'r'].includes(eleType.type)) {
      this.align(3);
    }
    const end = this.pos + arrayBlobSize;
    const result: unknown[] = [];
    while (this.pos < end) {
      result.push(this.readTree(eleType));
    }
    return result;
  }

  readSimpleType(t: string): number | bigint | string | boolean {
    let len: number;
    let word0: number;
    let word1: number;
    switch (t) {
      case 'y':
        return this.readInt8();
      case 'b':
        // TODO: spec says that true is strictly 1 and false is strictly 0
        // shold we error (or warn?) when non 01 values?
        return !!this.readInt32();
      case 'n':
        return this.readSInt16();
      case 'q':
        return this.readInt16();
      case 'h': {
        const idx = this.readInt32();
        if (!this.fds || this.fds.length <= idx) throw new Error('No FDs available');
        const fd = this.fds[idx];
        if (fd === undefined) throw new Error('No FDs available');
        return fd;
      }
      case 'u':
        return this.readInt32();
      case 'i':
        return this.readSInt32();
      case 'g':
        len = this.readInt8();
        return this.readString(len);
      case 's':
      case 'o':
        len = this.readInt32();
        return this.readString(len);
      // TODO: validate object path here
      // if (t === 'o' && !isValidObjectPath(str))
      //  throw new Error('string is not a valid object path'));
      case 'x': {
        // signed
        this.align(3);
        word0 = this.readInt32();
        word1 = this.readInt32();
        const combined = (BigInt(word1) << SHIFT_32) | BigInt(word0);
        return BigInt.asIntN(64, combined);
      }
      case 't': {
        // unsigned
        this.align(3);
        word0 = this.readInt32();
        word1 = this.readInt32();
        const combined = (BigInt(word1) << SHIFT_32) | BigInt(word0);
        return BigInt.asUintN(64, combined);
      }
      case 'd':
        return this.readDouble();
      default:
        throw new Error(`Unsupported type: ${t}`);
    }
  }
}
