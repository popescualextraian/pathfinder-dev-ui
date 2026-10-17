// Identity proxy for CSS modules: styles.foo === 'foo'.
module.exports = new Proxy({}, { get: (_t, key) => (key === '__esModule' ? undefined : key) });
