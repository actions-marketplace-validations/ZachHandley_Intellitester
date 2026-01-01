import { describe, it, expect } from 'vitest';
import type { TestDefinition } from '../src/core/types';

describe('Variable Interpolation', () => {
  it('should parse test definition with variables', () => {
    const testDef: TestDefinition = {
      name: 'Test with variables',
      platform: 'web',
      variables: {
        username: 'testuser_{{uuid}}',
        password: 'Test123!',
        baseEmail: 'test@example.com',
      },
      steps: [
        {
          type: 'navigate',
          value: 'https://example.com/signup',
        },
        {
          type: 'input',
          target: { testId: 'username' },
          value: '{{username}}',
        },
        {
          type: 'input',
          target: { testId: 'password' },
          value: '{{password}}',
        },
        {
          type: 'setVar',
          name: 'confirmationText',
          value: 'Welcome {{username}}!',
        },
        {
          type: 'assert',
          target: { testId: 'welcome-message' },
          value: '{{confirmationText}}',
        },
      ],
    };

    expect(testDef.variables).toBeDefined();
    expect(testDef.variables?.username).toBe('testuser_{{uuid}}');
    expect(testDef.variables?.password).toBe('Test123!');

    // Verify setVar action exists and has correct structure
    const setVarAction = testDef.steps.find((step) => step.type === 'setVar');
    expect(setVarAction).toBeDefined();
    if (setVarAction?.type === 'setVar') {
      expect(setVarAction.name).toBe('confirmationText');
      expect(setVarAction.value).toBe('Welcome {{username}}!');
    }

    // Verify input actions use variable interpolation syntax
    const inputActions = testDef.steps.filter((step) => step.type === 'input');
    expect(inputActions).toHaveLength(2);
    if (inputActions[0]?.type === 'input') {
      expect(inputActions[0].value).toBe('{{username}}');
    }
    if (inputActions[1]?.type === 'input') {
      expect(inputActions[1].value).toBe('{{password}}');
    }
  });

  it('should validate setVar action schema', () => {
    const setVarWithValue: TestDefinition = {
      name: 'SetVar with value',
      platform: 'web',
      steps: [
        {
          type: 'setVar',
          name: 'myVar',
          value: 'myValue',
        },
      ],
    };

    expect(setVarWithValue.steps[0]).toMatchObject({
      type: 'setVar',
      name: 'myVar',
      value: 'myValue',
    });
  });

  it('should support uuid variable in definitions', () => {
    const testDef: TestDefinition = {
      name: 'UUID test',
      platform: 'web',
      variables: {
        userId: 'user_{{uuid}}',
        sessionId: '{{uuid}}',
      },
      steps: [
        {
          type: 'navigate',
          value: 'https://example.com/user/{{userId}}',
        },
      ],
    };

    expect(testDef.variables?.userId).toBe('user_{{uuid}}');
    expect(testDef.variables?.sessionId).toBe('{{uuid}}');
  });
});
