import { EventEmitter } from 'node:events';

import { ProxyObject } from '@/client';
import { MessageType, MessageFlag } from '@/constants';
import { DBusError } from '@/errors';
import { createIntrospectBuilder } from '@/introspect-xml';
import { Message } from '@/message-type';
import {
  ServiceObject,
  handleMessage as handleMethod,
  type ServiceBus,
  type Interface,
} from '@/service';
import { assertBusNameValid, assertObjectPathValid } from '@/validators';

import type { DBusConnection } from '@/connection';
import type { IntrospectInterface } from '@/introspect-types';
import type { XMLBuilder } from 'fast-xml-builder';

const { METHOD_CALL, METHOD_RETURN, ERROR, SIGNAL } = MessageType;
const { NO_REPLY_EXPECTED } = MessageFlag;

const xmlHeader =
  '<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">\n';
const nameOwnerMatchRule =
  "type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',path='/org/freedesktop/DBus',member='NameOwnerChanged'";

interface IntrospectDocument {
  node: {
    $?: { name?: string };
    node: Array<{ $: { name: string } }>;
    interface?: IntrospectInterface[];
  };
}

interface MessageBusEvents {
  connect: [];
  message: [message: Message];
}

/**
 * @class
 * The `MessageBus` is a class for interacting with a DBus message bus capable
 * of requesting a service [`Name`]{@link module:interface~Name} to export an
 * [`Interface`]{@link module:interface~Interface}, or getting a proxy object
 * to interact with an existing name on the bus as a client. A `MessageBus` is
 * created with `dbus.sessionBus()` or `dbus.systemBus()` methods of the
 * dbus-next module.
 */
export class MessageBus extends EventEmitter<MessageBusEvents> implements ServiceBus {
  name: string | null;
  /** @internal */ private _builder: XMLBuilder;
  /** @internal */ _connection: DBusConnection;
  /** @internal */ _serial: number;
  /** @internal */ private readonly _methodReturnHandlers: Record<number, (reply: Message) => void>;
  /** @internal */ _signals: EventEmitter<Record<string, [message: Message]>>;
  /** @internal */ _nameOwners: Record<string, string>;
  /** @internal */ readonly _methodHandlers: Array<(msg: Message) => unknown>;
  /** @internal */ _serviceObjects: Record<string, ServiceObject | undefined>;
  /** @internal */ private _isHighLevelClientInitialized: boolean;
  /** @internal */ private readonly _matchRules: Record<string, number>;

  /**
   * Create a new `MessageBus`. This constructor is not to be called directly.
   * Use `dbus.sessionBus()` or `dbus.systemBus()` to set up the connection to
   * the bus.
   */
  constructor(conn: DBusConnection) {
    super();
    this._builder = createIntrospectBuilder();
    this._connection = conn;
    this._serial = 1;
    this._methodReturnHandlers = {};
    this._signals = new EventEmitter<Record<string, [message: Message]>>();
    this._nameOwners = {};
    this._methodHandlers = [];
    this._serviceObjects = {};
    this._isHighLevelClientInitialized = false;

    // An object with match rule keys and refcount values. Used only by
    // the internal high-level function `_addMatch` for refcounting.
    this._matchRules = {};

    this.name = null;

    const handleSignal = (msg: Message): void => {
      // if this is a name owner changed message, cache the new name owner
      const { sender, path, interface: iface, member } = msg;
      if (
        sender === 'org.freedesktop.DBus' &&
        path === '/org/freedesktop/DBus' &&
        iface === 'org.freedesktop.DBus' &&
        member === 'NameOwnerChanged'
      ) {
        const name = msg.body[0];
        const newOwner = msg.body[2];
        if (typeof name === 'string' && typeof newOwner === 'string' && !name.startsWith(':')) {
          this._nameOwners[name] = newOwner;
        }
      }

      const mangled = JSON.stringify({
        path: msg.path,
        interface: msg.interface,
        member: msg.member,
      });
      this._signals.emit(mangled, msg);
    };

    const handleMessage = (msg: Message): void => {
      // Don't handle messages that aren't destined for us. This might happen
      // when we become a monitor.
      if (this.name && msg.destination) {
        if (msg.destination[0] === ':' && msg.destination !== this.name) {
          return;
        }
        if (this._nameOwners[msg.destination] && this._nameOwners[msg.destination] !== this.name) {
          return;
        }
      }

      if (msg.type === METHOD_RETURN || msg.type === ERROR) {
        if (msg.replySerial === undefined) {
          return;
        }
        const handler = this._methodReturnHandlers[msg.replySerial];
        if (handler) {
          delete this._methodReturnHandlers[msg.replySerial];
          handler(msg);
        }
      } else if (msg.type === SIGNAL) {
        handleSignal(msg);
      } else {
        // methodCall (needs to be handled)
        let handled: unknown = false;

        for (const handler of this._methodHandlers) {
          // run installed method handlers first
          handled = handler(msg);
          if (handled) {
            break;
          }
        }

        if (!handled) {
          handled = handleMethod(msg, this);
        }

        if (!handled) {
          this.send(
            Message.newError(
              msg,
              'org.freedesktop.DBus.Error.UnknownMethod',
              `Method '${msg.member ?? ''}' on interface '${msg.interface ?? '(none)'}' does not exist`,
            ),
          );
        }
      }
    };

    conn.on('message', (msg: Message) => {
      try {
        // TODO: document this signal
        this.emit('message', msg);
        handleMessage(msg);
      } catch (e) {
        const stack = e instanceof Error ? e.stack : String(e);
        this.send(
          Message.newError(
            msg,
            'com.github.dbus_next.Error',
            `The DBus library encountered an error.\n${stack}`,
          ),
        );
      }
    });

    conn.on('error', (err: unknown) => {
      // forward network and stream errors
      this.emit('error', err);
    });

    const helloMessage = new Message({
      path: '/org/freedesktop/DBus',
      destination: 'org.freedesktop.DBus',
      interface: 'org.freedesktop.DBus',
      member: 'Hello',
    });

    this.call(helloMessage)
      .then((msg) => {
        const name = msg?.body[0];
        if (typeof name === 'string') {
          this.name = name;
        }
        this.emit('connect');
      })
      .catch((err: unknown) => {
        this.emit('error', err);
      });
  }

  /**
   * Get a {@link ProxyObject} on the bus for the given name and path for
   * interacting with a service as a client.
   */
  async getProxyObject(name: string, path: string, xml?: string): Promise<ProxyObject> {
    const obj = new ProxyObject(this, name, path);

    const objInitPromise = obj._init(xml);

    await this._initHighLevelClient();

    return objInitPromise;
  }

  /**
   * Request a well-known name on the bus.
   */
  async requestName(name: string, flags?: number): Promise<number> {
    const nameFlags = flags || 0;
    assertBusNameValid(name);
    const requestNameMessage = new Message({
      path: '/org/freedesktop/DBus',
      destination: 'org.freedesktop.DBus',
      interface: 'org.freedesktop.DBus',
      member: 'RequestName',
      signature: 'su',
      body: [name, nameFlags],
    });
    const msg = await this.call(requestNameMessage);
    return msg?.body[0] as number;
  }

  /**
   * Release this name. Requests that the name should no longer be owned by the
   * {@link MessageBus}.
   */
  async releaseName(name: string): Promise<number> {
    const msg = new Message({
      path: '/org/freedesktop/DBus',
      destination: 'org.freedesktop.DBus',
      interface: 'org.freedesktop.DBus',
      member: 'ReleaseName',
      signature: 's',
      body: [name],
    });
    const reply = await this.call(msg);
    return reply?.body[0] as number;
  }

  /**
   * Disconnect this `MessageBus` from the bus.
   */
  disconnect(): void {
    this._connection.stream?.end();
    this._signals.removeAllListeners();
  }

  /**
   * Get a new serial for this bus.
   */
  newSerial(): number {
    return this._serial++;
  }

  addMethodHandler(fn: (msg: Message) => unknown): void {
    this._methodHandlers.push(fn);
  }

  removeMethodHandler(fn: (msg: Message) => unknown): void {
    for (let i = 0; i < this._methodHandlers.length; ++i) {
      if (this._methodHandlers[i] === fn) {
        this._methodHandlers.splice(i, 1);
      }
    }
  }

  /**
   * Send a {@link Message} of type {@link MessageType.METHOD_CALL} to the bus
   * and wait for the reply.
   */
  call(msg: Message): Promise<Message | null> {
    return new Promise((resolve, reject) => {
      if (!(msg instanceof Message)) {
        throw new Error('The call() method takes a Message class as the first argument.');
      }
      if (msg.type !== METHOD_CALL) {
        throw new Error('Only messages of type METHOD_CALL can expect a call reply.');
      }
      if (msg.serial === null || msg._sent) {
        msg.serial = this.newSerial();
      }
      msg._sent = true;
      const serial = msg.serial;
      if (serial === null) {
        reject(new Error('message has no serial'));
        return;
      }
      if (msg.flags & NO_REPLY_EXPECTED) {
        resolve(null);
      } else {
        this._methodReturnHandlers[serial] = (reply) => {
          if (msg.destination && reply.sender) {
            this._nameOwners[msg.destination] = reply.sender;
          }
          if (reply.type === ERROR) {
            const errorName = reply.errorName ?? 'org.freedesktop.DBus.Error.Failed';
            const errorText = typeof reply.body[0] === 'string' ? reply.body[0] : undefined;
            reject(new DBusError(errorName, errorText, reply));
          } else {
            resolve(reply);
          }
        };
      }
      this._connection.message(msg);
    });
  }

  /**
   * Send a {@link Message} on the bus that does not expect a reply.
   */
  send(msg: Message): void {
    if (!(msg instanceof Message)) {
      throw new Error('The send() method takes a Message class as the first argument.');
    }
    if (msg.serial === null || msg._sent) {
      msg.serial = this.newSerial();
    }
    this._connection.message(msg);
  }

  /**
   * Export an [`Interface`]{@link module:interface~Interface} on the bus.
   */
  export(path: string, iface: Interface): void {
    const obj = this._getServiceObject(path);
    obj.addInterface(iface);
  }

  /**
   * Unexport an `Interface` on the bus.
   */
  unexport(path: string, iface?: Interface | null): void {
    if (!iface) {
      this._removeServiceObject(path);
    } else {
      const obj = this._getServiceObject(path);
      obj.removeInterface(iface);
      if (Object.keys(obj.interfaces).length === 0) {
        this._removeServiceObject(path);
      }
    }
  }

  /** @internal */ private async _initHighLevelClient(): Promise<void> {
    if (this._isHighLevelClientInitialized) {
      return;
    }

    try {
      await this._addMatch(nameOwnerMatchRule);
    } catch (error) {
      this.emit('error', error);
      return;
    }

    this._isHighLevelClientInitialized = true;
  }

  /** @internal */ _introspect(path: string): string {
    assertObjectPathValid(path);
    const document: IntrospectDocument = {
      node: {
        node: [],
      },
    };

    const serviceObject = this._serviceObjects[path];
    if (serviceObject) {
      document.node.interface = serviceObject.introspect();
    }

    const pathSplit = path.split('/').filter((n) => n);

    const children = new Set<string>();

    for (const key of Object.keys(this._serviceObjects)) {
      const keySplit = key.split('/').filter((n) => n);
      if (keySplit.length <= pathSplit.length) {
        continue;
      }
      if (pathSplit.every((v, i) => v === keySplit[i])) {
        const child = keySplit[pathSplit.length];
        if (child !== undefined) {
          children.add(child);
        }
      }
    }

    for (const child of children) {
      document.node.node.push({
        $: {
          name: child,
        },
      });
    }

    return xmlHeader + this._builder.build(document);
  }

  /** @internal */ _getServiceObject(path: string): ServiceObject {
    assertObjectPathValid(path);
    const existing = this._serviceObjects[path];
    if (existing !== undefined) {
      return existing;
    }
    const created = new ServiceObject(path, this);
    this._serviceObjects[path] = created;
    return created;
  }

  /** @internal */ private _removeServiceObject(path: string): void {
    assertObjectPathValid(path);
    const obj = this._serviceObjects[path];
    if (obj !== undefined) {
      for (const i of Object.keys(obj.interfaces)) {
        const iface = obj.interfaces[i];
        if (iface !== undefined) {
          obj.removeInterface(iface);
        }
      }
      delete this._serviceObjects[path];
    }
  }

  /** @internal */ _addMatch(match: string): Promise<unknown> {
    const current = this._matchRules[match];
    if (current !== undefined) {
      this._matchRules[match] = current + 1;
      return Promise.resolve();
    }

    this._matchRules[match] = 1;

    // TODO catch error and update refcount
    const msg = new Message({
      path: '/org/freedesktop/DBus',
      destination: 'org.freedesktop.DBus',
      interface: 'org.freedesktop.DBus',
      member: 'AddMatch',
      signature: 's',
      body: [match],
    });
    return this.call(msg);
  }

  /** @internal */ _removeMatch(match: string): Promise<unknown> {
    if (!this._connection.stream?.writable) {
      return Promise.resolve();
    }

    const current = this._matchRules[match];
    if (current !== undefined) {
      this._matchRules[match] = current - 1;
      if (current - 1 > 0) {
        return Promise.resolve();
      }
    } else {
      return Promise.resolve();
    }

    delete this._matchRules[match];

    // TODO catch error and update refcount
    const msg = new Message({
      path: '/org/freedesktop/DBus',
      destination: 'org.freedesktop.DBus',
      interface: 'org.freedesktop.DBus',
      member: 'RemoveMatch',
      signature: 's',
      body: [match],
    });
    return this.call(msg);
  }
}
