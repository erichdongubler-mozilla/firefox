/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_ContentClassifierService_h
#define mozilla_ContentClassifierService_h

#include "mozilla/Mutex.h"
#include "mozilla/Span.h"
#include "mozilla/StaticPtr.h"
#include "mozilla/ThreadSafety.h"
#include "mozilla/UniquePtr.h"
#include "nsIAsyncShutdown.h"
#include "nsIChannel.h"
#include "nsIClassifiedChannel.h"
#include "nsIContentClassifierService.h"
#include "nsIContentClassifierRemoteSettingsClient.h"
#include "nsISupportsImpl.h"
#include "nsLiteralString.h"
#include "nsTArray.h"
#include "nsTHashMap.h"

#include "mozilla/ContentClassifierEngine.h"

namespace mozilla {

enum class ClassifyMode { Annotate, Cancel };

struct ContentClassifierFeature {
  // Feature identifier used by prefs and lookups.
  nsLiteralCString mName;

  // RemoteSettings record names whose attachments are merged into a
  // single ContentClassifierEngine for this feature.
  Span<const nsLiteralCString> mListIds;

  // nsIClassifiedChannel::ClassificationFlags value set on the channel
  // on an annotation match (consumed via UrlClassifierCommon::Annotate-
  // Channel -> SetClassificationFlagsHelper).
  nsIClassifiedChannel::ClassificationFlags mClassificationFlag;

  // nsIWebProgressListener::STATE_LOADED_* value logged in the content
  // blocking log on an annotation match. The corresponding STATE_BLOCKED_*
  // value for a cancellation match is derived from mBlockingErrorCode by
  // UrlClassifierCommon::SetBlockedContent. Set to 0 for features that
  // only annotate the channel and never emit a content blocking log
  // entry (mirrors UrlClassifierCommon::AnnotateChannelWithoutNotifying
  // behavior).
  uint32_t mLoadedState;

  // NS_ERROR_*_URI value passed to UrlClassifierCommon::SetBlockedContent
  // on a cancellation match. SetBlockedContent uses this to set both the
  // load-info blocking reason and (via GetClassifierBlockingEventCode)
  // the STATE_BLOCKED_* content blocking log entry. Set to NS_OK for
  // features that have no blocking variant in url-classifier; consumers
  // must check this before attempting to use the feature in blocking
  // mode.
  nsresult mBlockingErrorCode;
};

enum class InitPhase {
  NotInited,
  InitSucceeded,
  InitFailed,
  ShutdownStarted,
  ShutdownEnded
};

class ContentClassifierService final : public nsIAsyncShutdownBlocker,
                                       public nsIContentClassifierService {
 public:
  NS_DECL_THREADSAFE_ISUPPORTS
  NS_DECL_NSIASYNCSHUTDOWNBLOCKER
  NS_DECL_NSICONTENTCLASSIFIERSERVICE

  static already_AddRefed<ContentClassifierService> GetInstance();

  static bool IsEnabled();
  static bool IsInitialized();

  // Returns the static table of content classifier features. The table
  // is the single source of truth for how filter list IDs are grouped
  // into engines and how matches are reported.
  static Span<const ContentClassifierFeature> GetFeatures();

  // Returns the feature with the given name, or nullptr if no such
  // feature exists in the static table.
  static const ContentClassifierFeature* GetFeatureByName(
      const nsACString& aName);

  ContentClassifierResult ClassifyForCancel(
      const ContentClassifierRequest& aRequest);
  ContentClassifierResult ClassifyForAnnotate(
      const ContentClassifierRequest& aRequest);

  void CancelChannel(nsIChannel* aChannel);
  void AnnotateChannel(nsIChannel* aChannel);

 private:
  ContentClassifierService();
  ~ContentClassifierService();

  void Init();
  static void OnPrefChange(const char* aPref, void* aData);
  void LoadFilterLists();
  void RebuildEnginesFromStoredData();
  void InitRSClient();
  void ShutdownRSClient();
  void RemoveBlocker();
  already_AddRefed<nsIAsyncShutdownClient> GetAsyncShutdownBarrier() const;

  ContentClassifierResult ClassifyWithEngines(
      const nsTArray<UniquePtr<ContentClassifierEngine>>& aEngines,
      const ContentClassifierRequest& aRequest);

  static StaticRefPtr<ContentClassifierService> sInstance;
  static bool sEnabled;

  mozilla::Mutex mLock MOZ_UNANNOTATED;
  InitPhase mInitPhase MOZ_GUARDED_BY(mLock);
  nsTArray<UniquePtr<ContentClassifierEngine>> mBlockEngines
      MOZ_GUARDED_BY(mLock);
  nsTArray<UniquePtr<ContentClassifierEngine>> mAnnotateEngines
      MOZ_GUARDED_BY(mLock);

  // Raw filter list data stored by list name, populated by the RS client.
  nsTHashMap<nsCStringHashKey, nsTArray<uint8_t>> mFilterListData
      MOZ_GUARDED_BY(mLock);

  // RemoteSettings client for fetching filter lists. All reads and
  // writes must happen on the main thread; each call site asserts.
  nsCOMPtr<nsIContentClassifierRemoteSettingsClient> mRSClient;
};

}  // namespace mozilla

#endif  // mozilla_ContentClassifierService_h
