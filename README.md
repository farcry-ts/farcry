# farcry

```typescript
import { createRpcHandler } from "farcry";
import * as t from "io-ts";

const rpc = createRpcHandler();

rpc.method(
  {
    name: "add",
    params: t.type({
      x: t.number,
      y: t.number
    }),
    returns: t.number
  },
  async function({ x, y }) {
    return x + y;
  },
});

import express from "express";
import bodyParser from "body-parser";

const app = express();

app.use(
  "/rpc",
  bodyParser.json(),
  rpc.middleware(),
);

app.listen(8080);
```
