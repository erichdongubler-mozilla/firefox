/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tab group state shapes are documented as JSDoc typedefs in
// TabGroupState.sys.mjs. Aliasing them here makes them available to every
// module in the project without a per-module `@import`.

type TabGroupId = import("../TabGroupState.sys.mjs").TabGroupId;
type TabGroupStateData = import("../TabGroupState.sys.mjs").TabGroupStateData;
type ClosedTabGroupStateData =
  import("../TabGroupState.sys.mjs").ClosedTabGroupStateData;
type SavedTabGroupStateData =
  import("../TabGroupState.sys.mjs").SavedTabGroupStateData;
