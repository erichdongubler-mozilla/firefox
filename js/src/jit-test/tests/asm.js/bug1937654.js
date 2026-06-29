load(libdir + "asm.js");

// asm.js has been removed. Previously, asm.js validation would reject functions
// with too many arguments. Now that asm.js validation is removed, this code
// compiles as normal JavaScript (which has no such strict limit in parsing).

let template = `
  'use asm';
  var imported = foreign.imported;
  function main() {
    imported(ARGS);
  }
  return main;
  `;
let args = new Array(100000).fill('0').join(', ');

// This now succeeds (compiles as normal JS) instead of throwing SyntaxError
let fn = new Function('stdlib', 'foreign', template.replace('ARGS', args));
assertEq(typeof fn, 'function');
