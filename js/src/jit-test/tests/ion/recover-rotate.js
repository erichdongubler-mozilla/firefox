// |jit-test| --fast-warmup; --no-threads
function makeRotate(n) {
  return new Function("i", "cond", `
    let x = i >>> ${n} | i << ${32-n};
    if (cond) return x + 1;
    return 0;
`);
}

function correct(n, i) {
  let a = i >>> n | i << (32-n);
  return a + 1;
}

function test(n) {
  let rotate = makeRotate(n);
  for (var i = 0; i < 100; i++) {
    assertEq(rotate(i, false), 0);
  }
  assertEq(rotate(1, true), correct(n, 1));
}

for (var n = -2; n < 40; n++) {
  test(n)
}
