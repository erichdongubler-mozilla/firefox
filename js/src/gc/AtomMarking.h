/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * vim: set ts=8 sts=2 et sw=2 tw=80:
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef gc_AtomMarking_h
#define gc_AtomMarking_h

#include "mozilla/Atomics.h"

#include "NamespaceImports.h"
#include "js/Vector.h"
#include "threading/ProtectedData.h"

namespace js {

class AutoLockGC;
class DenseBitmap;

namespace gc {

class Arena;
class GCRuntime;

// This class manages state used for marking atoms during GCs.
// See AtomMarking.cpp for details.
class AtomMarkingRuntime {
  // Unused arena atom bitmap indexes.
  js::MainThreadData<Vector<size_t, 0, SystemAllocPolicy>> freeArenaIndexes;

  // Background sweep state for |freeArenaIndexes|.
  js::GCLockData<Vector<size_t, 0, SystemAllocPolicy>> pendingFreeArenaIndexes;
  mozilla::Atomic<bool, mozilla::Relaxed> hasPendingFreeArenaIndexes;

  inline void markChildren(JSContext* cx, JSAtom*);
  inline void markChildren(JSContext* cx, JS::Symbol* symbol);

 public:
  // The extent of all allocated and free words in atom mark bitmaps.
  // This monotonically increases and may be read from without locking.
  mozilla::Atomic<size_t, mozilla::SequentiallyConsistent> allocatedWords;

  AtomMarkingRuntime() : allocatedWords(0) {}

  // Allocate an index in the atom marking bitmap for a new arena.
  size_t allocateIndex(GCRuntime* gc);

  // Free an index in the atom marking bitmap.
  void freeIndex(size_t index, const AutoLockGC& lock);

  void mergePendingFreeArenaIndexes(GCRuntime* gc);

  // Update the atom marking bitmaps in all collected zones according to the
  // atoms zone mark bits.
  void refineZoneBitmapsForCollectedZones(GCRuntime* gc);

  // Get a bitmap of all atoms marked in zones that are not being collected by
  // the current GC. On failure, mark the atoms instead.
  UniquePtr<DenseBitmap> getOrMarkAtomsUsedByUncollectedZones(GCRuntime* gc);

  // Set any bits in the chunk mark bitmaps for atoms which are marked in
  // uncollected zones, using the bitmap returned from the previous method.
  void markAtomsUsedByUncollectedZones(GCRuntime* gc,
                                       UniquePtr<DenseBitmap> markedUnion);

 private:
  // Fill |bitmap| with an atom marking bitmap based on the things that are
  // currently marked in the chunks used by atoms zone arenas. This returns
  // false on an allocation failure (but does not report an exception).
  bool computeBitmapFromChunkMarkBits(GCRuntime* gc, DenseBitmap& bitmap);

  // Update the atom marking bitmap in |zone| according to another
  // overapproximation of the reachable atoms in |bitmap|.
  void refineZoneBitmapForCollectedZone(Zone* zone, const DenseBitmap& bitmap);

 public:
  // Mark an atom or id as being newly reachable by the context's zone.
  template <typename T>
  void markAtom(JSContext* cx, T* thing);

  // Version of markAtom that's always inlined, for performance-sensitive
  // callers.
  template <typename T, bool Fallible>
  MOZ_ALWAYS_INLINE bool inlinedMarkAtomInternal(JSContext* cx, T* thing);
  template <typename T>
  MOZ_ALWAYS_INLINE void inlinedMarkAtom(JSContext* cx, T* thing);
  template <typename T>
  MOZ_ALWAYS_INLINE bool inlinedMarkAtomFallible(JSContext* cx, T* thing);

  void markId(JSContext* cx, jsid id);
  void markAtomValue(JSContext* cx, const Value& value);

  // Return whether |thing/id| is in the atom marking bitmap for |zone|.
  template <typename T>
  bool atomIsMarked(Zone* zone, T* thing);

#ifdef DEBUG
  bool idIsMarked(Zone* zone, jsid id);
  bool valueIsMarked(Zone* zone, const Value& value);
#endif
};

}  // namespace gc
}  // namespace js

#endif  // gc_AtomMarking_h
