/** @type {import('jest').Config} */
module.exports = {
  displayName: 'socket-filter',
  testEnvironment: 'node',
  rootDir: 'test',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
};
