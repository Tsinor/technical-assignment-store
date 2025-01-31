import { JSONArray, JSONObject, JSONPrimitive } from "./json-types";
import {
  intersectPermissions,
  Permission,
  canRead,
  canWrite,
} from "./permissions";

export type StoreResult = Store | JSONPrimitive | undefined;
export type StoreValue =
  | JSONObject
  | JSONArray
  | StoreResult
  | (() => StoreResult);

export interface IStore {
  defaultPolicy: Permission;
  allowedToRead(key: string, parentPermission?: Permission): boolean;
  allowedToWrite(key: string, parentPermission?: Permission): boolean;
  read(path: string, parentPermission?: Permission): StoreResult;
  write(
    path: string,
    value: StoreValue,
    parentPermission?: Permission
  ): StoreValue;
  writeEntries(entries: JSONObject): void;
  entries(): JSONObject;
}

const PERMISSIONS_KEY = "store:permissions";

export function Restrict(permission: Permission = "none"): any {
  return function (target: any, propertyKey: string | symbol): void {
    if (!target.constructor[PERMISSIONS_KEY]) {
      target.constructor[PERMISSIONS_KEY] = {};
    }
    target.constructor[PERMISSIONS_KEY][propertyKey] = permission;
  };
}

export class Store implements IStore {
  // to avoid casting obj[key]
  [key: string]: any;

  defaultPolicy: Permission = "rw";

  private getLocalPermission(key: string): Permission {
    const ctor: any = this.constructor;
    const permissionsMap = ctor[PERMISSIONS_KEY] ?? {};
    return permissionsMap[key] ?? this.defaultPolicy;
  }

  allowedToRead(key: string, parentPermission: Permission = "rw"): boolean {
    const localPermission = this.getLocalPermission(key);
    const finalPermission = intersectPermissions(
      parentPermission,
      localPermission
    );
    return canRead(finalPermission);
  }

  allowedToWrite(key: string, parentPermission: Permission = "rw"): boolean {
    const localPermission = this.getLocalPermission(key);
    const finalPermission = intersectPermissions(
      parentPermission,
      localPermission
    );
    return canWrite(finalPermission);
  }

  read(path: string, parentPermission: Permission = "rw"): StoreResult {
    return this._readRecursive(path.split(":"), parentPermission);
  }

  private _readRecursive(
    parts: string[],
    inheritedPermission: Permission,
    currentObj: any = this
  ): StoreResult {
    const key = parts[0];

    if (currentObj instanceof Store) {
      const localPermission = currentObj.getLocalPermission(key);
      const finalPermission = intersectPermissions(
        inheritedPermission,
        localPermission
      );

      if (!canRead(finalPermission))
        throw new Error(`No read permission for key: ${key}`);

      let value = currentObj[key];

      if (parts.length === 1) {
        if (typeof value === "function") {
          value = value();

          currentObj[key] = value;
        }

        return value;
      }

      if (typeof value === "function") {
        value = value();

        currentObj[key] = value;
      }

      return this._readRecursive(parts.slice(1), finalPermission, value);
    }

    if (currentObj && typeof currentObj === "object") {
      const value = currentObj[key];

      if (parts.length === 1) {
        return value;
      }

      return this._readRecursive(parts.slice(1), inheritedPermission, value);
    }
    return undefined;
  }

  write(
    path: string,
    value: StoreValue,
    parentPermission: Permission = "rw"
  ): StoreValue {
    this._writeRecursive(path.split(":"), parentPermission, value, this);
    return value;
  }

  private _writeRecursive(
    parts: string[],
    inheritedPermission: Permission,
    newValue: StoreValue,
    currentObj: any
  ): void {
    const key = parts[0];
    if (currentObj instanceof Store) {
      const localPermission = currentObj.getLocalPermission(key);
      const finalPermission = intersectPermissions(
        inheritedPermission,
        localPermission
      );

      if (parts.length > 1) {
        if (!canRead(finalPermission)) {
          throw new Error(`No read permission for key: ${key}`);
        }

        let subVal = this._resolveSubValue(currentObj, key);

        if (subVal instanceof Store) {
          const remainingPath = parts.slice(1).join(":");
          subVal.write(remainingPath, newValue);
          return;
        }

        this._writeRecursive(parts.slice(1), finalPermission, newValue, subVal);

        return;
      }

      if (!canWrite(finalPermission)) {
        throw new Error(`No write permission for key: ${key}`);
      }

      this._assignValue(currentObj, key, newValue);

      return;
    }

    if (currentObj && typeof currentObj === "object") {
      if (parts.length > 1) {
        if (!canRead(inheritedPermission)) {
          throw new Error(`No read permission for key: ${key}`);
        }

        let subVal = this._resolveSubValue(currentObj, key);

        if (subVal instanceof Store) {
          const remainingPath = parts.slice(1).join(":");
          subVal.write(remainingPath, newValue);

          return;
        }

        this._writeRecursive(
          parts.slice(1),
          inheritedPermission,
          newValue,
          subVal
        );

        return;
      }

      if (!canWrite(inheritedPermission)) {
        throw new Error(`No write permission for key: ${key}`);
      }

      currentObj[key] = newValue;

      return;
    }

    if (parts.length > 1) {
      throw new Error(
        `Cannot write deeper into a primitive value at key: ${key}`
      );
    }

    currentObj[key] = newValue;
  }

  private _resolveSubValue(currentObj: any, key: string): any {
    let subVal = currentObj[key];

    if (typeof subVal === "function") {
      subVal = subVal();
      currentObj[key] = subVal;
    }

    if (!subVal) {
      subVal = new Store();
      currentObj[key] = subVal;
    }

    return subVal;
  }

  private _assignValue(currentObj: any, key: string, newValue: StoreValue) {
    if (
      typeof newValue === "function" ||
      newValue instanceof Store ||
      Array.isArray(newValue)
    ) {
      currentObj[key] = newValue;
      return;
    }

    if (newValue && typeof newValue === "object") {
      const nestedStore = new Store();
      nestedStore.writeEntries(newValue as JSONObject);
      currentObj[key] = nestedStore;
      return;
    }

    currentObj[key] = newValue;
  }

  writeEntries(entries: JSONObject): void {
    for (const [key, val] of Object.entries(entries)) {
      this.write(key, val as StoreValue);
    }
  }

  entries(): JSONObject {
    const result: JSONObject = {};

    for (const key of Object.keys(this)) {
      if (this.allowedToRead(key)) {
        result[key] = this._convertToJSON(this[key]);
      }
    }
    return result;
  }

  private _convertToJSON(val: any): any {
    if (typeof val === "function") {
      val = val();
      return this._convertToJSON(val);
    }

    if (val instanceof Store) {
      return val.entries();
    }

    if (val && typeof val === "object") {
      const obj: any = {};

      for (const [k, v] of Object.entries(val)) {
        obj[k] = this._convertToJSON(v);
      }
      return obj;
    }

    return val;
  }
}
