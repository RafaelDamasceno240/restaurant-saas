import type { IncomingMessage, Server, ServerResponse } from 'http';

export function createWebServer(
  handle: (req: IncomingMessage, res: ServerResponse) => unknown | Promise<unknown>,
): Server;
