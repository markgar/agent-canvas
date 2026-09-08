import { readConfig } from './config.js';
import { createRuntime } from './runtime.js';

function reportFailure(error: unknown): void {
  console.error(
    error instanceof Error ? error.message : 'Agent Canvas operation failed.',
  );
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const config = readConfig(process.env);
  const runtime = createRuntime(config, {
    onProtocolError() {
      console.error('Agent Canvas MCP protocol or transport error.');
    },
  });
  const address = await runtime.start();

  console.error(`Agent Canvas listening at ${address}`);

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = async (): Promise<void> => {
    shutdownPromise ??= runtime.close();
    await shutdownPromise;
  };

  process.once('SIGINT', () => {
    void shutdown().catch(reportFailure);
  });
  process.once('SIGTERM', () => {
    void shutdown().catch(reportFailure);
  });
  process.stdin.once('end', () => {
    void shutdown().catch(reportFailure);
  });
  if (process.stdin.readableEnded) {
    await shutdown();
  }
}

void main().catch(reportFailure);
