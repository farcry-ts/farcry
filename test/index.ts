import chai, { expect, Assertion } from "chai";
import chaiHttp from "chai-http";

import express, { Handler } from "express";
import bodyParser from "body-parser";

import * as t from "io-ts";

import { handler, DomainError } from "../dist/rpc";

const ENDPOINT = "/rpc";

declare global {
  export namespace Chai {
    interface TypeComparison {
      rpcError(code: number, message?: string): void;
      rpcResult(result?: any): void;
    }
  }
}

if (process.argv.indexOf("--log") === -1) {
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
}

Assertion.addMethod("rpcError", function (code: number, message?: string) {
  new Assertion(this._obj).to.have.property("jsonrpc", "2.0");
  new Assertion(this._obj).to.have.property("id");
  new Assertion(this._obj).to.have.property("error");
  new Assertion(this._obj.error).to.have.property("message");
  new Assertion(this._obj.error.message).to.be.a("string");
  new Assertion(this._obj.error).to.have.property("code", code);

  if (message != null) {
    new Assertion(this._obj.error).to.have.property("message", message);
  }
});

Assertion.addMethod("rpcResult", function (result?: any) {
  new Assertion(this._obj).to.have.property("jsonrpc", "2.0");
  new Assertion(this._obj).to.have.property("id");

  if (arguments.length === 0) {
    new Assertion(this._obj).to.have.deep.property("result");
  } else {
    new Assertion(this._obj).to.have.deep.property("result", result);
  }
});

chai.use(chaiHttp);

function getApp(middleware: Handler) {
  const app = express();
  app.use(ENDPOINT, bodyParser.json(), middleware);
  return app;
}

it("should test the custom assertions", () => {
  const error = {
    jsonrpc: "2.0",
    id: 0,
    error: { code: 123, message: "some message" },
  };

  const result = {
    jsonrpc: "2.0",
    id: 0,
    result: { arr: [1, 2, 3] },
  };

  expect(error).to.be.an.rpcError(123);
  expect(result).to.be.an.rpcResult({ arr: [1, 2, 3] });
});

it("should pass a smoke test", (done) => {
  const rpc = handler<{
    v: string;
  }>();

  rpc.method(
    {
      name: "test-method",
      returns: t.string,
      params: {
        a: t.number,
        b: t.string,
      },
    },
    async function (params, context) {
      const sum = params.a + parseInt(params.b, 10);
      const cat = params.a + params.b;
      return `${sum} ${cat} ${context.v}`;
    }
  );

  const app = getApp(
    rpc.middleware({
      contextBuilder: (req) => {
        return {
          v: req.headers["x-test-header"] as string,
        };
      },
    })
  );

  chai
    .request(app)
    .post("/rpc")
    .set("x-test-header", "abc")
    .send({
      jsonrpc: "2.0",
      method: "test-method",
      params: { a: 10, b: "20" },
      id: 0,
    })
    .end((err, res) => {
      expect(err).to.be.null;
      expect(res).to.have.status(200);
      expect(res.body).to.be.an.rpcResult("30 1020 abc");
      done();
    });
});

it("should return an error (-31999) if the params type isn't correct", (done) => {
  const rpc = handler().method(
    {
      name: "test-method",
      returns: t.null,
      params: {
        firstParam: t.number,
        secondParam: t.string,
      },
    },
    async function () {
      return null;
    }
  );

  const app = getApp(rpc.middleware());

  chai
    .request(app)
    .post("/rpc")
    .set("x-test-header", "abc")
    .send({
      jsonrpc: "2.0",
      method: "test-method",
      params: { firstParam: 10, secondParam: 20 },
      id: 0,
    })
    .end((err, res) => {
      expect(err).to.be.null;
      expect(res).to.have.status(200);
      expect(res.body).to.be.rpcError(-31999);

      // This could change if error reporting is changed to work differently
      const { data } = res.body.error;
      expect(data.errors[0]).to.contain("number");
      expect(data.errors[0]).to.contain("string");
      expect(data.errors[0]).to.not.contain("/firstParam");
      expect(data.errors[0]).to.contain("/secondParam");
      done();
    });
});

it("should return an error (-31998) if the return type isn't correct", (done) => {
  const rpc = handler().method(
    {
      name: "test-method",
      returns: t.number,
      params: {},
    },
    async function () {
      return ("a string" as unknown) as number;
    }
  );

  const app = getApp(rpc.middleware());

  chai
    .request(app)
    .post(ENDPOINT)
    .send({
      jsonrpc: "2.0",
      method: "test-method",
      params: {},
      id: 0,
    })
    .end((err, res) => {
      expect(err).to.be.null;
      expect(res).to.have.status(200);
      expect(res.body).to.be.an.rpcError(-31998);
      done();
    });
});

it("should return an error (-32600) if the request isn't valid", (done) => {
  const rpc = handler().method(
    {
      name: "test-method",
      returns: t.number,
      params: {},
    },
    async function () {
      return 0;
    }
  );

  const app = getApp(rpc.middleware());

  chai
    .request(app)
    .post(ENDPOINT)
    .send({
      jsonrpc: "3.0",
      method: "test-method",
      params: {},
      id: 0,
    })
    .end((err, res) => {
      expect(err).to.be.null;
      expect(res.body).to.be.an.rpcError(-32600);
      done();
    });
});

it("should fail with HTTP 500 when the context builder fails", (done) => {
  const rpc = handler().method(
    {
      name: "test-method",
      returns: t.number,
      params: {},
    },
    async function () {
      return 0;
    }
  );

  const app = getApp(
    rpc.middleware({
      contextBuilder: () => {
        throw new Error("context builder failed");
      },
    })
  );

  chai
    .request(app)
    .post(ENDPOINT)
    .send({
      jsonrpc: "2.0",
      method: "test-method",
      params: {},
      id: 0,
    })
    .end((err, res) => {
      expect(res).to.have.status(500);
      expect(err).to.be.null;
      done();
    });
});

it("should fail with HTTP 500 when the request body isn't parsed", (done) => {
  const rpc = handler().method(
    {
      name: "test-method",
      returns: t.number,
      params: {},
    },
    async function () {
      return 0;
    }
  );

  const app = express();
  app.use(ENDPOINT, rpc.middleware());

  chai
    .request(app)
    .post(ENDPOINT)
    .send({
      jsonrpc: "2.0",
      method: "test-method",
      params: {},
      id: 0,
    })
    .end((err, res) => {
      expect(res).to.have.status(500);
      expect(err).to.be.null;
      done();
    });
});

it("should handle batches with some failures", (done) => {
  const rpc = handler().method(
    {
      name: "test-method-1",
      returns: t.number,
      params: {},
    },
    async function () {
      return 0;
    }
  );

  rpc.method(
    {
      name: "test-method-2",
      returns: t.number,
      params: { mandatory: t.number },
    },
    async function () {
      return 0;
    }
  );

  const app = getApp(rpc.middleware());

  chai
    .request(app)
    .post(ENDPOINT)
    .send([
      {
        jsonrpc: "2.0",
        method: "test-method-1",
        params: {},
        id: 0,
      },
      {
        jsonrpc: "2.0",
        method: "test-method-2",
        params: {},
        id: 1,
      },
    ])
    .end((err, res) => {
      expect(err).to.be.null;
      expect(res).to.have.status(200);

      const batchResponse = res.body;
      const shouldSucceed = batchResponse.find((r0: any) => r0.id === 0);
      const shouldFail = batchResponse.find((r1: any) => r1.id === 1);

      expect(shouldSucceed).to.have.property("result");
      expect(shouldFail).to.be.an.rpcError(-31999);

      done();
    });
});

it("should return an error (-31997) on a generic error", (done) => {
  const rpc = handler().method(
    {
      name: "test-method",
      returns: t.void,
      params: {},
    },
    async function () {
      throw new Error();
    }
  );

  const app = getApp(rpc.middleware());

  chai
    .request(app)
    .post(ENDPOINT)
    .send({
      jsonrpc: "2.0",
      method: "test-method",
      params: {},
      id: 0,
    })
    .end((err, res) => {
      expect(err).to.be.null;
      expect(res).to.have.status(200);
      expect(res.body).to.be.an.rpcError(-31997);
      done();
    });
});

it("should return a custom error code on a specific domain error", (done) => {
  const rpc = handler().method(
    {
      name: "test-method",
      returns: t.void,
      params: {},
    },
    async function () {
      throw new DomainError("custom error message", 12345);
    }
  );

  const app = getApp(rpc.middleware());

  chai
    .request(app)
    .post(ENDPOINT)
    .send({
      jsonrpc: "2.0",
      method: "test-method",
      params: {},
      id: 0,
    })
    .end((err, res) => {
      expect(err).to.be.null;
      expect(res).to.have.status(200);
      expect(res.body).to.be.an.rpcError(12345, "custom error message");
      done();
    });
});

it("should trigger onError on non-domain error", (done) => {
  const anError = new Error();

  const rpc = handler().method(
    {
      name: "test-method",
      returns: t.void,
      params: { x: t.number },
    },
    async function () {
      throw anError;
    }
  );

  let theError: Error;
  let theMethod: string;
  let theParams: object;

  const app = getApp(
    rpc.middleware({
      onError(error, method, params) {
        theError = error;
        theMethod = method;
        theParams = params;
      },
    })
  );

  chai
    .request(app)
    .post(ENDPOINT)
    .send({
      jsonrpc: "2.0",
      method: "test-method",
      params: { x: 10 },
      id: 0,
    })
    .end((err, res) => {
      expect(theError).to.eq(anError);
      expect(theMethod).to.eq("test-method");
      expect(theParams).to.have.property("x", 10);
      done();
    });
});

it("should be a fluent-style API", (done) => {
  const rpc = handler()
    .method(
      {
        name: "test-method-1",
        returns: t.number,
        params: {},
      },
      async function () {
        return 1;
      }
    )
    .method(
      {
        name: "test-method-2",
        returns: t.number,
        params: {},
      },
      async function () {
        return 2;
      }
    );

  const app = getApp(rpc.middleware());

  chai
    .request(app)
    .post(ENDPOINT)
    .send([
      {
        jsonrpc: "2.0",
        method: "test-method-1",
        params: {},
        id: 1,
      },
      {
        jsonrpc: "2.0",
        method: "test-method-2",
        params: {},
        id: 2,
      },
    ])
    .end((err, res) => {
      expect(err).to.be.null;
      expect(res).to.have.status(200);
      expect(
        res.body.find((result: any) => result.id === 1)
      ).to.be.an.rpcResult(1);
      expect(
        res.body.find((result: any) => result.id === 2)
      ).to.be.an.rpcResult(2);
      done();
    });
});

it("should handle complex params and return types", (done) => {
  const rpc = handler().method(
    {
      name: "test-method",
      returns: t.array(
        t.type({
          a: t.number,
          b: t.boolean,
          c: t.type({
            x: t.array(t.boolean),
          }),
        })
      ),
      params: {
        x: t.type({
          a: t.array(t.type({ x: t.string, y: t.array(t.number) })),
        }),
      },
    },
    async function (params) {
      const _v = params.x.a[0].y[0];
      return [
        { a: 10, b: true, c: { x: [true, false, true] } },
        { a: 20, b: false, c: { x: [true, true, true] } },
      ];
    }
  );

  const app = getApp(rpc.middleware());

  chai
    .request(app)
    .post(ENDPOINT)
    .send({
      jsonrpc: "2.0",
      method: "test-method",
      params: { x: { a: [{ x: "s", y: [1, 2, 3] }] } },
      id: 1,
    })
    .end((err, res) => {
      expect(err).to.be.null;
      expect(res).to.have.status(200);
      done();
    });
});

it("shouldn't permit two methods with the same name", () => {
  expect(() => {
    handler()
      .method(
        { name: "a-name", returns: t.void, params: {} },
        async function () {}
      )
      .method(
        { name: "a-name", returns: t.void, params: {} },
        async function () {}
      );
  }).to.throw();
});

it("shouldn't permit a mandatory and an optional parameter to have the same name", () => {
  expect(() => {
    handler().method(
      {
        name: "a-name",
        returns: t.void,
        params: { a: t.number },
        optionalParams: { a: t.number },
      },
      async function () {}
    );
  }).to.throw();
});

it("should handle optional parameters", (done) => {
  const rpc = handler().method(
    {
      name: "test-method",
      returns: t.number,
      params: {
        x: t.number,
      },
      optionalParams: {
        y: t.number,
        z: t.number,
      },
    },
    async function (params) {
      return params.x * (params.y ?? 1) * (params.z ?? 1);
    }
  );

  const app = getApp(rpc.middleware());

  chai
    .request(app)
    .post(ENDPOINT)
    .send({
      jsonrpc: "2.0",
      method: "test-method",
      params: { x: 7, y: 11 },
      id: 1,
    })
    .end((err, res) => {
      expect(err).to.be.null;
      expect(res).to.have.status(200);
      expect(res.body).to.be.an.rpcResult(77);
      done();
    });
});

it("shouldn't permit optional parameters of the wrong type", (done) => {
  const rpc = handler().method(
    {
      name: "test-method",
      returns: t.void,
      params: {},
      optionalParams: {
        y: t.number,
      },
    },
    async function () {}
  );

  const app = getApp(rpc.middleware());

  chai
    .request(app)
    .post(ENDPOINT)
    .send({
      jsonrpc: "2.0",
      method: "test-method",
      params: { y: true },
      id: 1,
    })
    .end((err, res) => {
      expect(err).to.be.null;
      expect(res).to.have.status(200);
      expect(res.body).to.be.an.rpcError(-31999);
      done();
    });
});

it("should strip excess input", (done) => {
  let storedX: number, storedY: any;
  let storedZ: number, storedQ: any;

  const rpc = handler().method(
    {
      name: "test-method",
      returns: t.void,
      params: { x: t.number },
      optionalParams: { z: t.number },
    },
    async function (params) {
      storedX = params["x"];
      storedY = (params as any)["y"];
      storedZ = params["z"]!;
      storedQ = (params as any)["q"];
    }
  );

  const app = getApp(rpc.middleware());

  chai
    .request(app)
    .post(ENDPOINT)
    .send({
      jsonrpc: "2.0",
      method: "test-method",
      params: { x: 10, y: 10, z: 20, q: 20 },
      id: 1,
    })
    .end((err, res) => {
      expect(err).to.be.null;
      expect(res).to.have.status(200);
      expect(storedX).to.equal(10);
      expect(storedY).to.be.undefined;
      expect(storedZ).to.equal(20);
      expect(storedQ).to.be.undefined;
      done();
    });
});

// it("should strip excess output", (done) => {
//   const rpc = handler().method(
//     {
//       name: "test-method",
//       returns: t.type({ x: t.number }),
//       params: t.type({}),
//     },
//     async function () {
//       return { x: 10, y: 10 };
//     }
//   );

//   const app = getApp(rpc.middleware());

//   chai
//     .request(app)
//     .post(ENDPOINT)
//     .send({
//       jsonrpc: "2.0",
//       method: "test-method",
//       params: {},
//       id: 1,
//     })
//     .end((err, res) => {
//       expect(err).to.be.null;
//       expect(res).to.have.status(200);
//       expect(res.body).to.be.an.rpcResult({ x: 10 });
//       done();
//     });
// });
