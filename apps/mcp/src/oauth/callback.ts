import { createServer } from 'node:http';

type OAuthCallback = {
  redirectUri: string;
  wait: Promise<URLSearchParams>;
  close: () => void;
};

export async function startOAuthCallback(): Promise<OAuthCallback> {
  let resolve!: (params: URLSearchParams) => void;
  let reject!: (error: Error) => void;
  const wait = new Promise<URLSearchParams>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>Anklav</title><p>Authorization complete. You may close this tab.</p>');
    resolve(url.searchParams);
  });

  await new Promise<void>((resolveReady, rejectReady) => {
    server.once('error', rejectReady);
    server.listen(0, '127.0.0.1', resolveReady);
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback callback did not start.');

  return {
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    wait,
    close: () => {
      server.close();
      reject(new Error('OAuth login was cancelled.'));
    },
  };
}
