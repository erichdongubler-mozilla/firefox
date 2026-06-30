/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DOM_QUOTA_ENCRYPTEDRANDOMACCESSSTREAM_H_
#define DOM_QUOTA_ENCRYPTEDRANDOMACCESSSTREAM_H_

#include <array>

#include "EncryptedRandomAccessBlock.h"
#include "EncryptedRandomAccessBlockView.h"
#include "ErrorList.h"
#include "mozilla/NotNull.h"
#include "mozilla/RefPtr.h"
#include "mozilla/Result.h"
#include "nsCOMPtr.h"
#include "nsError.h"
#include "nsIInputStream.h"
#include "nsIOutputStream.h"
#include "nsIRandomAccessStream.h"
#include "nsISeekableStream.h"
#include "nsStreamUtils.h"
#include "nscore.h"

namespace mozilla::dom::quota {

/**
 * |EncryptedRandomAccessStream| provides random access to plaintext backed by a
 * sequence of |EncryptedRandomAccessBlock| objects. See
 * |EncryptedRandomAccessBlock| and the corresponding view classes for the
 * on-disk layout.
 *
 * The stream exposes plaintext offsets. These differ from physical offsets in
 * the encrypted base stream, where each block has the fixed size |sBlockSize|.
 * On top of its plaintext, every block also stores per-block overhead that the
 * stream never exposes: a plaintext header, the cipher metadata, and, inside
 * the decrypted payload, a text-length field (see |EncryptedRandomAccessBlock|
 * and |DecryptedRandomAccessBlockCipherPayloadView|). |mLogicalPosition| and
 * |mLogicalSize| count only the plaintext text bytes and exclude all of this
 * overhead, as well as the padding in the final block. All non-final blocks
 * hold |sMaxTextLength| text bytes; only the final block may hold fewer.
 *
 * For example, a base stream containing three encrypted blocks:
 *
 *   On-disk layout, where "ovhd" is the header, metadata and text-length field.
 *   Each block occupies |sBlockSize| bytes:
 *
 *   +----------------------+----------------------+----------------------+
 *   | ovhd |    text 0     | ovhd |    text 1     | ovhd | text 2 | pad   |
 *   +----------------------+----------------------+----------------------+
 *      block 0                block 1               block 2 (final)
 *
 *   Plaintext the stream exposes, i.e. the texts concatenated with the overhead
 *   and padding removed:
 *
 *                         mLogicalPosition = sMaxTextLength + X
 *                                          |
 *                                          v
 *   +----------------------+----------------------+-----------+
 *   |                      |<----- X ----->|      |           |
 *   |<-- sMaxTextLength -->|<-- sMaxTextLength -->|<--- Y --->|
 *   +----------------------+----------------------+-----------+
 *   |<-------- mLogicalSize = 2 * sMaxTextLength + Y -------->|
 *
 *   mTotalBlockCount = 3
 *
 * Physical I/O is delayed where possible. For example, |Seek()| updates only
 * the logical position. A block is loaded when a subsequent read needs it. But,
 * only the final block is loaded eagerly by |Create()| to derive
 * |mLogicalSize|. Other blocks are loaded lazily when a read needs them. So,
 * malformed non-final blocks may not be detected until they are read.
 *
 * This class also implements |nsIInputStream| and |nsIOutputStream| so it can
 * be used with facilities such as |NS_AsyncCopy|.
 */
class EncryptedRandomAccessStreamBase : public nsIRandomAccessStream,
                                        public nsIInputStream,
                                        public nsIOutputStream {
 public:
  NS_DECL_THREADSAFE_ISUPPORTS

  NS_DECL_NSITELLABLESTREAM
  NS_DECL_NSISEEKABLESTREAM
  NS_DECL_NSIRANDOMACCESSSTREAM
  NS_DECL_NSIOUTPUTSTREAM

  // nsIInputStream
  NS_IMETHOD Read(char* aBuf, uint32_t aCount, uint32_t* _retval) override;
  NS_IMETHOD ReadSegments(nsWriteSegmentFun aWriter, void* aClosure,
                          uint32_t aCount, uint32_t* _retval) override;
  NS_IMETHOD Available(uint64_t* _retval) override;

 protected:
  EncryptedRandomAccessStreamBase(
      MovingNotNull<nsCOMPtr<nsIRandomAccessStream>> aStream)
      : mBaseStream(std::move(aStream)) {}

  virtual ~EncryptedRandomAccessStreamBase() = default;

  static constexpr auto sBlockSize = EncryptedRandomAccessBlock::BlockSize;
  static constexpr auto sMaxTextLength =
      DecryptedRandomAccessBlockCipherPayloadView::MaxTextLength;

  virtual nsresult LoadBlock(uint64_t aBlockIndex) = 0;

  nsresult FlushCurrentBlock();

  // Because the current cipher strategies for random access are
  // stateless, this class doesn't have to own a strategy.
  const NotNull<nsCOMPtr<nsIRandomAccessStream>> mBaseStream;

  // |mLogicalPosition| is the current read/write position and |mLogicalSize| is
  // the total size of the plaintext stream, both measured in plaintext bytes
  // from the start of the plaintext stream (see the class comment). These are
  // not physical offsets into the encrypted base stream.
  // They use |uint64_t|, because the file behind the
  // stream can be large.
  uint64_t mLogicalPosition = 0;
  uint64_t mLogicalSize = 0;  // It's initialized in |Create()|.

  uint64_t mTotalBlockCount = 0;  // It's initialized in |Create()|.

  uint64_t mCurrentBlockIndex = 0;
  uint32_t mCurrentBlockTextLength = 0;  // |uint32_t| is enough.
  std::array<uint8_t, sMaxTextLength> mPlainBuffer{};

  bool mBlockLoaded = false;
  bool mBlockDirty = false;

  bool mClosed = false;
};

template <typename CipherStrategy>
class EncryptedRandomAccessStream final
    : public EncryptedRandomAccessStreamBase {
 public:
  /**
   * Creating the stream can fail because initialization reads the final block
   * to derive the logical plaintext size and validate its format.
   */
  static Result<RefPtr<EncryptedRandomAccessStream<CipherStrategy>>, nsresult>
  Create(CipherStrategy aStrategy,
         MovingNotNull<nsCOMPtr<nsIRandomAccessStream>> aStream,
         typename CipherStrategy::KeyType aMasterKey);

 private:
  template <typename T, typename... Args>
  friend RefPtr<T> mozilla::MakeRefPtr(Args&&... aArgs);

  // This class must be initialized by |Create()|.
  EncryptedRandomAccessStream<CipherStrategy>(
      MovingNotNull<nsCOMPtr<nsIRandomAccessStream>> aStream,
      CipherStrategy::KeyType aMasterKey)
      : EncryptedRandomAccessStreamBase(std::move(aStream)),
        mMasterKey(aMasterKey) {}

  ~EncryptedRandomAccessStream();

  nsresult LoadBlock(uint64_t aBlockIndex) override;

  // Because the current cipher strategies for random access are
  // stateless, this class doesn't have to own a strategy.
  const CipherStrategy::KeyType mMasterKey;
};

}  // namespace mozilla::dom::quota

#endif  // DOM_QUOTA_ENCRYPTEDRANDOMACCESSSTREAM_H_
