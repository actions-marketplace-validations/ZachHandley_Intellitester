# Variable Interpolation Implementation

This document describes the variable interpolation feature added to the Playwright executor.

## Overview

Variable interpolation allows test definitions to use dynamic values throughout test execution using the `{{variableName}}` syntax.

## Implementation Details

### Files Modified

- `/Users/zach/GitHub/AutoTester/src/executors/web/playwrightExecutor.ts`

### Key Components

#### 1. Interpolation Function

```typescript
function interpolateVariables(value: string, variables: Map<string, string>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    if (varName === 'uuid') {
      return crypto.randomUUID().split('-')[0]; // Short UUID
    }
    return variables.get(varName) ?? match;
  });
}
```

- Replaces `{{variableName}}` with the actual value from the variables Map
- Special handling for `{{uuid}}` to generate short UUIDs
- Returns original match if variable not found

#### 2. Execution Context

```typescript
interface ExecutionContext {
  variables: Map<string, string>;
  lastEmail: Email | null;
  emailClient: InbucketClient | null;
}
```

- Maintains runtime state including variables
- Also includes email-related state for email actions

#### 3. Variable Initialization

At the start of `runWebTest`:
```typescript
const executionContext: ExecutionContext = {
  variables: new Map<string, string>(),
  lastEmail: null,
  emailClient: null,
};

// Initialize variables from test definition
if (test.variables) {
  for (const [key, value] of Object.entries(test.variables)) {
    // Interpolate variable values to handle nested {{uuid}}
    const interpolated = interpolateVariables(value, executionContext.variables);
    executionContext.variables.set(key, interpolated);
  }
}
```

#### 4. Action Interpolation

The following actions now support variable interpolation:

- **navigate.value**: URL navigation
- **input.value**: Input field values
- **assert.value**: Assertion text values
- **email.waitFor.mailbox**: Email mailbox names
- **email.clear.mailbox**: Email mailbox names

#### 5. setVar Action Handler

```typescript
case 'setVar': {
  let value: string;
  if (action.value) {
    value = interpolateVariables(action.value, executionContext.variables);
  } else if (action.from === 'response') {
    throw new Error('setVar from response not yet implemented');
  } else if (action.from === 'element') {
    throw new Error('setVar from element not yet implemented');
  } else if (action.from === 'email') {
    throw new Error('Use email.extractCode or email.extractLink instead');
  } else {
    throw new Error('setVar requires value or from');
  }
  executionContext.variables.set(action.name, value);
  break;
}
```

#### 6. Result Type Updates

```typescript
export interface WebRunResult {
  status: 'passed' | 'failed';
  steps: StepResult[];
  variables?: Map<string, string>; // Added
}
```

## Usage Examples

### Basic Variable Usage

```yaml
name: Variable Example
platform: web

variables:
  username: testuser_{{uuid}}
  password: Test123!

steps:
  - type: navigate
    value: https://example.com/login

  - type: input
    target: { testId: 'username' }
    value: "{{username}}"

  - type: input
    target: { testId: 'password' }
    value: "{{password}}"
```

### Dynamic Variable Creation

```yaml
steps:
  - type: setVar
    name: welcomeMessage
    value: "Welcome, {{username}}!"

  - type: assert
    target: { testId: 'message' }
    value: "{{welcomeMessage}}"
```

### UUID Generation

```yaml
variables:
  userId: user_{{uuid}}
  sessionId: "{{uuid}}"

steps:
  - type: navigate
    value: https://example.com/user/{{userId}}
```

## Testing

### Unit Tests

Created `/Users/zach/GitHub/AutoTester/tests/interpolation.test.ts` with:
- Variable parsing tests
- setVar action schema validation
- UUID variable support tests

### Example File

Created `/Users/zach/GitHub/AutoTester/examples/interpolation-example.yaml` demonstrating:
- Variable definitions with {{uuid}}
- Variable interpolation in navigation
- Variable interpolation in inputs
- Dynamic variable creation with setVar
- Nested variable usage

## Build Verification

```bash
pnpm build  # Compiles successfully
pnpm test   # All 8 tests pass
```

## Future Enhancements

The implementation includes placeholders for future features:
- `setVar from: response` - Extract from network responses
- `setVar from: element` - Extract from DOM elements
- Email code/link extraction already uses setVar pattern

## Schema Support

The feature leverages existing schema support in `/Users/zach/GitHub/AutoTester/src/core/schema.ts`:
- `TestDefinitionSchema.variables` (line 188)
- `setVarActionSchema` (lines 73-80)
- Email action schemas with mailbox interpolation
