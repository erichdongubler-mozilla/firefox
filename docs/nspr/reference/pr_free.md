# PR_Free

Frees allocated memory in the heap.

## Syntax

```
#include <prmem.h>

void PR_Free(void *ptr);
```

### Parameter

`ptr`

: A pointer to the memory to be freed.

### Returns

Nothing.

## Description

This function frees the memory addressed by `ptr` in the heap.
