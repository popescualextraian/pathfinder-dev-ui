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
  ],
};
