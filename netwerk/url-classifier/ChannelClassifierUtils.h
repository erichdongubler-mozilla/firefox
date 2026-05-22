/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_net_ChannelClassifierUtils_h
#define mozilla_net_ChannelClassifierUtils_h

#include "nsString.h"

class nsIChannel;

namespace mozilla {
namespace net {

class ChannelClassifierUtils final {
 public:
  static nsresult SetBlockedContent(nsIChannel* aChannel, nsresult aErrorCode,
                                    const nsACString& aList,
                                    const nsACString& aProvider,
                                    const nsACString& aFullHash);

  static void AnnotateChannel(nsIChannel* aChannel,
                              uint32_t aClassificationFlags,
                              uint32_t aLoadingState);

  static void AnnotateChannelWithoutNotifying(nsIChannel* aChannel,
                                              uint32_t aClassificationFlags);

  static bool IsAllowListed(nsIChannel* aChannel);

  static bool IsPassiveContent(nsIChannel* aChannel);

  static bool IsTrackingClassificationFlag(uint32_t aFlag, bool aIsPrivate);

  static bool IsSocialTrackingClassificationFlag(uint32_t aFlag);

  static bool IsCryptominingClassificationFlag(uint32_t aFlag, bool aIsPrivate);

  static void SetClassificationFlagsHelper(nsIChannel* aChannel,
                                           uint32_t aClassificationFlags,
                                           bool aIsThirdParty);
};

}  // namespace net
}  // namespace mozilla

#endif  // mozilla_net_ChannelClassifierUtils_h
