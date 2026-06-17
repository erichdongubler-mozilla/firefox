/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsGkAtoms.h"
#include "mozilla/HashFunctions.h"

namespace mozilla::detail {

// Because this is `constexpr` it ends up in read-only memory where it can be
// shared between processes.
extern constexpr GkAtoms gGkAtoms = {
// The initialization of each atom's string.
//
// Expansion of the example GK_ATOM entries in nsGkAtoms.h:
//
//   u"a",
//   u"bb",
//   u"Ccc",
//
#define GK_ATOM(name_, value_) u"" value_,
#include "nsGkAtomList.h"
#undef GK_ATOM
    {
// The initialization of the atoms themselves.
//
// Note that |value_| is an 8-bit string, and so |sizeof(value_)| is equal
// to the number of chars (including the terminating '\0'). The |u""| prefix
// converts |value_| to a 16-bit string.
//
// Expansion of the example GK_ATOM entries in nsGkAtoms.h:
//
//   nsStaticAtom(
//     1,
//     HashString(u"" "a"),
//     offsetof(GkAtoms, mAtoms[static_cast<size_t>(GkAtoms::Atoms::a)]) -
//       offsetof(GkAtoms, a_string),
//     nsAtom::ComputeIsAsciiLowercase(u"" "a")),
//
#define GK_ATOM(name_, value_)                                                \
  nsStaticAtom(                                                               \
      sizeof(value_) - 1, mozilla::HashString(u"" value_),                    \
      offsetof(GkAtoms, mAtoms[static_cast<size_t>(GkAtoms::Atoms::name_)]) - \
          offsetof(GkAtoms, name_##_string),                                  \
      nsAtom::ComputeIsAsciiLowercase(u"" value_)),
#include "nsGkAtomList.h"
#undef GK_ATOM
    }};

}  // namespace mozilla::detail

const nsStaticAtom* const nsGkAtoms::sAtoms = mozilla::detail::gGkAtoms.mAtoms;
