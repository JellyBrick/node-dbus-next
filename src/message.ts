import {
  MessageType,
  endianness,
  headerTypeName,
  headerTypeId,
  fieldSignature,
  protocolVersion,
} from '@/constants';
import { DBusBuffer } from '@/dbus-buffer';
import { headerSignature } from '@/header-signature';
import { marshall as marshallBody } from '@/marshall';

import type { DBusBufferOptions } from '@/dbus-buffer';
import type { Readable } from 'node:stream';

export interface RawMessage {
  serial?: number | null;
  type?: number;
  flags?: number;
  signature?: string;
  body?: unknown[];
  path?: string;
  interface?: string;
  member?: string;
  errorName?: string;
  replySerial?: number;
  destination?: string;
  sender?: string;
  unixFd?: number;
}

const messageFieldNames = [
  'path',
  'interface',
  'member',
  'errorName',
  'replySerial',
  'destination',
  'sender',
  'signature',
  'unixFd',
] as const;

const extractReadResult = (readBuf: unknown): { data: Buffer; fds: number[] | null } | null => {
  if (Buffer.isBuffer(readBuf)) {
    return { data: readBuf, fds: null };
  }
  if (readBuf !== null && typeof readBuf === 'object' && 'data' in readBuf) {
    const data = readBuf.data;
    if (!Buffer.isBuffer(data)) {
      return null;
    }
    const fds = 'fds' in readBuf && Array.isArray(readBuf.fds) ? readBuf.fds : null;
    return { data, fds };
  }
  return null;
};

const parseHeaderEntry = (entry: unknown): { id: number; value: unknown } | null => {
  if (!Array.isArray(entry) || entry.length < 2) {
    return null;
  }
  const id = entry[0];
  const variant = entry[1];
  if (typeof id !== 'number' || !Array.isArray(variant) || variant.length < 2) {
    return null;
  }
  const valueArr = variant[1];
  if (!Array.isArray(valueArr)) {
    return null;
  }
  return { id, value: valueArr[0] };
};

const assignHeaderField = (msg: RawMessage, name: string, value: unknown): void => {
  switch (name) {
    case 'path':
    case 'interface':
    case 'member':
    case 'errorName':
    case 'destination':
    case 'sender':
    case 'signature':
      if (typeof value === 'string') {
        msg[name] = value;
      }
      break;
    case 'replySerial':
    case 'unixFd':
      if (typeof value === 'number') {
        msg[name] = value;
      }
      break;
    default:
      break;
  }
};

export const unmarshalMessages = (
  stream: Readable,
  onMessage: (message: RawMessage) => void,
  opts: DBusBufferOptions,
): void => {
  let state = 0; // 0: header, 1: fields + body
  let header: Buffer | null = null;
  let fieldsLength = 0;
  let fieldsLengthPadded = 0;
  let fieldsAndBodyLength = 0;
  let bodyLength = 0;
  let endian = 0;
  const LE = endianness.le;
  stream.on('readable', () => {
    while (true) {
      if (state === 0) {
        const readHeader: unknown = stream.read(16);
        if (!Buffer.isBuffer(readHeader)) {
          break;
        }
        header = readHeader;
        state = 1;

        endian = header.readUInt8(0);

        fieldsLength = endian === LE ? header.readUInt32LE(12) : header.readUInt32BE(12);
        fieldsLengthPadded = ((fieldsLength + 7) >> 3) << 3;
        bodyLength = endian === LE ? header.readUInt32LE(4) : header.readUInt32BE(4);
        fieldsAndBodyLength = fieldsLengthPadded + bodyLength;
      } else {
        const readBuf: unknown = stream.read(fieldsAndBodyLength);
        // usockets return object with { data, fds }
        const extracted = extractReadResult(readBuf);
        if (!extracted || header === null) {
          break;
        }
        state = 0;

        const headerEntry = headerSignature[0];
        const arraySignature = headerEntry?.child[0];
        if (arraySignature === undefined) {
          throw new Error('invalid header signature');
        }

        const messageBuffer = new DBusBuffer(extracted.data, 0, endian, extracted.fds, opts);
        const unmarshalledHeader = messageBuffer.readArray(arraySignature, fieldsLength);
        messageBuffer.align(3);
        const message: RawMessage = {};
        message.serial = endian === LE ? header.readUInt32LE(8) : header.readUInt32BE(8);

        if (Array.isArray(unmarshalledHeader)) {
          for (const rawEntry of unmarshalledHeader) {
            const entry = parseHeaderEntry(rawEntry);
            if (entry === null) {
              continue;
            }
            const headerName = headerTypeName[entry.id];
            if (typeof headerName === 'string') {
              assignHeaderField(message, headerName, entry.value);
            }
          }
        }

        message.type = header.readUInt8(1);
        message.flags = header.readUInt8(2);

        if (bodyLength > 0 && message.signature) {
          message.body = messageBuffer.read(message.signature);
        }
        onMessage(message);
      }
    }
  });
};

// given buffer which contains entire message deserialise it
// TODO: factor out common code
export const unmarshall = (buff: Buffer, opts?: DBusBufferOptions): RawMessage => {
  const endian = buff.readUInt8(0);
  const msgBuf = new DBusBuffer(buff, 0, endian, null, opts);
  const headers = msgBuf.read('yyyyuua(yv)');
  const message: RawMessage = {};
  const headerArray = headers[6];
  if (Array.isArray(headerArray)) {
    for (const rawEntry of headerArray) {
      const entry = parseHeaderEntry(rawEntry);
      if (entry === null) {
        continue;
      }
      const headerName = headerTypeName[entry.id];
      if (typeof headerName === 'string') {
        assignHeaderField(message, headerName, entry.value);
      }
    }
  }
  const type = headers[1];
  const flags = headers[2];
  const serial = headers[5];
  message.type = typeof type === 'number' ? type : undefined;
  message.flags = typeof flags === 'number' ? flags : undefined;
  message.serial = typeof serial === 'number' ? serial : undefined;
  msgBuf.align(3);
  if (message.signature) {
    message.body = msgBuf.read(message.signature);
  }
  return message;
};

export const marshall = (message: RawMessage): [Buffer, number[]] => {
  const serial = message.serial;
  if (!serial) throw new Error('Missing or invalid serial');
  const flags = message.flags || 0;
  const type = message.type || MessageType.METHOD_CALL;
  let bodyLength = 0;
  let bodyBuff: Buffer | undefined;
  const fds: number[] = [];
  if (message.signature && message.body) {
    bodyBuff = marshallBody(message.signature, message.body, 0, fds);
    bodyLength = bodyBuff.length;
    message.unixFd = fds.length;
  }
  const header = [endianness.le, type, flags, protocolVersion, bodyLength, serial];
  const headerBuff = marshallBody('yyyyuu', header);
  const fields: Array<[number, [string, unknown]]> = [];
  for (const fieldName of messageFieldNames) {
    const fieldVal = message[fieldName];
    if (fieldVal) {
      fields.push([headerTypeId[fieldName], [fieldSignature[fieldName], fieldVal]]);
    }
  }
  const fieldsBuff = marshallBody('a(yv)', [fields], 12);
  const headerLenAligned = ((headerBuff.length + fieldsBuff.length + 7) >> 3) << 3;
  const messageLen = headerLenAligned + bodyLength;
  const messageBuff = Buffer.alloc(messageLen);
  headerBuff.copy(messageBuff);
  fieldsBuff.copy(messageBuff, headerBuff.length);
  if (bodyLength > 0 && bodyBuff) bodyBuff.copy(messageBuff, headerLenAligned);

  return [messageBuff, fds];
};
