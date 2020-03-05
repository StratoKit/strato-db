"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "DB", {
  enumerable: true,
  get: function () {
    return _DB.default;
  }
});
Object.defineProperty(exports, "JsonModel", {
  enumerable: true,
  get: function () {
    return _JsonModel.default;
  }
});
exports.withESDB = exports.testModels = exports.sharedSetup = exports.getModel = void 0;

var _DB = _interopRequireDefault(require("../DB"));

var _EventSourcingDB = _interopRequireDefault(require("../EventSourcingDB"));

var _EventQueue = _interopRequireDefault(require("../EventQueue"));

var _JsonModel = _interopRequireDefault(require("../JsonModel"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; var ownKeys = Object.keys(source); if (typeof Object.getOwnPropertySymbols === 'function') { ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) { return Object.getOwnPropertyDescriptor(source, sym).enumerable; })); } ownKeys.forEach(function (key) { _defineProperty(target, key, source[key]); }); } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const getModel = options => {
  const db = new _DB.default();
  return db.addModel(_JsonModel.default, _objectSpread({
    name: 'testing',
    keepRowId: false
  }, options));
};

exports.getModel = getModel;

const sharedSetup = getPromise => fn => {
  let promise;
  return async () => {
    if (!promise) {
      promise = getPromise();
    }

    return fn((await promise));
  };
};

exports.sharedSetup = sharedSetup;
const testModels = {
  count: {
    // shortName: 'c',
    columns: {
      total: {
        type: 'INTEGER'
      }
    },
    migrations: {
      init: {
        up({
          db,
          model,
          queue
        }) {
          expect(db).toBeTruthy();
          expect(queue).toBeTruthy();
          return model.set({
            id: 'count',
            total: 0,
            byType: {}
          });
        }

      }
    },
    preprocessor: async ({
      event
    }) => {
      if (event.type === 'error_pre') throw new Error('pre error for you');
    },
    reducer: async ({
      model,
      event: {
        type
      }
    }) => {
      if (type === 'error_reduce') throw new Error('error for you');
      if (!model.get) return false;
      const c = (await model.get('count')) || {
        id: 'count',
        total: 0,
        byType: {}
      };
      c.total++;
      c.byType[type] = (c.byType[type] || 0) + 1;
      return {
        set: [c] // audit: '',

      };
    },
    deriver: async ({
      event
    }) => {
      if (event.type === 'error_derive') throw new Error('post error for you');
    }
  },
  ignorer: {
    // eslint-disable-next-line no-unused-vars
    reducer: args => {}
  },
  deriver: {
    deriver: async ({
      model,
      store,
      result,
      event
    }) => {
      if (result !== event.result[model.name]) {
        throw new Error('Expecting event.result as separate input');
      }

      if (event.result.count) {
        const currentCount = await store.count.get('count');
        await model.set({
          id: 'descCount',
          desc: `Total: ${currentCount.total}, seen types: ${Object.keys(currentCount.byType)}`
        });
      }
    }
  }
};
exports.testModels = testModels;

const withDBs = async fn => {
  const db = new _DB.default({
    name: 'D'
  });
  const queue = new _EventQueue.default({
    db: new _DB.default({
      name: 'Q'
    }),
    columns: {
      events: {
        type: 'JSON'
      }
    }
  });
  const ret = await fn(db, queue);
  await Promise.all([db.close(), queue.db.close()]);
  return ret;
};

const withESDB = (fn, models = testModels) => withDBs(async (db, queue) => {
  const eSDB = new _EventSourcingDB.default({
    queue,
    models,
    name: 'E'
  });
  const out = await fn(eSDB, queue);
  await eSDB.close();
  return out;
});

exports.withESDB = withESDB;
//# sourceMappingURL=_test-helpers.js.map