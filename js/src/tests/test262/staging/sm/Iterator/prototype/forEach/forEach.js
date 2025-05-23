// |reftest| shell-option(--enable-iterator-helpers) skip-if(!this.hasOwnProperty('Iterator')||!xulRuntime.shell) -- iterator-helpers is not enabled unconditionally, requires shell-options
// Copyright (C) 2024 Mozilla Corporation. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
includes: [sm/non262.js, sm/non262-shell.js]
flags:
  - noStrict
features:
  - iterator-helpers
info: |
  Iterator is not enabled unconditionally
description: |
  pending
esid: pending
---*/

const log = [];
const fn = (value) => log.push(value);
const iter = [1, 2, 3].values();

assert.sameValue(iter.forEach(fn), undefined);
assert.sameValue(log.join(','), '1,2,3');


reportCompare(0, 0);
