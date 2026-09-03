// |jit-test| skip-if: !wasmSimdEnabled() || !wasmCompileMode().includes("baseline")

// A deep operand stack can push the baseline frame past MaxFrameSize while the
// body is still being compiled, so the frame height must be checked before
// every stackmap is created.  The externref parameter keeps a live reference
// around so that the stackmap is not elided.

const results = 'v128 '.repeat(1000);
const calls = 'call $manyResults\n'.repeat(200);

const text = `(module
  (func $manyResults (result ${results}) unreachable)
  (func (param $r externref)
    ${calls}
    unreachable))`;

assertErrorMessage(() => new WebAssembly.Module(wasmTextToBinary(text)),
                   WebAssembly.CompileError, /stack frame is too large/);
