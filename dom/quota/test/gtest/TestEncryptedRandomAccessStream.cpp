/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <limits>
#include <utility>
#include <vector>

#include "DummyRandomAccessCipherStrategy.h"
#include "EncryptedRandomAccessBlock.h"
#include "EncryptedRandomAccessBlockView.h"
#include "EncryptedRandomAccessStream.h"
#include "EncryptedRandomAccessStream_impl.h"
#include "ErrorList.h"
#include "gtest/gtest.h"
#include "mozilla/EndianUtils.h"
#include "mozilla/NotNull.h"
#include "mozilla/Result.h"
#include "mozilla/ResultExtensions.h"
#include "nsCOMPtr.h"
#include "nsDirectoryServiceDefs.h"
#include "nsDirectoryServiceUtils.h"
#include "nsIFile.h"
#include "nsIFileStreams.h"
#include "nsIRandomAccessStream.h"
#include "nsISeekableStream.h"
#include "nsNetUtil.h"

namespace mozilla::dom::quota::test {

namespace {

constexpr uint16_t kTextLength = 100;
constexpr size_t kMaxTextLength =
    DecryptedRandomAccessBlockCipherPayloadView::MaxTextLength;
constexpr size_t kCipherPayloadOffset =
    EncryptedRandomAccessBlock::BlockSize -
    EncryptedRandomAccessBlock::CipherPayloadSize;

using TestPlaintext = std::vector<uint8_t>;

TestPlaintext CreatePlaintext(size_t aTextLength = kTextLength) {
  TestPlaintext text(aTextLength);
  for (size_t i = 0; i < text.size(); ++i) {
    text[i] = static_cast<uint8_t>('a' + (i % 26));
  }
  return text;
}

template <size_t N>
void XorWithDummyCipherStrategy(std::array<uint8_t, N>& aData) {
  // |DummyRandomAccessCipherStrategy| encrypts and decrypts each byte with this
  // XOR operation.
  for (auto& byte : aData) {
    byte ^= 42;
  }
}

struct FailingDummyRandomAccessCipherStrategy
    : DummyRandomAccessCipherStrategy {
  static nsresult Decrypt(const DecryptionInput&, DecryptionOutput&) {
    return NS_ERROR_FAILURE;
  }
};

nsresult ErrorSegmentWriter(nsIInputStream*, void*, const char*, uint32_t,
                            uint32_t, uint32_t*) {
  return NS_ERROR_FAILURE;
}

struct PartialSegmentWriterClosure {
  explicit PartialSegmentWriterClosure(
      size_t aTextLength,
      uint32_t aMaxTotal = std::numeric_limits<uint32_t>::max())
      : mData(aTextLength), mMaxTotal(aMaxTotal) {}

  std::vector<uint8_t> mData;
  uint32_t mWritten = 0;
  // Once |mWritten| reaches this cap, the writer reports that it consumed no
  // bytes. This exercises the path where the writer refuses to consume data.
  uint32_t mMaxTotal;
};

nsresult PartialSegmentWriter(nsIInputStream*, void* aClosure,
                              const char* aFromSegment, uint32_t aToOffset,
                              uint32_t aCount, uint32_t* aWriteCount) {
  auto* closure = static_cast<PartialSegmentWriterClosure*>(aClosure);
  // Use a small number to force |ReadSegments()| to invoke the writer
  // repeatedly, including when the requested data crosses an encrypted block
  // boundary. Never consume past |mMaxTotal|.
  const uint32_t remaining = closure->mMaxTotal - closure->mWritten;
  *aWriteCount = std::min({aCount, 7u, remaining});
  memcpy(closure->mData.data() + aToOffset, aFromSegment, *aWriteCount);
  closure->mWritten += *aWriteCount;
  return NS_OK;
}

/**
 * Owns a temporary file and its random access stream. Destruction closes the
 * stream before removing the file so individual tests do not need cleanup code.
 */
struct ScopedTestFileStream {
  ScopedTestFileStream(nsCOMPtr<nsIFile> aFile,
                       nsCOMPtr<nsIRandomAccessStream> aStream)
      : mFile(std::move(aFile)), mStream(std::move(aStream)) {}

  ScopedTestFileStream(const ScopedTestFileStream&) = delete;
  ScopedTestFileStream& operator=(const ScopedTestFileStream&) = delete;

  ScopedTestFileStream(ScopedTestFileStream&&) = default;
  ScopedTestFileStream& operator=(ScopedTestFileStream&&) = default;

  ~ScopedTestFileStream() {
    if (mStream) {
      mStream->InputStream()->Close();
    }
    if (mFile) {
      mFile->Remove(false);
    }
  }

  nsCOMPtr<nsIFile> mFile;
  nsCOMPtr<nsIRandomAccessStream> mStream;
};

/**
 * This helper constructs the encrypted block representation directly.
 * This helper is intentionally independent of |EncryptedRandomAccessStream|
 * write implementation so the read implementation can be tested independently.
 *
 * Each generated file is a sequence of encrypted blocks. See
 * |EncryptedRandomAccessBlock| for the complete on-disk format. This helper
 * fills each block as follows. Tests for invalid data create this valid
 * representation first and then overwrite the relevant bytes.
 *
 *  --------+----------------------------------------------------------+
 *   offset | value                                            size    |
 *  --------+----------------------------------------------------------+
 *       0  | Version = 1                                     2 bytes  |
 *       2  | Reserved, zero-filled                          30 bytes  |
 *      32  | CipherMetadata, zero-filled                    32 bytes  |
 *      64  | XOR-encrypted payload                        4032 bytes  |
 *  --------+----------------------------------------------------------+
 *    4096
 *
 * Before the payload is XOR-encrypted, its plaintext layout is:
 *
 *  --------+----------------------------------------------------------+
 *   offset | value                                            size    |
 *  --------+----------------------------------------------------------+
 *       0  | Text length                                     2 bytes  |
 *       2  | Text                                            L bytes  |
 *     2+L  | Padding, zero-filled                    (4030-L) bytes  |
 *  --------+----------------------------------------------------------+
 *    4032
 */
Result<ScopedTestFileStream, nsresult> CreateEncryptedFileStream(
    size_t aTextLength = kTextLength) {
  nsCOMPtr<nsIFile> dir;
  nsresult rv = NS_GetSpecialDirectory(NS_OS_TEMP_DIR, getter_AddRefs(dir));
  if (NS_FAILED(rv)) {
    return Err(rv);
  }

  nsCOMPtr<nsIFile> file;
  rv = dir->Clone(getter_AddRefs(file));
  if (NS_FAILED(rv)) {
    return Err(rv);
  }

  rv = file->Append(u"testfile"_ns);
  if (NS_FAILED(rv)) {
    return Err(rv);
  }

  rv = file->CreateUnique(nsIFile::NORMAL_FILE_TYPE, 0666);
  if (NS_FAILED(rv)) {
    return Err(rv);
  }

  nsCOMPtr<nsIRandomAccessStream> stream;
  rv = NS_NewLocalFileRandomAccessStream(getter_AddRefs(stream), file);
  if (NS_FAILED(rv)) {
    return Err(rv);
  }

  const auto text = CreatePlaintext(aTextLength);
  size_t textOffset = 0;

  // Construct the encrypted block representation directly.
  while (textOffset < text.size()) {
    std::array<uint8_t, EncryptedRandomAccessBlock::BlockSize> data{};

    constexpr uint16_t version = 1;
    mozilla::LittleEndian::writeUint16(data.data(), version);

    std::array<uint8_t, EncryptedRandomAccessBlock::CipherPayloadSize>
        payload{};
    const auto textLength = static_cast<uint16_t>(
        std::min(text.size() - textOffset, kMaxTextLength));
    mozilla::LittleEndian::writeUint16(payload.data(), textLength);
    memcpy(payload.data() + sizeof(textLength), text.data() + textOffset,
           textLength);

    XorWithDummyCipherStrategy(payload);

    memcpy(data.data() + kCipherPayloadOffset, payload.data(), payload.size());

    uint32_t written = 0;
    rv = stream->OutputStream()->Write(
        reinterpret_cast<const char*>(data.data()), data.size(), &written);
    if (NS_FAILED(rv)) {
      return Err(rv);
    }
    if (written != data.size()) {
      return Err(NS_ERROR_FAILURE);
    }

    textOffset += textLength;
  }

  rv = stream->Seek(nsISeekableStream::NS_SEEK_SET, 0);
  if (NS_FAILED(rv)) {
    return Err(rv);
  }

  return ScopedTestFileStream(std::move(file), std::move(stream));
}

RefPtr<EncryptedRandomAccessStream<DummyRandomAccessCipherStrategy>>
CreateEncryptedRandomAccessStream(nsCOMPtr<nsIRandomAccessStream> aBaseStream) {
  DummyRandomAccessCipherStrategy dummyStrategy;
  auto res =
      EncryptedRandomAccessStream<DummyRandomAccessCipherStrategy>::Create(
          dummyStrategy, WrapNotNull(std::move(aBaseStream)),
          DummyRandomAccessCipherStrategy::KeyType{});
  EXPECT_TRUE(res.isOk());
  return res.unwrap();
}

// Exercise the same behavior with one partial block, one full block,
// and a read that must cross into the second block.
class ParameterizedEncryptedRandomAccessStreamTest
    : public testing::TestWithParam<size_t> {};

}  // namespace

// -------------------------
// Tests covering Create()
// -------------------------

TEST(EncryptedRandomAccessStreamTest,
     EncryptedRandomAccessStream_createSucceedsWithEmptyStream)
{
  auto res = CreateEncryptedFileStream();
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  ASSERT_EQ(fileStream.mStream->Seek(nsISeekableStream::NS_SEEK_SET, 0), NS_OK);
  ASSERT_EQ(fileStream.mStream->SetEOF(), NS_OK);

  DummyRandomAccessCipherStrategy dummyStrategy;
  auto streamRes =
      EncryptedRandomAccessStream<DummyRandomAccessCipherStrategy>::Create(
          dummyStrategy, WrapNotNull(fileStream.mStream),
          DummyRandomAccessCipherStrategy::KeyType{});
  ASSERT_TRUE(streamRes.isOk());

  const auto stream = streamRes.unwrap();

  int64_t pos = std::numeric_limits<int64_t>::max();
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, 0);

  uint64_t available = std::numeric_limits<uint64_t>::max();
  ASSERT_EQ(stream->Available(&available), NS_OK);
  EXPECT_EQ(available, uint64_t{0});

  std::array<char, 1> buf{'!'};
  uint32_t read = std::numeric_limits<uint32_t>::max();
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  EXPECT_EQ(read, 0u);
  EXPECT_EQ(buf[0], '!');
}

TEST(EncryptedRandomAccessStreamTest,
     EncryptedRandomAccessStream_createFailsWithInvalidBlockSize)
{
  auto res = CreateEncryptedFileStream();
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  std::array<uint8_t, 1> data{};
  uint32_t written;
  auto rv = fileStream.mStream->Seek(nsISeekableStream::NS_SEEK_END, 0);
  ASSERT_EQ(rv, NS_OK);
  rv = fileStream.mStream->OutputStream()->Write(
      reinterpret_cast<const char*>(data.data()), data.size(), &written);
  ASSERT_EQ(rv, NS_OK);

  DummyRandomAccessCipherStrategy dummyStrategy;
  auto streamRes =
      EncryptedRandomAccessStream<DummyRandomAccessCipherStrategy>::Create(
          dummyStrategy, WrapNotNull(fileStream.mStream),
          DummyRandomAccessCipherStrategy::KeyType{});
  ASSERT_TRUE(streamRes.isErr());
  ASSERT_EQ(streamRes.unwrapErr(), NS_ERROR_CORRUPTED_CONTENT);
}

TEST(EncryptedRandomAccessStreamTest,
     EncryptedRandomAccessStream_createFailsWithUnsupportedVersion)
{
  auto res = CreateEncryptedFileStream();
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  constexpr uint16_t version = 2;
  uint32_t written;
  ASSERT_EQ(fileStream.mStream->Seek(nsISeekableStream::NS_SEEK_SET, 0), NS_OK);
  ASSERT_EQ(
      fileStream.mStream->OutputStream()->Write(
          reinterpret_cast<const char*>(&version), sizeof(version), &written),
      NS_OK);
  ASSERT_EQ(written, sizeof(version));

  DummyRandomAccessCipherStrategy dummyStrategy;
  auto streamRes =
      EncryptedRandomAccessStream<DummyRandomAccessCipherStrategy>::Create(
          dummyStrategy, WrapNotNull(fileStream.mStream),
          DummyRandomAccessCipherStrategy::KeyType{});
  ASSERT_TRUE(streamRes.isErr());
  ASSERT_EQ(streamRes.unwrapErr(), NS_ERROR_CORRUPTED_CONTENT);
}

TEST(EncryptedRandomAccessStreamTest,
     EncryptedRandomAccessStream_createFailsWithInvalidTextLength)
{
  auto res = CreateEncryptedFileStream();
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  // Write invalid length data on the stream.
  std::array<uint8_t, EncryptedRandomAccessBlock::CipherPayloadSize> payload{};
  uint16_t textLength =
      DecryptedRandomAccessBlockCipherPayloadView::MaxTextLength +
      1;  // invalid data length.
  mozilla::LittleEndian::writeUint16(payload.data(), textLength);

  const auto text = CreatePlaintext();
  memcpy(payload.data() + sizeof(textLength), text.data(), text.size());

  XorWithDummyCipherStrategy(payload);

  uint32_t written;
  auto rv = fileStream.mStream->Seek(nsISeekableStream::NS_SEEK_SET,
                                     kCipherPayloadOffset);
  ASSERT_EQ(rv, NS_OK);
  rv = fileStream.mStream->OutputStream()->Write(
      reinterpret_cast<const char*>(payload.data()), payload.size(), &written);
  ASSERT_EQ(rv, NS_OK);
  ASSERT_EQ(written, EncryptedRandomAccessBlock::CipherPayloadSize);

  // Fail with invalid length data.
  DummyRandomAccessCipherStrategy dummyStrategy;
  auto streamRes =
      EncryptedRandomAccessStream<DummyRandomAccessCipherStrategy>::Create(
          dummyStrategy, WrapNotNull(fileStream.mStream),
          DummyRandomAccessCipherStrategy::KeyType{});
  ASSERT_TRUE(streamRes.isErr());
  ASSERT_EQ(streamRes.unwrapErr(), NS_ERROR_CORRUPTED_CONTENT);
}

TEST(EncryptedRandomAccessStreamTest,
     EncryptedRandomAccessStream_createFailsWithUndecryptableData)
{
  auto res = CreateEncryptedFileStream();
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  FailingDummyRandomAccessCipherStrategy strategy;
  auto streamRes =
      EncryptedRandomAccessStream<FailingDummyRandomAccessCipherStrategy>::
          Create(strategy, WrapNotNull(fileStream.mStream),
                 FailingDummyRandomAccessCipherStrategy::KeyType{});
  ASSERT_TRUE(streamRes.isErr());
  ASSERT_EQ(streamRes.unwrapErr(), NS_ERROR_CORRUPTED_CONTENT);
}

// -------------------------
// Tests covering Read()
// -------------------------

TEST_P(ParameterizedEncryptedRandomAccessStreamTest,
       EncryptedRandomAccessStream_readFromTheStartToTheMiddleReturnsPrefix) {
  const auto textLength = GetParam();
  auto res = CreateEncryptedFileStream(textLength);
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  std::vector<char> buf(textLength / 2);
  uint32_t read = 0;
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, textLength / 2);

  const auto expected = CreatePlaintext(textLength);
  for (size_t i = 0; i < expected.size() / 2; ++i) {
    EXPECT_EQ(static_cast<uint8_t>(buf[i]), expected[i]);
  }
}

TEST_P(ParameterizedEncryptedRandomAccessStreamTest,
       EncryptedRandomAccessStream_readFromTheMiddleToTheEndReturnsSuffix) {
  const auto textLength = GetParam();
  auto res = CreateEncryptedFileStream(textLength);
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  const auto suffixLength = textLength / 2;
  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_END,
                         -static_cast<int64_t>(suffixLength)),
            NS_OK);

  constexpr size_t sentinelLength = 10;
  std::vector<char> buf(suffixLength + sentinelLength, '!');
  uint32_t read = 0;
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, suffixLength);

  const auto expected = CreatePlaintext(textLength);
  for (size_t i = 0; i < suffixLength; ++i) {
    EXPECT_EQ(static_cast<uint8_t>(buf[i]),
              expected[textLength - suffixLength + i]);
  }
  for (size_t i = suffixLength; i < buf.size(); ++i) {
    EXPECT_EQ(buf[i], '!');
  }
}

TEST_P(ParameterizedEncryptedRandomAccessStreamTest,
       EncryptedRandomAccessStream_readFromTheStartToTheEndReturnsFullData) {
  const auto textLength = GetParam();
  auto res = CreateEncryptedFileStream(textLength);
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  std::vector<char> buf(textLength);
  uint32_t read = 0;
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, textLength);

  const auto expected = CreatePlaintext(textLength);
  for (size_t i = 0; i < expected.size(); ++i) {
    EXPECT_EQ(static_cast<uint8_t>(buf[i]), expected[i]);
  }
}

TEST_P(ParameterizedEncryptedRandomAccessStreamTest,
       EncryptedRandomAccessStream_readFromTheStartToPastEndReturnsFullText) {
  const auto textLength = GetParam();
  auto res = CreateEncryptedFileStream(textLength);
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  std::vector<char> buf(textLength * 2, '!');
  uint32_t read = 0;
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, textLength);

  const auto expected = CreatePlaintext(textLength);
  for (size_t i = 0; i < expected.size(); ++i) {
    EXPECT_EQ(static_cast<uint8_t>(buf[i]), expected[i]);
  }
  // Check if the rest of data is not written.
  for (size_t i = expected.size(); i < buf.size(); ++i) {
    EXPECT_EQ(buf[i], '!');
  }
}

TEST_P(ParameterizedEncryptedRandomAccessStreamTest,
       EncryptedRandomAccessStream_readFromTheEndReturnsNoData) {
  const auto textLength = GetParam();
  auto res = CreateEncryptedFileStream(textLength);
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  std::vector<char> buf(textLength);
  uint32_t read = 0;
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, textLength);

  const auto expected = CreatePlaintext(textLength);
  for (size_t i = 0; i < expected.size(); ++i) {
    EXPECT_EQ(static_cast<uint8_t>(buf[i]), expected[i]);
  }

  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, 0u);
  for (size_t i = 0; i < expected.size(); ++i) {
    EXPECT_EQ(static_cast<uint8_t>(buf[i]), expected[i]);
  }
}

TEST(EncryptedRandomAccessStreamTest,
     EncryptedRandomAccessStream_readFailsWithPartiallyFilledNonFinalBlock)
{
  auto res = CreateEncryptedFileStream(kMaxTextLength + kTextLength);
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  // Make the text length of the first block shorter than |kMaxTextLength|.
  // Because it is not the last block, this is an invalid on-disk layout.
  std::array<uint8_t, EncryptedRandomAccessBlock::CipherPayloadSize> payload{};
  constexpr uint16_t textLength = kMaxTextLength - 1;
  mozilla::LittleEndian::writeUint16(payload.data(), textLength);
  XorWithDummyCipherStrategy(payload);

  ASSERT_EQ(fileStream.mStream->Seek(nsISeekableStream::NS_SEEK_SET,
                                     kCipherPayloadOffset),
            NS_OK);

  uint32_t written = 0;
  ASSERT_EQ(fileStream.mStream->OutputStream()->Write(
                reinterpret_cast<const char*>(payload.data()), payload.size(),
                &written),
            NS_OK);
  ASSERT_EQ(written, payload.size());

  // Try to read, but that fails.
  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  std::array<char, 1> buf{};
  uint32_t read = std::numeric_limits<uint32_t>::max();
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read),
            NS_ERROR_CORRUPTED_CONTENT);
  EXPECT_EQ(read, 0u);
}

TEST(EncryptedRandomAccessStreamTest,
     EncryptedRandomAccessStream_readWithZeroLengthReturnsNoData)
{
  auto res = CreateEncryptedFileStream();
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  std::array<char, 1> buf{'!'};
  uint32_t read = std::numeric_limits<uint32_t>::max();
  ASSERT_EQ(stream->Read(buf.data(), 0, &read), NS_OK);
  ASSERT_EQ(read, 0u);
  EXPECT_EQ(buf[0], '!');

  int64_t pos;
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, 0);
}

TEST_P(ParameterizedEncryptedRandomAccessStreamTest,
       EncryptedRandomAccessStream_readAdvancesCursorPosition) {
  const auto textLength = GetParam();
  auto res = CreateEncryptedFileStream(textLength);
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  std::vector<char> buf(textLength / 2);
  uint32_t read = 0;
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, textLength / 2);

  const auto expected = CreatePlaintext(textLength);
  for (size_t i = 0; i < expected.size() / 2; ++i) {
    EXPECT_EQ(static_cast<uint8_t>(buf[i]), expected[i]);
  }

  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, textLength / 2);

  for (size_t i = 0; i < expected.size() / 2; ++i) {
    EXPECT_EQ(static_cast<uint8_t>(buf[i]), expected[i + expected.size() / 2]);
  }
}

// -------------------------
// Tests covering ReadSegments()
// -------------------------

TEST_P(
    ParameterizedEncryptedRandomAccessStreamTest,
    EncryptedRandomAccessStream_readSegmentsWithPartialWriterReturnsRequestedData) {
  const auto textLength = GetParam();
  auto res = CreateEncryptedFileStream(textLength);
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  PartialSegmentWriterClosure closure(textLength);
  uint32_t read = 0;
  ASSERT_EQ(
      stream->ReadSegments(PartialSegmentWriter, &closure, textLength, &read),
      NS_OK);
  ASSERT_EQ(read, textLength);
  EXPECT_EQ(closure.mWritten, textLength);

  const auto expected = CreatePlaintext(textLength);
  for (size_t i = 0; i < expected.size(); ++i) {
    EXPECT_EQ(closure.mData[i], expected[i]);
  }

  int64_t pos;
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, static_cast<int64_t>(textLength));
}

TEST(
    EncryptedRandomAccessStreamTest,
    EncryptedRandomAccessStream_readSegmentsSwallowsWriterErrorWithoutAdvancingPosition)
{
  auto res = CreateEncryptedFileStream();
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  uint32_t read = std::numeric_limits<uint32_t>::max();
  ASSERT_EQ(
      stream->ReadSegments(ErrorSegmentWriter, nullptr, kTextLength, &read),
      NS_OK);
  ASSERT_EQ(read, 0u);

  int64_t pos;
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, 0);
}

// As nsIInputStream.idl documents for readSegments ("0 if reached
// end-of-file (or if aWriter refused to consume data)"), a writer that consumes
// nothing signals that ReadSegments should stop rather than fail.
// So, in this case, the writer consumes 7 bytes on its first call and then
// refuses to consume more (reports zero bytes). |ReadSegments()| must stop,
// succeed, and report only the bytes already consumed, leaving the position
// advanced by that amount.
TEST(
    EncryptedRandomAccessStreamTest,
    EncryptedRandomAccessStream_readSegmentsStopsWhenWriterRefusesToConsumeAndKeepsProgress)
{
  auto res = CreateEncryptedFileStream();
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  constexpr uint32_t kCap = 7;
  PartialSegmentWriterClosure closure(kTextLength, kCap);
  uint32_t read = std::numeric_limits<uint32_t>::max();
  ASSERT_EQ(
      stream->ReadSegments(PartialSegmentWriter, &closure, kTextLength, &read),
      NS_OK);
  EXPECT_EQ(read, kCap);
  EXPECT_EQ(closure.mWritten, kCap);

  int64_t pos;
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, static_cast<int64_t>(kCap));

  const auto expected = CreatePlaintext();
  for (size_t i = 0; i < kCap; ++i) {
    EXPECT_EQ(closure.mData[i], expected[i]);
  }
}

// -------------------------
// Tests covering Seek()
// -------------------------

TEST(EncryptedRandomAccessStreamTest,
     EncryptedRandomAccessStream_seekSetChangesReadPosition)
{
  auto res = CreateEncryptedFileStream();
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  constexpr uint32_t offset = 13;
  constexpr uint32_t count = 17;
  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_SET, offset), NS_OK);

  std::array<char, count> buf{};
  uint32_t read = 0;
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, count);

  const auto expected = CreatePlaintext();
  for (size_t i = 0; i < buf.size(); ++i) {
    EXPECT_EQ(static_cast<uint8_t>(buf[i]), expected[i + offset]);
  }
}

TEST(EncryptedRandomAccessStreamTest,
     EncryptedRandomAccessStream_seekCurChangesReadPosition)
{
  auto res = CreateEncryptedFileStream();
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  constexpr uint32_t initialOffset = 10;
  constexpr uint32_t relativeOffset = 7;
  constexpr uint32_t expectedOffset = initialOffset + relativeOffset;
  constexpr uint32_t count = 13;

  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_SET, initialOffset), NS_OK);
  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_CUR, relativeOffset),
            NS_OK);

  std::array<char, count> buf{};
  uint32_t read = 0;
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, count);

  const auto expected = CreatePlaintext();
  for (size_t i = 0; i < buf.size(); ++i) {
    EXPECT_EQ(static_cast<uint8_t>(buf[i]), expected[i + expectedOffset]);
  }
}

TEST_P(ParameterizedEncryptedRandomAccessStreamTest,
       EncryptedRandomAccessStream_seekEndChangesReadPosition) {
  const auto textLength = GetParam();
  auto res = CreateEncryptedFileStream(textLength);
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_END, -20), NS_OK);

  std::array<char, 20> buf{};
  uint32_t read = 0;
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, 20u);

  const auto expected = CreatePlaintext(textLength);
  const auto expectedOffset = textLength - 20;
  for (size_t i = 0; i < buf.size(); ++i) {
    EXPECT_EQ(static_cast<uint8_t>(buf[i]), expected[i + expectedOffset]);
  }
}

TEST(
    EncryptedRandomAccessStreamTest,
    EncryptedRandomAccessStream_seekSetThenReadAcrossBlockBoundaryReturnsRequestedData)
{
  constexpr uint32_t offset = kMaxTextLength - 10;
  constexpr uint32_t count = 20;

  auto res = CreateEncryptedFileStream(kMaxTextLength + count);
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_SET, offset), NS_OK);

  std::array<char, count> buf{};
  uint32_t read = 0;
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, count);

  const auto expected = CreatePlaintext(kMaxTextLength + count);
  for (size_t i = 0; i < buf.size(); ++i) {
    EXPECT_EQ(static_cast<uint8_t>(buf[i]), expected[i + offset]);
  }
}

TEST(
    EncryptedRandomAccessStreamTest,
    EncryptedRandomAccessStream_seekCurThenReadAcrossBlockBoundaryReturnsRequestedData)
{
  constexpr uint32_t initialOffset = kMaxTextLength - 20;
  constexpr uint32_t relativeOffset = 10;
  constexpr uint32_t expectedOffset = initialOffset + relativeOffset;
  constexpr uint32_t count = 20;

  auto res = CreateEncryptedFileStream(kMaxTextLength + count);
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_SET, initialOffset), NS_OK);
  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_CUR, relativeOffset),
            NS_OK);

  std::array<char, count> buf{};
  uint32_t read = 0;
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, count);

  const auto expected = CreatePlaintext(kMaxTextLength + count);
  for (size_t i = 0; i < buf.size(); ++i) {
    EXPECT_EQ(static_cast<uint8_t>(buf[i]), expected[i + expectedOffset]);
  }
}

TEST(
    EncryptedRandomAccessStreamTest,
    EncryptedRandomAccessStream_seekEndThenReadAcrossBlockBoundaryReturnsRequestedData)
{
  constexpr int32_t count = 20;
  constexpr int32_t textLength = kMaxTextLength + 10;

  auto res = CreateEncryptedFileStream(textLength);
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_END, -count), NS_OK);

  std::array<char, count> buf{};
  uint32_t read = 0;
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(static_cast<int32_t>(read), count);

  const auto expected = CreatePlaintext(textLength);
  for (size_t i = 0; i < buf.size(); ++i) {
    EXPECT_EQ(static_cast<uint8_t>(buf[i]), expected[i + textLength - count]);
  }
}

TEST_P(ParameterizedEncryptedRandomAccessStreamTest,
       EncryptedRandomAccessStream_seekToEndLeavesNoReadableData) {
  const auto textLength = GetParam();
  auto res = CreateEncryptedFileStream(textLength);
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_SET, textLength), NS_OK);

  int64_t pos = std::numeric_limits<int64_t>::max();
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, static_cast<int64_t>(textLength));

  std::array<char, 1> buf{'!'};
  uint32_t read = std::numeric_limits<uint32_t>::max();
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  EXPECT_EQ(read, 0u);
  EXPECT_EQ(buf[0], '!');

  uint64_t available = std::numeric_limits<uint64_t>::max();
  ASSERT_EQ(stream->Available(&available), NS_OK);
  EXPECT_EQ(available, uint64_t{0});
}

TEST_P(
    ParameterizedEncryptedRandomAccessStreamTest,
    EncryptedRandomAccessStream_seekPastEndUpdatesPositionAndLeavesNoAvailableData) {
  const auto textLength = GetParam();
  auto res1 = CreateEncryptedFileStream(textLength);
  ASSERT_TRUE(res1.isOk());

  auto fileStream = res1.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  int64_t pos;
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, 0);

  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_SET, textLength + 100),
            NS_OK);

  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, static_cast<int64_t>(textLength + 100));

  std::vector<char> buf(textLength);
  uint32_t read = std::numeric_limits<uint32_t>::max();
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, 0u);

  uint64_t available = std::numeric_limits<uint64_t>::max();
  ASSERT_EQ(stream->Available(&available), NS_OK);
  EXPECT_EQ(available, uint64_t{0});
}

TEST(EncryptedRandomAccessStreamTest,
     EncryptedRandomAccessStream_seekPastUint32MaxSucceeds)
{
  auto res = CreateEncryptedFileStream();
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  constexpr int64_t offset =
      static_cast<int64_t>(std::numeric_limits<uint32_t>::max()) + 1;
  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_SET, offset), NS_OK);

  int64_t pos;
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, offset);
}

TEST_P(ParameterizedEncryptedRandomAccessStreamTest,
       EncryptedRandomAccessStream_seekFailsWithNegativePosition) {
  const auto textLength = GetParam();
  auto res1 = CreateEncryptedFileStream(textLength);
  ASSERT_TRUE(res1.isOk());

  auto fileStream = res1.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  int64_t pos;
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, 0);

  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_SET, -10),
            nsresult::NS_ERROR_INVALID_ARG);
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, 0);

  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_CUR, -10),
            nsresult::NS_ERROR_INVALID_ARG);
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, 0);

  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_END,
                         -static_cast<int64_t>(textLength + 1)),
            nsresult::NS_ERROR_INVALID_ARG);
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, 0);
}

// -------------------------
// Tests covering Tell()
// -------------------------

TEST_P(ParameterizedEncryptedRandomAccessStreamTest,
       EncryptedRandomAccessStream_tellTracksSeekPosition) {
  const auto textLength = GetParam();
  auto res1 = CreateEncryptedFileStream(textLength);
  ASSERT_TRUE(res1.isOk());

  auto fileStream = res1.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  int64_t pos;
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, 0);

  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_SET, 64), NS_OK);
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, 64);

  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_CUR, 10), NS_OK);
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, 74);

  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_END, -1), NS_OK);
  ASSERT_EQ(stream->Tell(&pos), NS_OK);
  EXPECT_EQ(pos, static_cast<int64_t>(textLength - 1));
}

// -------------------------
// Tests covering Available()
// -------------------------

TEST_P(ParameterizedEncryptedRandomAccessStreamTest,
       EncryptedRandomAccessStream_availableTracksPosition) {
  const auto textLength = GetParam();
  auto res1 = CreateEncryptedFileStream(textLength);
  ASSERT_TRUE(res1.isOk());

  auto fileStream = res1.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  uint64_t available;
  ASSERT_EQ(stream->Available(&available), NS_OK);
  EXPECT_EQ(available, textLength);

  std::vector<char> buf(textLength / 2);
  uint32_t read = 0;
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  ASSERT_EQ(read, textLength / 2);

  ASSERT_EQ(stream->Available(&available), NS_OK);
  EXPECT_EQ(available, textLength / 2);

  ASSERT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_CUR, -10), NS_OK);
  ASSERT_EQ(stream->Available(&available), NS_OK);
  EXPECT_EQ(available, textLength / 2 + 10);
}

// -------------------------
// Tests covering Close()
// -------------------------

TEST(EncryptedRandomAccessStreamTest,
     EncryptedRandomAccessStream_closeUpdatesStreamStatus)
{
  auto res = CreateEncryptedFileStream();
  ASSERT_TRUE(res.isOk());

  auto fileStream = res.unwrap();
  ASSERT_TRUE(fileStream.mStream);

  auto stream = CreateEncryptedRandomAccessStream(fileStream.mStream);

  ASSERT_EQ(stream->StreamStatus(), NS_OK);
  ASSERT_EQ(stream->Close(), NS_OK);

  // It's ok to call |Close()| more than once.
  ASSERT_EQ(stream->Close(), NS_OK);

  std::array<char, 1> buf{};
  uint32_t read = std::numeric_limits<uint32_t>::max();
  ASSERT_EQ(stream->Read(buf.data(), buf.size(), &read), NS_OK);
  EXPECT_EQ(read, 0u);

  uint64_t available;
  EXPECT_EQ(stream->Available(&available), NS_BASE_STREAM_CLOSED);
  EXPECT_EQ(stream->StreamStatus(), NS_BASE_STREAM_CLOSED);
  EXPECT_EQ(stream->Seek(nsISeekableStream::NS_SEEK_SET, 0),
            NS_BASE_STREAM_CLOSED);

  int64_t pos;
  EXPECT_EQ(stream->Tell(&pos), NS_BASE_STREAM_CLOSED);

  bool nonBlocking;
  EXPECT_EQ(stream->IsNonBlocking(&nonBlocking), NS_OK);
  EXPECT_FALSE(nonBlocking);
}

INSTANTIATE_TEST_SUITE_P(EncryptedRandomAccessStreamTextLengths,
                         ParameterizedEncryptedRandomAccessStreamTest,
                         testing::Values(kTextLength, kMaxTextLength,
                                         kMaxTextLength + kTextLength),
                         [](const testing::TestParamInfo<size_t>& aInfo) {
                           switch (aInfo.param) {
                             case kTextLength:
                               return "PartialSingleBlock";
                             case kMaxTextLength:
                               return "FullSingleBlock";
                             case kMaxTextLength + kTextLength:
                               return "PartialSecondBlock";
                             default:
                               MOZ_CRASH("Unexpected text length.");
                           }
                         });

}  // namespace mozilla::dom::quota::test
