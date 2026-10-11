'use strict';

// Production entry point of the frontend (`pnpm --filter web start`, and the Docker image).
// It is `next start` with one difference: the HTTP server is ours, so the address of each
// client can be appended to X-Forwarded-For before Next proxies /api to the API
// (server/web-server.js). Development keeps using `next dev`, and a platform that runs the
// build its own way (Vercel) never executes this file.
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const next = require('next');
const { createWebServer } = require('./server/web-server');

const port = Number(process.env.PORT) || 3000;
const app = next({ dev: false, dir: __dirname, hostname: 'localhost', port });

app
  .prepare()
  .then(() => {
    const server = createWebServer(app.getRequestHandler());
    server.listen(port, '0.0.0.0', () => {
      console.log(`Web listening on 0.0.0.0:${port}`);
    });

    // A redeploy stops the process with SIGTERM: stop accepting connections, let the requests
    // in flight finish, then exit. The timer is the bound if a connection never ends.
    const shutdown = () => {
      server.close(() => process.exit(0));
      server.closeIdleConnections();
      setTimeout(() => process.exit(0), 10_000).unref();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })
  .catch((error) => {
    console.error('Could not start the web server', error);
    process.exit(1);
  });
