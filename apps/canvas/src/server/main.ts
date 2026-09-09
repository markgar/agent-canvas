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
  let protocolClosed = false;
  const runtime = createRuntime(config, {
    onProtocolError() {
      console.error('Agent Canvas MCP protocol or transport error.');
    },
    onProtocolClose(shutdownError) {
      protocolClosed = true;
      process.exitCode = 1;
      process.stdin.pause();
      console.error('Agent Canvas MCP transport closed unexpectedly.');
      if (shutdownError !== undefined) {
        reportFailure(shutdownError);
      }
      process.exit(1);
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
    if (!protocolClosed) {
      void shutdown().catch(reportFailure);
    }
  });
  if (process.stdin.readableEnded) {
    await shutdown();
  }
}

void main().catch(reportFailure);
