'use strict';
const {Agent, MockAgent, setGlobalDispatcher} = require(`undici`);
const fs = require(`node:fs`);
const path = require(`node:path`);
const v8 = require(`node:v8`);

const getNockFile = () => {
  const nockFolder = path.join(__dirname, `nock`);
  fs.mkdirSync(nockFolder, {recursive: true});
  return path.join(nockFolder, `${process.env.NOCK_FILE_NAME}-${process.env.RUN_CLI_ID}.dat`);
};

switch (process.env.NOCK_ENV) {
  case `record`:{
    const nockFile = getNockFile();
    const requests = Object.create(null);

    const agent = new Agent({
      interceptors: {
        Agent: [dispatch => function Intercept(opts, handler) {
          const record = {
            opts,
            data: [],
          };
          (requests[opts.origin] ??= []).push(record);
          return dispatch(opts, {
            __proto__: handler,
            onError(err) {
              record.error = err;
              return Reflect.apply(handler.onError, this, arguments);
            },
            onHeaders (statusCode, headersRaw) {
              const headers = Object.create(null);
              for (let i = 0; i < headersRaw.length;i += 2)
                headers[headersRaw[i].toString()] = headersRaw[i + 1].toString();

              Object.assign(record, {statusCode, headers});
              return Reflect.apply(handler.onHeaders, this, arguments);
            },
            onData(chunk) {
              record.data.push(chunk);
              return Reflect.apply(handler.onData, this, arguments);
            },
            onComplete(trailers) {
              record.trailers = trailers;
              return Reflect.apply(handler.onComplete, this, arguments);
            },
          });
        }],
      },
    });
    setGlobalDispatcher(agent);
    process.on(`exit`, () => {
      fs.writeFileSync(nockFile, v8.serialize(requests));
    });
    break;
  }

  case `replay`:{
    const mockAgent = new MockAgent();

    setGlobalDispatcher(mockAgent);
    mockAgent.disableNetConnect();

    const requests = v8.deserialize(fs.readFileSync(getNockFile()));
    for (const origin in requests) {
      const mockPool = mockAgent.get(origin);
      for (const record of requests[origin]) {
        const {opts: {path, method, headers}} = record;
        const intercept = mockPool.intercept({path, method, headers});
        if (record.error) {
          intercept.replyWithError(record.error);
        } else {
          intercept.reply(record.statusCode, Buffer.concat(record.data), record);
        }
      }
    }
    break;
  }

  default:
}
