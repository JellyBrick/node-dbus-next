import { DBusError } from '@/errors';
import { isRecord } from '@/guards';
import { createIntrospectParser } from '@/introspect-xml';
import { Message } from '@/message-type';
import { parseSignature } from '@/signature';
import { assertBusNameValid, assertObjectPathValid, isObjectPathValid } from '@/validators';

import { ProxyInterface } from './proxy-interface';

import type { MessageBus } from '@/bus';
import type { XMLParser } from 'fast-xml-parser';

export type ObjectPath = string;

/**
 * A class that represents a proxy to a DBus object. The `ProxyObject` contains
 * `ProxyInterface`s and a list of `node`s which are object paths of child
 * objects. A `ProxyObject` is created through {@link
 * MessageBus#getProxyObject} for a given well-known name and object path.
 * An interface can be gotten through {@link ProxyObject#getInterface} and can
 * be used to call methods and receive signals for that interface.
 */
export class ProxyObject {
  bus: MessageBus;
  name: string;
  path: ObjectPath;
  nodes: ObjectPath[];
  interfaces: Record<string, ProxyInterface>;
  private readonly _parser: XMLParser;

  /**
   * Create a new `ProxyObject`. This constructor should not be called
   * directly. Use {@link MessageBus#getProxyObject} to get a proxy object.
   */
  constructor(bus: MessageBus, name: string, path: string) {
    assertBusNameValid(name);
    assertObjectPathValid(path);
    this.bus = bus;
    this.name = name;
    this.path = path;
    this.nodes = [];
    this.interfaces = {};
    this._parser = createIntrospectParser();
  }

  /**
   * Get a {@link ProxyInterface} for the given interface name.
   *
   * @param name {string} - the interface name to get.
   * @throws {Error} Throws an error if the interface is not found on this object.
   */
  getInterface<T extends ProxyInterface = ProxyInterface>(name: string): T {
    const iface = this.interfaces[name];
    if (iface === undefined) {
      throw new Error(`interface not found in proxy object: ${name}`);
    }
    return iface as T;
  }

  private _initXml(data: unknown): void {
    if (!isRecord(data)) {
      return;
    }
    const root = data.node;
    if (!isRecord(root)) {
      return;
    }

    if (Array.isArray(root.node)) {
      for (const n of root.node) {
        if (isRecord(n) && isRecord(n.$) && typeof n.$.name === 'string') {
          const path = `${this.path}/${n.$.name}`;
          if (isObjectPathValid(path)) {
            this.nodes.push(path);
          }
        }
      }
    }

    if (Array.isArray(root.interface)) {
      for (const i of root.interface) {
        const iface = ProxyInterface._fromXml(this, i);
        if (iface !== null) {
          this.interfaces[iface.$name] = iface;
        }
      }
    }
  }

  async _init(xml?: string): Promise<this> {
    if (xml) {
      this._initXml(this._parser.parse(xml));

      const nameOwnerMessage = new Message({
        destination: 'org.freedesktop.DBus',
        path: '/org/freedesktop/DBus',
        interface: 'org.freedesktop.DBus',
        member: 'GetNameOwner',
        signature: 's',
        body: [this.name],
      });

      try {
        const msg = await this.bus.call(nameOwnerMessage);
        const owner = msg?.body[0];
        if (typeof owner === 'string') {
          this.bus._nameOwners[this.name] = owner;
        }
      } catch (err) {
        if (err instanceof DBusError && err.type === 'org.freedesktop.DBus.Error.NameHasNoOwner') {
          return this;
        }
        throw err;
      }
      return this;
    }

    const introspectMessage = new Message({
      destination: this.name,
      path: this.path,
      interface: 'org.freedesktop.DBus.Introspectable',
      member: 'Introspect',
      signature: '',
      body: [],
    });

    const msg = await this.bus.call(introspectMessage);
    const introspectXml = msg?.body[0];
    if (typeof introspectXml === 'string') {
      this._initXml(this._parser.parse(introspectXml));
    }
    return this;
  }

  _callMethod(
    iface: string,
    member: string,
    inSignature: string,
    outSignature: string,
    ...args: unknown[]
  ): Promise<unknown> {
    const methodCallMessage = new Message({
      destination: this.name,
      interface: iface,
      path: this.path,
      member: member,
      signature: inSignature,
      body: args,
    });

    return this.bus.call(methodCallMessage).then((msg) => {
      const outSignatureTree = parseSignature(outSignature);
      if (outSignatureTree.length === 0) {
        return null;
      }
      if (outSignatureTree.length === 1) {
        return msg?.body[0];
      }
      return msg?.body;
    });
  }
}
