gczeal(9, 1000);
let g = newGlobal({newCompartment: true});
with (g) {
  for (let i = 0; i < 10000; i++) {
    (() => {
      let c = [];
      let d = [];
      let e = new FinalizationRegistry(Object);
      e.register(c);
      e.register(d);
      new Int8Array(294967295);
    })();
  }
}
