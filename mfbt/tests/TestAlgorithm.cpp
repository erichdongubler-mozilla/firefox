/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/Algorithm.h"
#include "mozilla/Assertions.h"

#include <iterator>

static constexpr bool even(int32_t n) { return !(n & 1); }
static constexpr bool odd(int32_t n) { return (n & 1); }

using namespace mozilla;

void TestAnyOf() {
  using std::begin;
  using std::end;

  // The Android NDK's STL doesn't support `constexpr` `std::array::begin`, see
  // bug 1677484. Hence using a raw array here.
  constexpr int32_t arr1[1] = {0};
  static_assert(!AnyOf(arr1, arr1, even));
  static_assert(!AnyOf(arr1, arr1, odd));

  constexpr int32_t arr2[] = {1};
  static_assert(!AnyOf(begin(arr2), end(arr2), even));
  static_assert(AnyOf(begin(arr2), end(arr2), odd));

  constexpr int32_t arr3[] = {2};
  static_assert(AnyOf(begin(arr3), end(arr3), even));
  static_assert(!AnyOf(begin(arr3), end(arr3), odd));

  constexpr int32_t arr4[] = {1, 2};
  static_assert(AnyOf(begin(arr4), end(arr4), even));
  static_assert(AnyOf(begin(arr4), end(arr4), odd));
}

int main() {
  TestAnyOf();
  return 0;
}
