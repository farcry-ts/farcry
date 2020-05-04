# farcry

```typescript
// Create the RPC handler:

import { handler } from "farcry";
import * as t from "io-ts";

const rpc = handler().method(
  {
    name: "add",
    params: t.type({
      x: t.number,
      y: t.number,
    }),
    returns: t.number,
  },
  async function ({ x, y }) {
    return x + y;
  }
);

// Serve it with Express:

import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use("/rpc", bodyParser.json(), rpc.middleware());
app.listen(8080);
```
