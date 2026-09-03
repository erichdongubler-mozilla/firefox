// |jit-test| slow

try {
  var ta = new Uint8Array(268435456 + 4096);
  function g(x) { return Math.max(...x); }
  print(g(ta));
} catch {}
