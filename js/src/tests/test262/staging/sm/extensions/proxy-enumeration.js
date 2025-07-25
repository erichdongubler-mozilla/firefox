// Copyright (C) 2024 Mozilla Corporation. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
includes: [sm/non262.js, sm/non262-shell.js]
flags:
  - noStrict
description: |
  pending
esid: pending
---*/
var list = Object.getOwnPropertyNames(this);
var found = list.indexOf("Proxy") != -1;
assert.sameValue(found, true)

reportCompare(0, 0);
