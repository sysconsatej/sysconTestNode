
'use strict';

const { C } = require('./protocol');

class Router {
  constructor() {
    this._routes = new Map();
  }

  /**
   * Register all frames a handler is responsible for.
   * handler must have methods named the same as each type value (camelCased via _toMethod).
   * @param {object} handler
   * @param {string[]} types  — array of C.* constants
   */
  register(handler, types) {
    types.forEach(type => {
      const method = this._toMethod(type);
      if (typeof handler[method] !== 'function') {
        throw new Error(`Handler missing method: ${method} (for frame type: ${type})`);
      }
      this._routes.set(type, { handler, method });
    });
  }

  /**
   * Dispatch an incoming frame.
   * @param {string} connId
   * @param {{ type:string, id:string, payload:object, ts:number }} frame
   */
  dispatch(connId, frame) {
    const route = this._routes.get(frame.type);
    if (!route) {
      console.warn(`[Router] ⚠️  Unknown frame type: ${frame.type}`);
      return;
    }
    route.handler[route.method](connId, frame.payload || {});
  }

  _toMethod(type) {
    return 'on' + type
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
  }
}

module.exports = Router;
