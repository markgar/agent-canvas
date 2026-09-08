import { readConfig } from './config.js';
import { createServer } from './http/create-server.js';

function reportFailure(error: unknown): void {
  console.error(error);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const config = readConfig(process.env);
  const server = createServer(config);
  const address = await server.listen(config);

  console.error(`Agent Canvas listening at ${address}`);
  console.error(
    'Scaffold only: GET /health is available; display and MCP are not implemented.',
  );

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    await server.close();
  };

  process.once('SIGINT', () => {
    void shutdown().catch(reportFailure);
  });
  process.once('SIGTERM', () => {
    void shutdown().catch(reportFailure);
  });
}

void main().catch(reportFailure);
