/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_dom_ReadableStreamBYOBReader_h
#define mozilla_dom_ReadableStreamBYOBReader_h

#include "js/TypeDecls.h"
#include "mozilla/Attributes.h"
#include "mozilla/ErrorResult.h"
#include "mozilla/dom/BindingDeclarations.h"
#include "mozilla/dom/ReadableStreamGenericReader.h"
#include "mozilla/dom/TypedArray.h"
#include "nsCycleCollectionParticipant.h"
#include "nsWrapperCache.h"
#include "mozilla/LinkedList.h"

namespace mozilla::dom {

class Promise;
struct ReadIntoRequest;
class ReadableStream;
struct ReadableStreamBYOBReaderReadOptions;

}  // namespace mozilla::dom

namespace mozilla::dom {

class ReadableStreamBYOBReader final : public ReadableStreamGenericReader,
                                       public nsWrapperCache {
 public:
  NS_DECL_ISUPPORTS_INHERITED
  NS_DECL_CYCLE_COLLECTION_WRAPPERCACHE_CLASS_INHERITED(
      ReadableStreamBYOBReader, ReadableStreamGenericReader)

 public:
  explicit ReadableStreamBYOBReader(nsISupports* aGlobal);

  bool IsDefault() override { return false; };
  bool IsBYOB() override { return true; }
  ReadableStreamDefaultReader* AsDefault() override {
    MOZ_CRASH("Should have verified IsDefault first");
    return nullptr;
  }
  ReadableStreamBYOBReader* AsBYOB() override { return this; }

  JSObject* WrapObject(JSContext* aCx,
                       JS::Handle<JSObject*> aGivenProto) override;

  static already_AddRefed<ReadableStreamBYOBReader> Constructor(
      const GlobalObject& global, ReadableStream& stream, ErrorResult& rv);

  MOZ_CAN_RUN_SCRIPT already_AddRefed<Promise> Read(
      const ArrayBufferView& aArray,
      const ReadableStreamBYOBReaderReadOptions& aOptions, ErrorResult& rv);

  void ReleaseLock(ErrorResult& rv);

  LinkedList<RefPtr<ReadIntoRequest>>& ReadIntoRequests() {
    return mReadIntoRequests;
  }

 private:
  ~ReadableStreamBYOBReader() override = default;

  LinkedList<RefPtr<ReadIntoRequest>> mReadIntoRequests;
};

namespace streams_abstract {

already_AddRefed<ReadableStreamBYOBReader> AcquireReadableStreamBYOBReader(
    ReadableStream* aStream, ErrorResult& aRv);

MOZ_CAN_RUN_SCRIPT void ReadableStreamBYOBReaderRead(
    JSContext* aCx, ReadableStreamBYOBReader* aReader,
    JS::Handle<JSObject*> aView, uint64_t aMin,
    ReadIntoRequest* aReadIntoRequest, ErrorResult& aRv);

void ReadableStreamBYOBReaderErrorReadIntoRequests(
    JSContext* aCx, ReadableStreamBYOBReader* aReader,
    JS::Handle<JS::Value> aError, ErrorResult& aRv);

void ReadableStreamBYOBReaderRelease(JSContext* aCx,
                                     ReadableStreamBYOBReader* aReader,
                                     ErrorResult& aRv);

}  // namespace streams_abstract

}  // namespace mozilla::dom

#endif  // mozilla_dom_ReadableStreamBYOBReader_h
