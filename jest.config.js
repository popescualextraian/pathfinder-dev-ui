/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'backend',
      testEnvironment: 'node',
      rootDir: 'src',
      testRegex: '.*\\.spec\\.ts$',
      transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.spec.json' }] },
    },
    {
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      rootDir: 'frontend/src',
      testRegex: '.*\\.spec\\.tsx?$',
      transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.jest.json' }] },
    },
  ],
};
