/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'backend',
      testEnvironment: 'node',
      rootDir: 'backend/test/unit',
      testRegex: '.*\\.spec\\.ts$',
      transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../../tsconfig.spec.json' }] },
    },
    {
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      rootDir: 'frontend/test',
      testRegex: '.*\\.spec\\.tsx?$',
      moduleNameMapper: { '\\.css$': '<rootDir>/style-stub.js' },
      transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.jest.json' }] },
    },
  ],
};
