// Ambient declaration for axios's internal mergeConfig helper.
//
// client.test.ts imports axios/unsafe/core/mergeConfig.js to reproduce the
// same config-merge axios itself does before running the interceptor chain
// (see the comment in that file). axios ships no .d.ts for its unsafe/ tree,
// so tsc reports TS7016 without this shim. The helper is used only in tests
// and the runtime code has no dependency on it.
declare module 'axios/unsafe/core/mergeConfig.js' {
  // axios calls this with (defaults, config) where defaults is AxiosDefaults;
  // typing the arguments loosely keeps the shim usable without pulling in
  // internal axios types the "unsafe" tree deliberately does not export.
  const mergeConfig: (a: unknown, b: unknown) => unknown
  export default mergeConfig
}
