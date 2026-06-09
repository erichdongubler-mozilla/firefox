/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef _nsClipboardGtk_h_
#define _nsClipboardGtk_h_

#include "mozilla/Mutex.h"
#include "nsClipboard.h"

class RetrievalContextGtk final : public RetrievalContext {
 public:
  RetrievalContextGtk();

  ClipboardData GetClipboardData(const char* aMimeType,
                                 int32_t aWhichClipboard) override;
  mozilla::GUniquePtr<char> GetClipboardText(int32_t aWhichClipboard) override;
  ClipboardTargets GetTargets(int32_t aWhichClipboard) override;

  void ClearCachedTargets(int32_t aWhichClipboard) override;

 private:
  ClipboardTargets GetTargetsImpl(int32_t aWhichClipboard);

  ClipboardData WaitForClipboardData(ClipboardDataType, int32_t aWhichClipboard,
                                     const char* aMimeType = nullptr);

  static ClipboardTargets sClipboardTargets;
  static ClipboardTargets sPrimaryTargets;
};

#endif /* _nsClipboardGtk_h_ */
