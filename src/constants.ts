/**
 * @class
 *
 * A flag enum for {@link MessageBus#requestName} to configure the name request
 * options.
 *
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#bus-messages-request-name}
 */
export class NameFlag {
  /**
   * This name allows other clients to replace it as the name owner on a request.
   *
   * @memberof NameFlag
   * @static
   * @constant
   */
  static readonly ALLOW_REPLACEMENT = 1;

  /**
   * This request should replace an existing name if that name allows
   * replacement.
   *
   * @memberof NameFlag
   * @static
   * @constant
   */
  static readonly REPLACE_EXISTING = 2;

  /**
   * This request should not enter the queue of clients requesting this name if
   * it is taken.
   *
   * @memberof NameFlag
   * @static
   * @constant
   */
  static readonly DO_NOT_QUEUE = 4;
}

/**
 * @class
 *
 * An enum for the return value of {@link MessageBus#requestName} to indicate
 * the status of the name request.
 *
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#bus-messages-request-name}
 */
export class RequestNameReply {
  /**
   * The application trying to request ownership of a name is already the owner
   * of it.
   *
   * @memberof RequestNameReply
   * @static
   * @constant
   */
  static readonly PRIMARY_OWNER = 1;

  /**
   * The name already had an owner, `DBUS_NAME_FLAG_DO_NOT_QUEUE` was not
   * specified, and either the current owner did not specify
   * `DBUS_NAME_FLAG_ALLOW_REPLACEMENT` or the requesting application did not
   * specify `DBUS_NAME_FLAG_REPLACE_EXISTING`.
   *
   * @memberof RequestNameReply
   * @static
   * @constant
   */
  static readonly IN_QUEUE = 2;

  /**
   * The name already has an owner, `DBUS_NAME_FLAG_DO_NOT_QUEUE` was specified,
   * and either `DBUS_NAME_FLAG_ALLOW_REPLACEMENT` was not specified by the
   * current owner, or `DBUS_NAME_FLAG_REPLACE_EXISTING` was not specified by the
   * requesting application.
   *
   * @memberof RequestNameReply
   * @static
   * @constant
   */
  static readonly EXISTS = 3;

  /**
   * The application trying to request ownership of a name is already the owner
   * of it.
   *
   * @memberof RequestNameReply
   * @static
   * @constant
   */
  static readonly ALREADY_OWNER = 4;
}

/**
 * @class
 *
 * An enum for the return value of {@link MessageBus#releaseName} to indicate
 * the status of the release name request.
 *
 * @see {@link https://dbus.freedesktop.org/doc/dbus-specification.html#bus-messages-release-name}
 */
export class ReleaseNameReply {
  /**
   * The caller has released his claim on the given name. Either the caller was
   * the primary owner of the name, and the name is now unused or taken by
   * somebody waiting in the queue for the name, or the caller was waiting in the
   * queue for the name and has now been removed from the queue.
   *
   * @memberof ReleaseNameReply
   * @static
   * @constant
   */
  static readonly RELEASED = 1;

  /**
   * The given name does not exist on this bus.
   *
   * @memberof ReleaseNameReply
   * @static
   * @constant
   */
  static readonly NON_EXISTENT = 2;

  /**
   * The caller was not the primary owner of this name, and was also not waiting
   * in the queue to own this name.
   *
   * @memberof ReleaseNameReply
   * @static
   * @constant
   */
  static readonly NOT_OWNER = 3;
}

/**
 * @class
 *
 * An enum value for the {@link Message} `type` member to indicate the type of message.
 *
 * @see https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol
 */
export class MessageType {
  /**
   * The message is a method call.
   *
   * @memberof MessageType
   * @static
   * @constant
   */
  static readonly METHOD_CALL = 1;

  /**
   * The message is a method return to a previous call.
   *
   * @memberof MessageType
   * @static
   * @constant
   */
  static readonly METHOD_RETURN = 2;

  /**
   * The message is an error reply.
   *
   * @memberof MessageType
   * @static
   * @constant
   */
  static readonly ERROR = 3;

  /**
   * The message is a signal.
   *
   * @memberof MessageType
   * @static
   * @constant
   */
  static readonly SIGNAL = 4;
}

/**
 * @class
 *
 * An flag enum for the {@link Message} `flags` member to configure behavior
 * for message processing.
 *
 * @see https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol
 */
export class MessageFlag {
  /**
   * No reply is expected from this message.
   *
   * @memberof MessageFlag
   * @static
   * @constant
   */
  static readonly NO_REPLY_EXPECTED = 1;

  /**
   * This message should not autostart a service.
   *
   * @memberof MessageFlag
   * @static
   * @constant
   */
  static readonly NO_AUTO_START = 2;
}

export const MAX_INT64_STR = '9223372036854775807';
export const MIN_INT64_STR = '-9223372036854775807';
export const MAX_UINT64_STR = '18446744073709551615';
export const MIN_UINT64_STR = '0';

export interface BigIntConstants {
  MAX_INT64: bigint;
  MIN_INT64: bigint;
  MAX_UINT64: bigint;
  MIN_UINT64: bigint;
}

let _BigIntConstants: BigIntConstants | null = null;

export const _getBigIntConstants = (): BigIntConstants => {
  if (_BigIntConstants !== null) {
    return _BigIntConstants;
  }

  _BigIntConstants = {
    MAX_INT64: BigInt(MAX_INT64_STR),
    MIN_INT64: BigInt(MIN_INT64_STR),
    MAX_UINT64: BigInt(MAX_UINT64_STR),
    MIN_UINT64: BigInt(MIN_UINT64_STR),
  };

  return _BigIntConstants;
};

export const headerTypeName: readonly (string | null)[] = [
  null,
  'path',
  'interface',
  'member',
  'errorName',
  'replySerial',
  'destination',
  'sender',
  'signature',
  'unixFd',
];

// TODO: merge to single hash? e.g path -> [1, 'o']
export const fieldSignature = {
  path: 'o',
  interface: 's',
  member: 's',
  errorName: 's',
  replySerial: 'u',
  destination: 's',
  sender: 's',
  signature: 'g',
  unixFd: 'u',
} as const;

export const headerTypeId = {
  path: 1,
  interface: 2,
  member: 3,
  errorName: 4,
  replySerial: 5,
  destination: 6,
  sender: 7,
  signature: 8,
  unixFd: 9,
} as const;

export const protocolVersion = 1;

export const endianness = {
  le: 108,
  be: 66,
} as const;

export const messageSignature = 'yyyyuua(yv)';

export const defaultAuthMethods = ['EXTERNAL', 'DBUS_COOKIE_SHA1', 'ANONYMOUS'];
