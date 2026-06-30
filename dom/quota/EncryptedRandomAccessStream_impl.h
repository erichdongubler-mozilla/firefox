/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DOM_QUOTA_ENCRYPTEDRANDOMACCESSSTREAM_IMPL_H_
#define DOM_QUOTA_ENCRYPTEDRANDOMACCESSSTREAM_IMPL_H_

#include <cstring>

#include "EncryptedRandomAccessStream.h"
#include "mozilla/CheckedInt.h"
#include "mozilla/EndianUtils.h"
#include "mozilla/RefPtr.h"
#include "mozilla/Result.h"
#include "mozilla/ResultExtensions.h"
#include "mozilla/Span.h"
#include "nsError.h"
#include "nsIInputStream.h"
#include "nsIOutputStream.h"
#include "nsIRandomAccessStream.h"
#include "nsISeekableStream.h"
#include "nscore.h"

namespace mozilla::dom::quota {

template <typename CipherStrategy>
EncryptedRandomAccessStream<CipherStrategy>::~EncryptedRandomAccessStream() =
    default;

template <typename CipherStrategy>
Result<RefPtr<EncryptedRandomAccessStream<CipherStrategy>>, nsresult>
EncryptedRandomAccessStream<CipherStrategy>::Create(
    CipherStrategy aStrategy,
    MovingNotNull<nsCOMPtr<nsIRandomAccessStream>> aStream,
    CipherStrategy::KeyType aMasterKey) {
  auto stream = MakeRefPtr<EncryptedRandomAccessStream<CipherStrategy>>(
      std::move(aStream), aMasterKey);

  uint64_t baseStreamSize;
  auto rv = stream->mBaseStream->Seek(NS_SEEK_SET, 0);
  if (NS_FAILED(rv)) {
    return Err(rv);
  }
  rv = stream->mBaseStream->InputStream()->Available(&baseStreamSize);
  if (NS_FAILED(rv)) {
    return Err(rv);
  }

  if (baseStreamSize % sBlockSize) {
    return Err(NS_ERROR_CORRUPTED_CONTENT);
  }

  stream->mTotalBlockCount = baseStreamSize / sBlockSize;
  if (stream->mTotalBlockCount == 0) {
    stream->mLogicalSize = 0;
    return stream;
  }

  auto lastBlockIndex = stream->mTotalBlockCount - 1;
  // Because all non-final blocks contain |sMaxTextLength| bytes of logical
  // text, we need the text size of the last block to derive the logical
  // stream size from the physical file size. |LoadBlock()| sets it to
  // |mCurrentBlockTextLength|.
  rv = stream->LoadBlock(lastBlockIndex);
  if (NS_FAILED(rv)) {
    return Err(rv);
  }
  const auto logicalSize = CheckedInt64(lastBlockIndex) * sMaxTextLength +
                           stream->mCurrentBlockTextLength;
  if (!logicalSize.isValid()) {
    return Err(NS_ERROR_FILE_TOO_BIG);
  }
  stream->mLogicalSize = logicalSize.value();

  return stream;
}

template <typename CipherStrategy>
nsresult EncryptedRandomAccessStream<CipherStrategy>::LoadBlock(
    uint64_t aBlockIndex) {
  // |LoadBlock()| must only be called for a block that exists on disk.
  // This also keeps |mTotalBlockCount - 1| below from underflowing.
  if (aBlockIndex >= mTotalBlockCount) {
    return NS_ERROR_UNEXPECTED;
  }

  const auto blockOffset = CheckedInt64(aBlockIndex) * sBlockSize;
  if (!blockOffset.isValid()) {
    return NS_ERROR_FILE_TOO_BIG;
  }
  auto rv = mBaseStream->Seek(NS_SEEK_SET, blockOffset.value());
  if (NS_FAILED(rv)) {
    return rv;
  }
  nsIInputStream* inputStream = mBaseStream->InputStream();

  EncryptedRandomAccessBlock encryptedBlock;
  uint32_t readBytes = 0;
  rv = inputStream->Read(
      AsWritableChars(encryptedBlock.MutableWholeBlock()).Elements(),
      sBlockSize, &readBytes);
  if (NS_FAILED(rv)) {
    return rv;
  }
  // The base random access stream should return a complete block because it
  // receives |sBlockSize| as a |aCount|. So, a short read is treated as a
  // failure here.
  if (readBytes != sBlockSize) {
    return NS_ERROR_CORRUPTED_CONTENT;
  }

  const auto version = encryptedBlock.Version();
  switch (version) {
    case 1: {
      EncryptedRandomAccessBlockCipherMetadataViewV1 metadataView(
          encryptedBlock.MutableCipherMetadata());

      std::array<uint8_t,
                 EncryptedRandomAccessBlock::HeaderSize + sizeof(uint64_t)>
          aad{};
      auto header = encryptedBlock.Header();
      memcpy(aad.data(), header.data(), header.size());
      mozilla::LittleEndian::writeUint64(aad.data() + header.size(),
                                         aBlockIndex);

      typename CipherStrategy::DecryptionInput dInput{
          .mMasterKey = mMasterKey,
          .mBlockNumber = aBlockIndex,
          .mNonce = metadataView.MutableNonce(),
          .mCiphertext = encryptedBlock.CipherPayload(),
          .mAad = aad,
          .mTag = metadataView.MutableAuthenticationTag(),
      };
      std::array<uint8_t, EncryptedRandomAccessBlock::CipherPayloadSize>
          plaintext;
      typename CipherStrategy::DecryptionOutput dOutput{.mPlaintext =
                                                            plaintext};
      rv = CipherStrategy::Decrypt(dInput, dOutput);
      if (NS_FAILED(rv)) {
        return NS_ERROR_CORRUPTED_CONTENT;
      }

      DecryptedRandomAccessBlockCipherPayloadView payloadView(plaintext);
      auto textSize = payloadView.TextLength();
      if (textSize > sMaxTextLength) {
        return NS_ERROR_CORRUPTED_CONTENT;
      }
      // All blocks except the last one must be filled to the maximum
      // length.
      if (aBlockIndex < mTotalBlockCount - 1 && textSize != sMaxTextLength) {
        return NS_ERROR_CORRUPTED_CONTENT;
      }
      mCurrentBlockTextLength = textSize;
      memcpy(mPlainBuffer.data(),
             payloadView.MutableTextAndPadding().Elements(), sMaxTextLength);
      break;
    }
    default: {
      return NS_ERROR_CORRUPTED_CONTENT;
    }
  }

  mCurrentBlockIndex = aBlockIndex;
  mBlockLoaded = true;
  mBlockDirty = false;

  return NS_OK;
}

}  // namespace mozilla::dom::quota

#endif  // DOM_QUOTA_ENCRYPTEDRANDOMACCESSSTREAM_IMPL_H_
