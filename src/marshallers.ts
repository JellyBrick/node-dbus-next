import { align } from '@/align';
import { _getBigIntConstants } from '@/constants';
import { parseSignature } from '@/signature';

import type { Assert } from '@/guards';
import type { Put } from '@/put';

const MASK_32 = BigInt(0xffffffff);
const SHIFT_32 = BigInt(32);

const bigIntToWords = (value: bigint): { low: number; high: number } => {
  const u = BigInt.asUintN(64, value);
  const low = Number(u & MASK_32);
  const high = Number((u >> SHIFT_32) & MASK_32);
  return { low, high };
};

export interface SimpleMarshaller {
  check(data: unknown): void;
  marshall(ps: Put, data: unknown): void;
}

/*
 * MakeSimpleMarshaller
 * @param signature - the signature of the data you want to check
 * @returns a simple marshaller with the "check" method
 *
 * check returns nothing - it only raises errors if the data is
 * invalid for the signature
 */
export const MakeSimpleMarshaller = (signature: string): SimpleMarshaller => {
  switch (signature) {
    case 'o':
    // object path
    // TODO: verify object path here?
    case 's':
      // STRING
      return {
        check(data) {
          checkValidString(data);
        },
        marshall(ps, data) {
          checkValidString(data);
          // utf8 string
          align(ps, 4);
          const buff = Buffer.from(data, 'utf8');
          ps.word32le(buff.length).put(buff).word8(0);
          ps._offset += 5 + buff.length;
        },
      };
    case 'g':
      // SIGNATURE
      return {
        check(data) {
          checkValidString(data);
          checkValidSignature(data);
        },
        marshall(ps, data) {
          checkValidString(data);
          checkValidSignature(data);
          // signature
          const buff = Buffer.from(data, 'ascii');
          ps.word8(data.length).put(buff).word8(0);
          ps._offset += 2 + buff.length;
        },
      };
    case 'y':
      // BYTE
      return {
        check(data) {
          checkInteger(data);
          checkRange(0x00, 0xff, data);
        },
        marshall(ps, data) {
          checkInteger(data);
          checkRange(0x00, 0xff, data);
          ps.word8(data);
          ps._offset++;
        },
      };
    case 'b':
      // BOOLEAN
      return {
        check(data) {
          checkBoolean(data);
        },
        marshall(ps, data) {
          checkBoolean(data);
          // booleans serialised as 0/1 unsigned 32 bit int
          const value = data ? 1 : 0;
          align(ps, 4);
          ps.word32le(value);
          ps._offset += 4;
        },
      };
    case 'n':
      // INT16
      return {
        check(data) {
          checkInteger(data);
          checkRange(-0x7fff - 1, 0x7fff, data);
        },
        marshall(ps, data) {
          checkInteger(data);
          checkRange(-0x7fff - 1, 0x7fff, data);
          align(ps, 2);
          const buff = Buffer.alloc(2);
          buff.writeInt16LE(data, 0);
          ps.put(buff);
          ps._offset += 2;
        },
      };
    case 'q':
      // UINT16
      return {
        check(data) {
          checkInteger(data);
          checkRange(0, 0xffff, data);
        },
        marshall(ps, data) {
          checkInteger(data);
          checkRange(0, 0xffff, data);
          align(ps, 2);
          ps.word16le(data);
          ps._offset += 2;
        },
      };
    case 'h':
    case 'i':
      // INT32
      return {
        check(data) {
          checkInteger(data);
          checkRange(-0x7fffffff - 1, 0x7fffffff, data);
        },
        marshall(ps, data) {
          checkInteger(data);
          checkRange(-0x7fffffff - 1, 0x7fffffff, data);
          align(ps, 4);
          const buff = Buffer.alloc(4);
          buff.writeInt32LE(data, 0);
          ps.put(buff);
          ps._offset += 4;
        },
      };
    case 'u':
      // UINT32
      return {
        check(data) {
          checkInteger(data);
          checkRange(0, 0xffffffff, data);
        },
        marshall(ps, data) {
          checkInteger(data);
          checkRange(0, 0xffffffff, data);
          // 32 t unsigned int
          align(ps, 4);
          ps.word32le(data);
          ps._offset += 4;
        },
      };
    case 't':
      // UINT64
      return {
        check(data) {
          checkLong(data, false);
        },
        marshall(ps, data) {
          const value = checkLong(data, false);
          align(ps, 8);
          const { low, high } = bigIntToWords(value);
          ps.word32le(low);
          ps.word32le(high);
          ps._offset += 8;
        },
      };
    case 'x':
      // INT64
      return {
        check(data) {
          checkLong(data, true);
        },
        marshall(ps, data) {
          const value = checkLong(data, true);
          align(ps, 8);
          const { low, high } = bigIntToWords(value);
          ps.word32le(low);
          ps.word32le(high);
          ps._offset += 8;
        },
      };
    case 'd':
      // DOUBLE
      return {
        check(data) {
          checkDouble(data);
        },
        marshall(ps, data) {
          checkDouble(data);
          align(ps, 8);
          const buff = Buffer.alloc(8);
          buff.writeDoubleLE(data, 0);
          ps.put(buff);
          ps._offset += 8;
        },
      };
    default:
      throw new Error(`Unknown data type format: ${signature}`);
  }
};

const checkValidString: Assert<string> = (data) => {
  if (typeof data !== 'string') {
    throw new Error(`Data: ${String(data)} was not of type string`);
  } else if (data.includes('\0')) {
    throw new Error('String contains null byte');
  }
};

const checkValidSignature = (data: string): void => {
  if (data.length > 0xff) {
    throw new Error(`Data: ${data} is too long for signature type (${data.length} > 255)`);
  }

  let parenCount = 0;
  for (let ii = 0; ii < data.length; ++ii) {
    if (parenCount > 32) {
      throw new Error(`Maximum container type nesting exceeded in signature type:${data}`);
    }
    switch (data[ii]) {
      case '(':
        ++parenCount;
        break;
      case ')':
        --parenCount;
        break;
      default:
        /* no-op */
        break;
    }
  }
  parseSignature(data);
};

const checkRange = (minValue: number, maxValue: number, data: number): void => {
  if (data > maxValue || data < minValue) {
    throw new Error('Number outside range');
  }
};

const checkInteger: Assert<number> = (data) => {
  if (typeof data !== 'number') {
    throw new Error(`Data: ${String(data)} was not of type number`);
  }
  if (Math.floor(data) !== data) {
    throw new Error(`Data: ${String(data)} was not an integer`);
  }
};

const checkBoolean: Assert<boolean | 0 | 1> = (data) => {
  if (!(typeof data === 'boolean' || data === 0 || data === 1)) {
    throw new Error(`Data: ${String(data)} was not of type boolean`);
  }
};

const checkDouble: Assert<number> = (data) => {
  if (typeof data !== 'number') {
    throw new Error(`Data: ${String(data)} was not of type number`);
  } else if (Number.isNaN(data)) {
    throw new Error(`Data: ${String(data)} was not a number`);
  } else if (!Number.isFinite(data)) {
    throw new Error('Number outside range');
  }
};

const checkLong = (data: unknown, signed: boolean): bigint => {
  const { MAX_INT64, MIN_INT64, MAX_UINT64, MIN_UINT64 } = _getBigIntConstants();

  let value: bigint;
  if (typeof data === 'bigint') {
    value = data;
  } else if (typeof data === 'number' || typeof data === 'string') {
    value = BigInt(data);
  } else {
    throw new Error(`Data: ${String(data)} could not be converted to a 64-bit integer`);
  }

  if (signed) {
    if (value > MAX_INT64) {
      throw new Error('data was out of range (greater than max int64)');
    } else if (value < MIN_INT64) {
      throw new Error('data was out of range (less than min int64)');
    }
  } else {
    if (value > MAX_UINT64) {
      throw new Error('data was out of range (greater than max uint64)');
    } else if (value < MIN_UINT64) {
      throw new Error('data was out of range (less than min uint64)');
    }
  }

  return value;
};
