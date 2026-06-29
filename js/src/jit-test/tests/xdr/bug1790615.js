// |jit-test| --fuzzing-safe; --cpu-count=2; --ion-offthread-compile=off

load(libdir + "asserts.js");

function asmCompile() {
  var f = Function.apply(null, arguments);
  return f;
}
var code = asmCompile('glob', 'imp', 'b', `
"use asm";
function f(i,j) {
  i=i|0;
  j=j|0;
}
return f
`);
let g80 = newGlobal({newCompartment: true});
// asm.js has been removed; "use asm" code now compiles as normal JavaScript
// and XDR encoding succeeds.
g80.compileToStencilXDR(code, {});
