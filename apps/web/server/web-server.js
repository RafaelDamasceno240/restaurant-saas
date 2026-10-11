'use strict';

const http = require('http');
const { appendForwardedFor } = require('./forwarded-for');

// The HTTP server in front of Next's request handler. Its one job besides handing the request
// over: record who is on the other end of the socket in X-Forwarded-For BEFORE Next sees the
// request, so the /api rewrite forwards it to the API (see ./forwarded-for.js).
//
// `handle` is Next's request handler (app.getRequestHandler()); taking it as a parameter keeps
// this file testable without a build.
function createWebServer(handle) {
  return http.createServer((req, res) => {
    req.headers['x-forwarded-for'] = appendForwardedFor(req.headers['x-forwarded-for'], req.socket.remoteAddress);
    Promise.resolve()
      .then(() => handle(req, res))
      .catch((error) => {
        console.error('Request handler failed', error);
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
  });
}

module.exports = { createWebServer };
