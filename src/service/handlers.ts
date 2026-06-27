import { readFileSync } from 'node:fs';

import { MessageType } from '@/constants';
import { DBusError } from '@/errors';
import { Message } from '@/message-type';
import { isObjectPathValid, isInterfaceNameValid, isMemberNameValid } from '@/validators';
import { Variant } from '@/variant';

import { ACCESS_READ, ACCESS_WRITE, ACCESS_READWRITE, invokeMethod } from './interface';

import type { ServiceBus } from './types';

const { METHOD_RETURN } = MessageType;

const INVALID_ARGS = 'org.freedesktop.DBus.Error.InvalidArgs';

const errorStack = (e: unknown): string => {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
};

const sendServiceError = (bus: ServiceBus, msg: Message, errorMessage: string): void => {
  bus.send(
    Message.newError(msg, 'com.github.dbus_next.ServiceError', `Service error: ${errorMessage}`),
  );
};

const handleIntrospect = (bus: ServiceBus, msg: Message, path: string): void => {
  bus.send(Message.newMethodReturn(msg, 's', [bus._introspect(path)]));
};

const handleGetProperty = (bus: ServiceBus, msg: Message, path: string): void => {
  const ifaceName = msg.body[0];
  const prop = msg.body[1];

  if (!bus._serviceObjects[path]) {
    bus.send(Message.newError(msg, INVALID_ARGS, `Path not exported on bus: '${path}'`));
    return;
  }

  const obj = bus._getServiceObject(path);
  const iface = typeof ifaceName === 'string' ? obj.interfaces[ifaceName] : undefined;
  // TODO An empty string may be provided for the interface name; in this case,
  // if there are multiple properties on an object with the same name, the
  // results are undefined (picking one by according to an arbitrary
  // deterministic rule, or returning an error, are the reasonable
  // possibilities).
  if (!iface) {
    bus.send(Message.newError(msg, INVALID_ARGS, `No such interface: '${String(ifaceName)}'`));
    return;
  }

  const properties = iface.$properties ?? {};

  let options = null;
  let propertyKey = null;
  for (const k of Object.keys(properties)) {
    const candidate = properties[k];
    if (candidate !== undefined && candidate.name === prop && !candidate.disabled) {
      options = candidate;
      propertyKey = k;
      break;
    }
  }
  if (options === null || propertyKey === null) {
    bus.send(Message.newError(msg, INVALID_ARGS, `No such property: '${String(prop)}'`));
    return;
  }

  let propertyValue: unknown;

  try {
    propertyValue = Reflect.get(iface, propertyKey);
  } catch (e) {
    if (e instanceof DBusError) {
      bus.send(Message.newError(msg, e.type, e.text));
    } else {
      sendServiceError(bus, msg, `The service threw an error.\n${errorStack(e)}`);
    }
    return;
  }

  if (propertyValue instanceof DBusError) {
    bus.send(Message.newError(msg, propertyValue.type, propertyValue.text));
    return;
  } else if (propertyValue === undefined) {
    sendServiceError(bus, msg, 'tried to get a property that is not set: ' + String(prop));
    return;
  }

  if (!(options.access === ACCESS_READWRITE || options.access === ACCESS_READ)) {
    bus.send(
      Message.newError(msg, INVALID_ARGS, `Property does not have read access: '${String(prop)}'`),
    );
  }

  const body = new Variant(options.signature, propertyValue);

  bus.send(Message.newMethodReturn(msg, 'v', [body]));
};

const handleGetAllProperties = (bus: ServiceBus, msg: Message, path: string): void => {
  const ifaceName = msg.body[0];

  if (!bus._serviceObjects[path]) {
    bus.send(Message.newError(msg, INVALID_ARGS, `Path not exported on bus: '${path}'`));
    return;
  }

  const obj = bus._getServiceObject(path);
  const iface = typeof ifaceName === 'string' ? obj.interfaces[ifaceName] : undefined;

  const result: Record<string, Variant> = {};
  if (iface) {
    const properties = iface.$properties ?? {};
    for (const k of Object.keys(properties)) {
      const p = properties[k];
      if (
        p === undefined ||
        !(p.access === ACCESS_READ || p.access === ACCESS_READWRITE) ||
        p.disabled
      ) {
        continue;
      }

      let value: unknown;
      try {
        value = Reflect.get(iface, k);
      } catch (e) {
        if (e instanceof DBusError) {
          bus.send(Message.newError(msg, e.type, e.text));
        } else {
          sendServiceError(bus, msg, `The service threw an error.\n${errorStack(e)}`);
        }
        return;
      }
      if (value instanceof DBusError) {
        bus.send(Message.newError(msg, value.type, value.text));
        return;
      } else if (value === undefined) {
        sendServiceError(bus, msg, 'tried to get a property that is not set: ' + p.name);
        return;
      }

      result[p.name] = new Variant(p.signature, value);
    }
  }

  bus.send(Message.newMethodReturn(msg, 'a{sv}', [result]));
};

const handleSetProperty = (bus: ServiceBus, msg: Message, path: string): void => {
  const ifaceName = msg.body[0];
  const prop = msg.body[1];
  const value = msg.body[2];

  if (!bus._serviceObjects[path]) {
    bus.send(Message.newError(msg, INVALID_ARGS, `Path not exported on bus: '${path}'`));
    return;
  }

  const obj = bus._getServiceObject(path);
  const iface = typeof ifaceName === 'string' ? obj.interfaces[ifaceName] : undefined;

  if (!iface) {
    bus.send(Message.newError(msg, INVALID_ARGS, `Interface not found: '${String(ifaceName)}'`));
    return;
  }

  const properties = iface.$properties ?? {};
  let options = null;
  let propertyKey = null;
  for (const k of Object.keys(properties)) {
    const candidate = properties[k];
    if (candidate !== undefined && candidate.name === prop && !candidate.disabled) {
      options = candidate;
      propertyKey = k;
      break;
    }
  }

  if (options === null || propertyKey === null) {
    bus.send(Message.newError(msg, INVALID_ARGS, `No such property: '${String(prop)}'`));
    return;
  }

  if (!(options.access === ACCESS_WRITE || options.access === ACCESS_READWRITE)) {
    bus.send(
      Message.newError(msg, INVALID_ARGS, `Property does not have write access: '${String(prop)}'`),
    );
  }

  if (!(value instanceof Variant)) {
    bus.send(
      Message.newError(
        msg,
        INVALID_ARGS,
        `Cannot set property '${String(prop)}' with a non-variant value`,
      ),
    );
    return;
  }

  if (value.signature !== options.signature) {
    bus.send(
      Message.newError(
        msg,
        INVALID_ARGS,
        `Cannot set property '${String(prop)}' with signature '${value.signature}' (expected '${options.signature}')`,
      ),
    );
    return;
  }

  try {
    Reflect.set(iface, propertyKey, value.value);
  } catch (e) {
    if (e instanceof DBusError) {
      bus.send(Message.newError(msg, e.type, e.text));
    } else {
      sendServiceError(bus, msg, `The service threw an error.\n${errorStack(e)}`);
    }
    return;
  }

  bus.send(Message.newMethodReturn(msg, '', []));
};

const handleStdIfaces = (bus: ServiceBus, msg: Message): boolean => {
  const { member, path, signature } = msg;

  const ifaceName = msg.interface;

  if (!isInterfaceNameValid(ifaceName)) {
    bus.send(Message.newError(msg, INVALID_ARGS, `Invalid interface name: '${String(ifaceName)}'`));
    return true;
  }

  if (!isMemberNameValid(member)) {
    bus.send(Message.newError(msg, INVALID_ARGS, `Invalid member name: '${String(member)}'`));
    return true;
  }

  if (!isObjectPathValid(path)) {
    bus.send(Message.newError(msg, INVALID_ARGS, `Invalid path name: '${String(path)}'`));
    return true;
  }

  if (
    ifaceName === 'org.freedesktop.DBus.Introspectable' &&
    member === 'Introspect' &&
    !signature
  ) {
    handleIntrospect(bus, msg, path);
    return true;
  } else if (ifaceName === 'org.freedesktop.DBus.Properties') {
    if (member === 'Get' && signature === 'ss') {
      handleGetProperty(bus, msg, path);
      return true;
    } else if (member === 'Set' && signature === 'ssv') {
      handleSetProperty(bus, msg, path);
      return true;
    } else if (member === 'GetAll') {
      handleGetAllProperties(bus, msg, path);
      return true;
    }
  } else if (ifaceName === 'org.freedesktop.DBus.Peer') {
    if (member === 'Ping' && !signature) {
      bus._connection.message({
        type: METHOD_RETURN,
        serial: bus._serial++,
        replySerial: msg.serial ?? undefined,
        destination: msg.sender,
      });
      return true;
    } else if (member === 'GetMachineId' && !signature) {
      const machineId = readFileSync('/var/lib/dbus/machine-id').toString().trim();
      bus._connection.message({
        type: METHOD_RETURN,
        serial: bus._serial++,
        replySerial: msg.serial ?? undefined,
        destination: msg.sender,
        signature: 's',
        body: [machineId],
      });
      return true;
    }
  }

  return false;
};

export const handleMessage = (msg: Message, bus: ServiceBus): boolean => {
  const { path } = msg;
  const member = msg.member;
  const signature = msg.signature || '';

  const ifaceName = msg.interface;

  if (handleStdIfaces(bus, msg)) {
    return true;
  }

  if (path === undefined || !bus._serviceObjects[path]) {
    return false;
  }

  const obj = bus._getServiceObject(path);
  const iface = typeof ifaceName === 'string' ? obj.interfaces[ifaceName] : undefined;

  if (!iface) {
    return false;
  }

  const methods = iface.$methods ?? {};
  for (const m of Object.keys(methods)) {
    const method = methods[m];
    if (method === undefined) {
      continue;
    }

    const handleError = (e: unknown): void => {
      if (e instanceof DBusError) {
        bus.send(Message.newError(msg, e.type, e.text));
      } else {
        sendServiceError(bus, msg, `The service threw an error.\n${errorStack(e)}`);
      }
    };

    if (method.name === member && method.inSignature === signature) {
      let result: unknown;
      try {
        result = invokeMethod(method.fn, iface, msg.body);
      } catch (e) {
        handleError(e);
        return true;
      }

      const sendReply = (body: unknown): void => {
        if (method.noReply) return;
        let replyBody: unknown[];
        if (body === undefined) {
          replyBody = [];
        } else if (method.outSignatureTree.length === 1) {
          replyBody = [body];
        } else if (method.outSignatureTree.length === 0) {
          sendServiceError(
            bus,
            msg,
            `method ${iface.$name}.${method.name} was not expected to return a body.`,
          );
          return;
        } else if (!Array.isArray(body)) {
          sendServiceError(
            bus,
            msg,
            `method ${iface.$name}.${method.name} expected to return multiple arguments in an array (signature: '${method.outSignature}')`,
          );
          return;
        } else {
          replyBody = body;
        }

        if (method.outSignatureTree.length !== replyBody.length) {
          sendServiceError(
            bus,
            msg,
            `method ${iface.$name}.${m} returned the wrong number of arguments (got ${replyBody.length} expected ${method.outSignatureTree.length}) for signature '${method.outSignature}'`,
          );
          return;
        }

        bus.send(Message.newMethodReturn(msg, method.outSignature, replyBody));
      };

      if (result instanceof Promise) {
        result.then(sendReply).catch(handleError);
      } else {
        sendReply(result);
      }

      return true;
    }
  }

  return false;
};
