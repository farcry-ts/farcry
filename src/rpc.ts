import * as t from "io-ts";
import { PathReporter } from "io-ts/lib/PathReporter";
import { isLeft } from "fp-ts/lib/Either";

import jayson, { JSONRPCVersionTwoRequest } from "jayson";
import { Request, Response, Handler, NextFunction } from "express";

export interface MethodSpec<P extends t.Props, Po extends t.Props, R> {
  name: string;
  returns: t.Type<R>;
  params: P;
  optionalParams?: Po;
  meta?: MethodMeta;
}

// This might become arbitrarily extensible via a type param to handler() later on
interface MethodMeta {
  noBatch?: boolean;
}

interface MethodBody<P extends t.Props, Po extends t.Props, C, R> {
  (
    params: t.TypeOf<t.TypeC<P>> & t.TypeOf<t.PartialC<Po>>,
    context: C
  ): Promise<R>;
}

interface ContextBuilder<T> {
  (req: Request): T | Promise<T>;
}

enum RpcErrorCode {
  INVALID_PARAMS = -31999,
  INVALID_RETURN,
  NON_DOMAIN_ERROR,
  UNSUPPORTED_PARAMS_TYPE,
}

interface MiddlewareOpts<C extends {}> {
  contextBuilder?: ContextBuilder<C>;
  onError?: (error: any, method: string, params: object) => void;
}

const DomainErrorTag = Symbol("DomainErrorTag");

export class DomainError extends Error {
  private readonly [DomainErrorTag] = true;

  constructor(message: string, public readonly code: number) {
    super(message);
  }
}

function isDomainError(error: unknown): error is DomainError {
  return (error as any)[DomainErrorTag] === true;
}

export function handler<C extends {} = {}>() {
  return new RpcHandler<C>();
}

class RpcHandler<C extends {} = {}> {
  private _specs: Map<string, MethodSpec<any, any, any>> = new Map();
  private _bodies: Map<string, MethodBody<any, any, C, any>> = new Map();

  method<P extends t.Props, R, Po extends t.Props = {}>(
    spec: MethodSpec<P, Po, R>,
    body: MethodBody<P, Po, C, R>
  ) {
    if (this._specs.has(spec.name)) {
      throw new Error(
        "There is already a handler with name '" + spec.name + "'"
      );
    }

    // TODO: nicer way to do this?
    for (const optionalName of Object.keys(spec.optionalParams ?? {})) {
      const params = spec.params as Object; // is this cast safe?
      if (params.hasOwnProperty(optionalName)) {
        throw new Error(
          `There is already a non-optional parameter with name '${optionalName}'`
        );
      }
    }

    this._bodies.set(spec.name, body);
    this._specs.set(spec.name, spec);

    return this;
  }

  middleware(opts?: MiddlewareOpts<C>): Handler {
    const server = this.jaysonServer(opts);

    interface RequestWithBody extends Request {
      body: JSONRPCVersionTwoRequest | JSONRPCVersionTwoRequest[];
    }

    return async function (
      req: RequestWithBody,
      res: Response,
      next: NextFunction
    ) {
      if (typeof req.body !== "object") {
        console.error("The request body must be an object");
        res.sendStatus(500);
        return;
      }

      let context = {};
      try {
        if (opts?.contextBuilder) {
          context = await opts?.contextBuilder(req);
        }
      } catch (err) {
        console.error("Failed to create RPC context: " + err.toString());
        res.sendStatus(500);
        return;
      }

      server.call(req.body, context, function (err: any, result: any) {
        if (err instanceof Error) return next(err);
        res.send(result || err);
      });
    };
  }

  specs(): MethodSpec<any, any, any>[] {
    return Array.from(this._specs.values());
  }

  private jaysonServer(opts?: MiddlewareOpts<C>): jayson.Server {
    const methods: Record<string, jayson.MethodHandlerContext> = {};

    for (const [name, spec] of this._specs.entries()) {
      const body = this._bodies.get(name)!;

      methods[name] = async function (params, context, callback) {
        if (Array.isArray(params) || params === undefined) {
          return callback({
            code: RpcErrorCode.UNSUPPORTED_PARAMS_TYPE,
            message: "Method parameters must be an object",
          });
        }

        const [mandatoryParams, optionalParams] = splitParams(params, spec);

        const mandatoryParamsType = t.type(spec.params);
        const optionalParamsType = t.partial(spec.optionalParams ?? {});

        const decodedParams = t
          .exact(mandatoryParamsType)
          .decode(mandatoryParams);

        const decodedOptionalParams = t
          .exact(optionalParamsType)
          .decode(optionalParams);

        if (isLeft(decodedParams)) {
          const errors = PathReporter.report(decodedParams);
          return callback({
            code: RpcErrorCode.INVALID_PARAMS,
            message: "Invalid parameters type",
            data: {
              errors,
            },
          });
        }

        if (isLeft(decodedOptionalParams)) {
          const errors = PathReporter.report(decodedOptionalParams);
          return callback({
            code: RpcErrorCode.INVALID_PARAMS,
            message: "Invalid parameters type",
            data: {
              errors,
            },
          });
        }

        const completeParams = { ...mandatoryParams, ...optionalParams };

        try {
          const result = await body(completeParams, context as C);
          if (!spec.returns.is(result)) {
            // TODO: exact validation
            return callback({
              code: RpcErrorCode.INVALID_RETURN,
              message: "Invalid return type",
            });
          }
          return callback(null, result);
        } catch (err) {
          if (!isDomainError(err)) {
            opts?.onError?.(err, name, params);
          }

          const code = isDomainError(err)
            ? err.code
            : RpcErrorCode.NON_DOMAIN_ERROR;

          return callback({
            code,
            message: err.message,
          });
        }
      };
    }

    return new jayson.Server(methods, { useContext: true });
  }
}

function splitParams(
  params: object,
  spec: MethodSpec<any, any, any>
): [object, object] {
  type JsonObject = Record<string, any>; // TODO: any -> JSON compatible value?

  const mandatoryParams: JsonObject = {};
  const optionalParams: JsonObject = {};

  for (const key of Object.keys(spec.params)) {
    mandatoryParams[key] = (params as JsonObject)[key];
  }

  for (const key of Object.keys(spec.optionalParams ?? {})) {
    optionalParams[key] = (params as JsonObject)[key];
  }

  return [mandatoryParams, optionalParams];
}
