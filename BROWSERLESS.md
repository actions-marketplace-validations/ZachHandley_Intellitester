# Using Browserless with AutoTester

Browserless provides a remote Chrome/Chromium instance for running tests.

## Quick Start

1. Start the services:
   ```bash
   docker-compose up -d
   ```

2. Configure AutoTester to use Browserless:
   ```yaml
   platforms:
     web:
       wsEndpoint: ws://localhost:3000
   ```

3. Run tests:
   ```bash
   autotester run tests/my-test.yaml
   ```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Browserless | 3000 | Chrome WebSocket endpoint |
| Inbucket Web | 9000 | Email web UI |
| Inbucket SMTP | 2500 | SMTP server for test emails |

## Parallel Execution

Browserless supports concurrent sessions (default: 10). Run multiple tests:
```bash
autotester run tests/*.yaml --parallel
```

## Debug Mode

Access the Browserless debugger at `http://localhost:3000/` to watch live sessions.
