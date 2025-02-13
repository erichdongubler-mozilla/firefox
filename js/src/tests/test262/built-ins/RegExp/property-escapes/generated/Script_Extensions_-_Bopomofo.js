// Copyright 2024 Mathias Bynens. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
author: Mathias Bynens
description: >
  Unicode property escapes for `Script_Extensions=Bopomofo`
info: |
  Generated by https://github.com/mathiasbynens/unicode-property-escapes-tests
  Unicode v16.0.0
esid: sec-static-semantics-unicodematchproperty-p
features: [regexp-unicode-property-escapes]
includes: [regExpUtils.js]
---*/

const matchSymbols = buildString({
  loneCodePoints: [
    0x0002C7,
    0x0002D9,
    0x003030,
    0x003037,
    0x0030FB
  ],
  ranges: [
    [0x0002C9, 0x0002CB],
    [0x0002EA, 0x0002EB],
    [0x003001, 0x003003],
    [0x003008, 0x003011],
    [0x003013, 0x00301F],
    [0x00302A, 0x00302D],
    [0x003105, 0x00312F],
    [0x0031A0, 0x0031BF],
    [0x00FE45, 0x00FE46],
    [0x00FF61, 0x00FF65]
  ]
});
testPropertyEscapes(
  /^\p{Script_Extensions=Bopomofo}+$/u,
  matchSymbols,
  "\\p{Script_Extensions=Bopomofo}"
);
testPropertyEscapes(
  /^\p{Script_Extensions=Bopo}+$/u,
  matchSymbols,
  "\\p{Script_Extensions=Bopo}"
);
testPropertyEscapes(
  /^\p{scx=Bopomofo}+$/u,
  matchSymbols,
  "\\p{scx=Bopomofo}"
);
testPropertyEscapes(
  /^\p{scx=Bopo}+$/u,
  matchSymbols,
  "\\p{scx=Bopo}"
);

const nonMatchSymbols = buildString({
  loneCodePoints: [
    0x0002C8,
    0x003012
  ],
  ranges: [
    [0x00DC00, 0x00DFFF],
    [0x000000, 0x0002C6],
    [0x0002CC, 0x0002D8],
    [0x0002DA, 0x0002E9],
    [0x0002EC, 0x003000],
    [0x003004, 0x003007],
    [0x003020, 0x003029],
    [0x00302E, 0x00302F],
    [0x003031, 0x003036],
    [0x003038, 0x0030FA],
    [0x0030FC, 0x003104],
    [0x003130, 0x00319F],
    [0x0031C0, 0x00DBFF],
    [0x00E000, 0x00FE44],
    [0x00FE47, 0x00FF60],
    [0x00FF66, 0x10FFFF]
  ]
});
testPropertyEscapes(
  /^\P{Script_Extensions=Bopomofo}+$/u,
  nonMatchSymbols,
  "\\P{Script_Extensions=Bopomofo}"
);
testPropertyEscapes(
  /^\P{Script_Extensions=Bopo}+$/u,
  nonMatchSymbols,
  "\\P{Script_Extensions=Bopo}"
);
testPropertyEscapes(
  /^\P{scx=Bopomofo}+$/u,
  nonMatchSymbols,
  "\\P{scx=Bopomofo}"
);
testPropertyEscapes(
  /^\P{scx=Bopo}+$/u,
  nonMatchSymbols,
  "\\P{scx=Bopo}"
);

reportCompare(0, 0);
