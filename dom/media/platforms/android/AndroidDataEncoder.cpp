/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "AndroidDataEncoder.h"

#include "AnnexB.h"
#include "H264.h"
#include "MediaData.h"
#include "MediaInfo.h"

#include "ImageContainer.h"
#include "libyuv/convert_from.h"
#include "mozilla/Logging.h"
#include "mozilla/Unused.h"
#include "nsThreadUtils.h"

namespace mozilla {

extern LazyLogModule sPEMLog;
#define AND_ENC_LOG(arg, ...)                \
  MOZ_LOG(sPEMLog, mozilla::LogLevel::Debug, \
          ("AndroidDataEncoder(%p)::%s: " arg, this, __func__, ##__VA_ARGS__))
#define AND_ENC_LOGE(arg, ...)               \
  MOZ_LOG(sPEMLog, mozilla::LogLevel::Error, \
          ("AndroidDataEncoder(%p)::%s: " arg, this, __func__, ##__VA_ARGS__))

#define REJECT_IF_ERROR()                                                \
  do {                                                                   \
    if (mError) {                                                        \
      auto error = mError.value();                                       \
      mError.reset();                                                    \
      return EncodePromise::CreateAndReject(std::move(error), __func__); \
    }                                                                    \
  } while (0)

RefPtr<MediaDataEncoder::InitPromise> AndroidDataEncoder::Init() {
  // Sanity-check the input size for Android software encoder fails to do it.
  if (mConfig.mSize.width == 0 || mConfig.mSize.height == 0) {
    return InitPromise::CreateAndReject(NS_ERROR_ILLEGAL_VALUE, __func__);
  }

  return InvokeAsync(mTaskQueue, this, __func__,
                     &AndroidDataEncoder::ProcessInit);
}

static const char* MimeTypeOf(CodecType aCodec) {
  switch (aCodec) {
    case CodecType::H264:
      return "video/avc";
    case CodecType::VP8:
      return "video/x-vnd.on2.vp8";
    case CodecType::VP9:
      return "video/x-vnd.on2.vp9";
    default:
      return "";
  }
}

using FormatResult = Result<java::sdk::MediaFormat::LocalRef, MediaResult>;

FormatResult ToMediaFormat(const EncoderConfig& aConfig) {
  nsresult rv = NS_OK;
  java::sdk::MediaFormat::LocalRef format;
  rv = java::sdk::MediaFormat::CreateVideoFormat(MimeTypeOf(aConfig.mCodec),
                                                 aConfig.mSize.width,
                                                 aConfig.mSize.height, &format);
  NS_ENSURE_SUCCESS(
      rv, FormatResult(MediaResult(NS_ERROR_DOM_MEDIA_FATAL_ERR,
                                   "fail to create Java MediaFormat object")));

  rv =
      format->SetInteger(java::sdk::MediaFormat::KEY_BITRATE_MODE, 2 /* CBR */);
  NS_ENSURE_SUCCESS(rv, FormatResult(MediaResult(NS_ERROR_DOM_MEDIA_FATAL_ERR,
                                                 "fail to set bitrate mode")));

  rv = format->SetInteger(java::sdk::MediaFormat::KEY_BIT_RATE,
                          AssertedCast<int>(aConfig.mBitrate));
  NS_ENSURE_SUCCESS(rv, FormatResult(MediaResult(NS_ERROR_DOM_MEDIA_FATAL_ERR,
                                                 "fail to set bitrate")));

  // COLOR_FormatYUV420SemiPlanar(NV12) is the most widely supported
  // format.
  rv = format->SetInteger(java::sdk::MediaFormat::KEY_COLOR_FORMAT, 0x15);
  NS_ENSURE_SUCCESS(rv, FormatResult(MediaResult(NS_ERROR_DOM_MEDIA_FATAL_ERR,
                                                 "fail to set color format")));

  rv = format->SetInteger(java::sdk::MediaFormat::KEY_FRAME_RATE,
                          aConfig.mFramerate);
  NS_ENSURE_SUCCESS(rv, FormatResult(MediaResult(NS_ERROR_DOM_MEDIA_FATAL_ERR,
                                                 "fail to set frame rate")));

  // Ensure interval >= 1. A negative value means no key frames are
  // requested after the first frame. A zero value means a stream
  // containing all key frames is requested.
  int32_t intervalInSec = AssertedCast<int32_t>(
      std::max<size_t>(1, aConfig.mKeyframeInterval / aConfig.mFramerate));
  rv = format->SetInteger(java::sdk::MediaFormat::KEY_I_FRAME_INTERVAL,
                          intervalInSec);
  NS_ENSURE_SUCCESS(rv,
                    FormatResult(MediaResult(NS_ERROR_DOM_MEDIA_FATAL_ERR,
                                             "fail to set I-frame interval")));

  return format;
}

RefPtr<MediaDataEncoder::InitPromise> AndroidDataEncoder::ProcessInit() {
  AssertOnTaskQueue();
  MOZ_ASSERT(!mJavaEncoder);

  java::sdk::MediaCodec::BufferInfo::LocalRef bufferInfo;
  if (NS_FAILED(java::sdk::MediaCodec::BufferInfo::New(&bufferInfo)) ||
      !bufferInfo) {
    return InitPromise::CreateAndReject(NS_ERROR_OUT_OF_MEMORY, __func__);
  }
  mInputBufferInfo = bufferInfo;

  FormatResult result = ToMediaFormat(mConfig);
  if (result.isErr()) {
    return InitPromise::CreateAndReject(result.unwrapErr(), __func__);
  }
  mFormat = result.unwrap();

  // Register native methods.
  JavaCallbacksSupport::Init();

  mJavaCallbacks = java::CodecProxy::NativeCallbacks::New();
  if (!mJavaCallbacks) {
    return InitPromise::CreateAndReject(
        MediaResult(NS_ERROR_DOM_MEDIA_FATAL_ERR,
                    "cannot create Java callback object"),
        __func__);
  }
  JavaCallbacksSupport::AttachNative(
      mJavaCallbacks, mozilla::MakeUnique<CallbacksSupport>(this));

  mJavaEncoder = java::CodecProxy::Create(true /* encoder */, mFormat, nullptr,
                                          mJavaCallbacks, u""_ns);
  if (!mJavaEncoder) {
    return InitPromise::CreateAndReject(
        MediaResult(NS_ERROR_DOM_MEDIA_FATAL_ERR,
                    "cannot create Java encoder object"),
        __func__);
  }

  mIsHardwareAccelerated = mJavaEncoder->IsHardwareAccelerated();
  mDrainState = DrainState::DRAINABLE;

  return InitPromise::CreateAndResolve(TrackInfo::kVideoTrack, __func__);
}

RefPtr<MediaDataEncoder::EncodePromise> AndroidDataEncoder::Encode(
    const MediaData* aSample) {
  RefPtr<AndroidDataEncoder> self = this;
  MOZ_ASSERT(aSample != nullptr);

  RefPtr<const MediaData> sample(aSample);
  return InvokeAsync(mTaskQueue, __func__,
                     [self, sample]() { return self->ProcessEncode(sample); });
}

static jni::ByteBuffer::LocalRef ConvertI420ToNV12Buffer(
    RefPtr<const VideoData>& aSample, RefPtr<MediaByteBuffer>& aYUVBuffer,
    int aStride, int aYPlaneHeight) {
  const layers::PlanarYCbCrImage* image = aSample->mImage->AsPlanarYCbCrImage();
  MOZ_ASSERT(image);
  const layers::PlanarYCbCrData* yuv = image->GetData();
  auto ySize = yuv->YDataSize();
  auto cbcrSize = yuv->CbCrDataSize();
  // If we have a stride or height passed in from the Codec we need to use
  // those.
  auto yStride = aStride != 0 ? aStride : yuv->mYStride;
  auto height = aYPlaneHeight != 0 ? aYPlaneHeight : ySize.height;
  size_t yLength = yStride * height;
  size_t length =
      yLength + yStride * (cbcrSize.height - 1) + cbcrSize.width * 2;

  if (!aYUVBuffer || aYUVBuffer->Capacity() < length) {
    aYUVBuffer = MakeRefPtr<MediaByteBuffer>(length);
    aYUVBuffer->SetLength(length);
  } else {
    MOZ_ASSERT(aYUVBuffer->Length() >= length);
  }

  if (libyuv::I420ToNV12(yuv->mYChannel, yuv->mYStride, yuv->mCbChannel,
                         yuv->mCbCrStride, yuv->mCrChannel, yuv->mCbCrStride,
                         aYUVBuffer->Elements(), yStride,
                         aYUVBuffer->Elements() + yLength, yStride, ySize.width,
                         ySize.height) != 0) {
    return nullptr;
  }

  return jni::ByteBuffer::New(aYUVBuffer->Elements(), aYUVBuffer->Length());
}

RefPtr<MediaDataEncoder::EncodePromise> AndroidDataEncoder::ProcessEncode(
    const RefPtr<const MediaData>& aSample) {
  AssertOnTaskQueue();

  REJECT_IF_ERROR();

  RefPtr<const VideoData> sample(aSample->As<const VideoData>());
  MOZ_ASSERT(sample);

  mInputSampleDuration = aSample->mDuration;

  // Bug 1789846: Check with the Encoder if MediaCodec has a stride or height
  // value to use.
  jni::ByteBuffer::LocalRef buffer = ConvertI420ToNV12Buffer(
      sample, mYUVBuffer, mJavaEncoder->GetInputFormatStride(),
      mJavaEncoder->GetInputFormatYPlaneHeight());
  if (!buffer) {
    return EncodePromise::CreateAndReject(NS_ERROR_ILLEGAL_INPUT, __func__);
  }

  if (aSample->mKeyframe) {
    mInputBufferInfo->Set(0, AssertedCast<int32_t>(mYUVBuffer->Length()),
                          aSample->mTime.ToMicroseconds(),
                          java::sdk::MediaCodec::BUFFER_FLAG_SYNC_FRAME);
  } else {
    mInputBufferInfo->Set(0, AssertedCast<int32_t>(mYUVBuffer->Length()),
                          aSample->mTime.ToMicroseconds(), 0);
  }

  mJavaEncoder->Input(buffer, mInputBufferInfo, nullptr);

  if (mEncodedData.Length() > 0) {
    EncodedData pending = std::move(mEncodedData);
    return EncodePromise::CreateAndResolve(std::move(pending), __func__);
  }
  return EncodePromise::CreateAndResolve(EncodedData(), __func__);
}

class AutoRelease final {
 public:
  AutoRelease(java::CodecProxy::Param aEncoder, java::Sample::Param aSample)
      : mEncoder(aEncoder), mSample(aSample) {}

  ~AutoRelease() { mEncoder->ReleaseOutput(mSample, false); }

 private:
  java::CodecProxy::GlobalRef mEncoder;
  java::Sample::GlobalRef mSample;
};

static bool IsAVCC(EncoderConfig::CodecSpecific& aCodecSpecific) {
  return aCodecSpecific.is<H264Specific>() &&
         aCodecSpecific.as<H264Specific>().mFormat == H264BitStreamFormat::AVC;
}

static RefPtr<MediaByteBuffer> ExtractCodecConfig(
    java::SampleBuffer::Param aBuffer, const int32_t aOffset,
    const int32_t aSize, const bool aAsAVCC) {
  auto config = MakeRefPtr<MediaByteBuffer>(aSize);
  config->SetLength(aSize);
  jni::ByteBuffer::LocalRef dest =
      jni::ByteBuffer::New(config->Elements(), aSize);
  aBuffer->WriteToByteBuffer(dest, aOffset, aSize);
  if (!aAsAVCC) {
    return config;
  }
  // Convert to avcC.
  nsTArray<AnnexB::NALEntry> paramSets;
  AnnexB::ParseNALEntries(
      Span<const uint8_t>(config->Elements(), config->Length()), paramSets);

  auto avcc = MakeRefPtr<MediaByteBuffer>();
  AnnexB::NALEntry& sps = paramSets.ElementAt(0);
  AnnexB::NALEntry& pps = paramSets.ElementAt(1);
  const uint8_t* spsPtr = config->Elements() + sps.mOffset;
  H264::WriteExtraData(
      avcc, spsPtr[1], spsPtr[2], spsPtr[3],
      Span<const uint8_t>(spsPtr, sps.mSize),
      Span<const uint8_t>(config->Elements() + pps.mOffset, pps.mSize));
  return avcc;
}

void AndroidDataEncoder::ProcessOutput(
    java::Sample::GlobalRef&& aSample,
    java::SampleBuffer::GlobalRef&& aBuffer) {
  if (!mTaskQueue->IsCurrentThreadIn()) {
    nsresult rv =
        mTaskQueue->Dispatch(NewRunnableMethod<java::Sample::GlobalRef&&,
                                               java::SampleBuffer::GlobalRef&&>(
            "AndroidDataEncoder::ProcessOutput", this,
            &AndroidDataEncoder::ProcessOutput, std::move(aSample),
            std::move(aBuffer)));
    MOZ_DIAGNOSTIC_ASSERT(NS_SUCCEEDED(rv));
    Unused << rv;
    return;
  }
  AssertOnTaskQueue();

  if (!mJavaEncoder) {
    return;
  }

  AutoRelease releaseSample(mJavaEncoder, aSample);

  java::sdk::MediaCodec::BufferInfo::LocalRef info = aSample->Info();
  MOZ_ASSERT(info);

  int32_t flags;
  bool ok = NS_SUCCEEDED(info->Flags(&flags));
  bool isEOS = !!(flags & java::sdk::MediaCodec::BUFFER_FLAG_END_OF_STREAM);

  int32_t offset;
  ok &= NS_SUCCEEDED(info->Offset(&offset));

  int32_t size;
  ok &= NS_SUCCEEDED(info->Size(&size));

  int64_t presentationTimeUs;
  ok &= NS_SUCCEEDED(info->PresentationTimeUs(&presentationTimeUs));

  if (!ok) {
    return;
  }

  if (size > 0) {
    if ((flags & java::sdk::MediaCodec::BUFFER_FLAG_CODEC_CONFIG) != 0) {
      mConfigData = ExtractCodecConfig(aBuffer, offset, size,
                                       IsAVCC(mConfig.mCodecSpecific));
      return;
    }
    RefPtr<MediaRawData> output;
    if (mConfig.mCodec == CodecType::H264) {
      output = GetOutputDataH264(
          aBuffer, offset, size,
          !!(flags & java::sdk::MediaCodec::BUFFER_FLAG_KEY_FRAME));
    } else {
      output = GetOutputData(
          aBuffer, offset, size,
          !!(flags & java::sdk::MediaCodec::BUFFER_FLAG_KEY_FRAME));
    }
    output->mEOS = isEOS;
    output->mTime = media::TimeUnit::FromMicroseconds(presentationTimeUs);
    output->mDuration = mInputSampleDuration;
    mEncodedData.AppendElement(std::move(output));
  }

  if (isEOS) {
    mDrainState = DrainState::DRAINED;
  }
  if (!mDrainPromise.IsEmpty()) {
    EncodedData pending = std::move(mEncodedData);
    mDrainPromise.Resolve(std::move(pending), __func__);
  }
}

RefPtr<MediaRawData> AndroidDataEncoder::GetOutputData(
    java::SampleBuffer::Param aBuffer, const int32_t aOffset,
    const int32_t aSize, const bool aIsKeyFrame) {
  // Copy frame data from Java buffer.
  auto output = MakeRefPtr<MediaRawData>();
  UniquePtr<MediaRawDataWriter> writer(output->CreateWriter());
  if (!writer->SetSize(aSize)) {
    AND_ENC_LOGE("fail to allocate output buffer");
    return nullptr;
  }

  jni::ByteBuffer::LocalRef buf = jni::ByteBuffer::New(writer->Data(), aSize);
  aBuffer->WriteToByteBuffer(buf, aOffset, aSize);
  output->mKeyframe = aIsKeyFrame;

  return output;
}

// AVC/H.264 frame can be in avcC or Annex B and needs extra conversion steps.
RefPtr<MediaRawData> AndroidDataEncoder::GetOutputDataH264(
    java::SampleBuffer::Param aBuffer, const int32_t aOffset,
    const int32_t aSize, const bool aIsKeyFrame) {
  auto output = MakeRefPtr<MediaRawData>();

  size_t prependSize = 0;
  RefPtr<MediaByteBuffer> avccHeader;
  bool asAVCC = IsAVCC(mConfig.mCodecSpecific);
  if (aIsKeyFrame && mConfigData) {
    if (asAVCC) {
      avccHeader = mConfigData;
    } else {
      prependSize = mConfigData->Length();
    }
  }

  UniquePtr<MediaRawDataWriter> writer(output->CreateWriter());
  if (!writer->SetSize(prependSize + aSize)) {
    AND_ENC_LOGE("fail to allocate output buffer");
    return nullptr;
  }

  if (prependSize > 0) {
    PodCopy(writer->Data(), mConfigData->Elements(), prependSize);
  }

  jni::ByteBuffer::LocalRef buf =
      jni::ByteBuffer::New(writer->Data() + prependSize, aSize);
  aBuffer->WriteToByteBuffer(buf, aOffset, aSize);

  if (asAVCC && !AnnexB::ConvertSampleToAVCC(output, avccHeader)) {
    AND_ENC_LOGE("fail to convert annex-b sample to AVCC");
    return nullptr;
  }

  output->mKeyframe = aIsKeyFrame;

  return output;
}

RefPtr<MediaDataEncoder::EncodePromise> AndroidDataEncoder::Drain() {
  return InvokeAsync(mTaskQueue, this, __func__,
                     &AndroidDataEncoder::ProcessDrain);
}

RefPtr<MediaDataEncoder::EncodePromise> AndroidDataEncoder::ProcessDrain() {
  AssertOnTaskQueue();
  MOZ_ASSERT(mJavaEncoder);
  MOZ_ASSERT(mDrainPromise.IsEmpty());

  REJECT_IF_ERROR();

  switch (mDrainState) {
    case DrainState::DRAINABLE:
      mInputBufferInfo->Set(0, 0, -1,
                            java::sdk::MediaCodec::BUFFER_FLAG_END_OF_STREAM);
      mJavaEncoder->Input(nullptr, mInputBufferInfo, nullptr);
      mDrainState = DrainState::DRAINING;
      [[fallthrough]];
    case DrainState::DRAINING:
      if (mEncodedData.IsEmpty()) {
        return mDrainPromise.Ensure(__func__);  // Pending promise.
      }
      [[fallthrough]];
    case DrainState::DRAINED:
      if (mEncodedData.Length() > 0) {
        EncodedData pending = std::move(mEncodedData);
        return EncodePromise::CreateAndResolve(std::move(pending), __func__);
      } else {
        return EncodePromise::CreateAndResolve(EncodedData(), __func__);
      }
  }
}

RefPtr<ShutdownPromise> AndroidDataEncoder::Shutdown() {
  return InvokeAsync(mTaskQueue, this, __func__,
                     &AndroidDataEncoder::ProcessShutdown);
}

RefPtr<ShutdownPromise> AndroidDataEncoder::ProcessShutdown() {
  AssertOnTaskQueue();
  if (mJavaEncoder) {
    mJavaEncoder->Release();
    mJavaEncoder = nullptr;
  }

  if (mJavaCallbacks) {
    JavaCallbacksSupport::GetNative(mJavaCallbacks)->Cancel();
    JavaCallbacksSupport::DisposeNative(mJavaCallbacks);
    mJavaCallbacks = nullptr;
  }

  mFormat = nullptr;

  return ShutdownPromise::CreateAndResolve(true, __func__);
}

RefPtr<GenericPromise> AndroidDataEncoder::SetBitrate(uint32_t aBitsPerSec) {
  RefPtr<AndroidDataEncoder> self(this);
  return InvokeAsync(mTaskQueue, __func__, [self, aBitsPerSec]() {
    self->mJavaEncoder->SetBitrate(AssertedCast<int>(aBitsPerSec));
    return GenericPromise::CreateAndResolve(true, __func__);
  });
}

void AndroidDataEncoder::Error(const MediaResult& aError) {
  if (!mTaskQueue->IsCurrentThreadIn()) {
    nsresult rv = mTaskQueue->Dispatch(NewRunnableMethod<MediaResult>(
        "AndroidDataEncoder::Error", this, &AndroidDataEncoder::Error, aError));
    MOZ_DIAGNOSTIC_ASSERT(NS_SUCCEEDED(rv));
    Unused << rv;
    return;
  }
  AssertOnTaskQueue();

  mError = Some(aError);
}

void AndroidDataEncoder::CallbacksSupport::HandleInput(int64_t aTimestamp,
                                                       bool aProcessed) {}

void AndroidDataEncoder::CallbacksSupport::HandleOutput(
    java::Sample::Param aSample, java::SampleBuffer::Param aBuffer) {
  MutexAutoLock lock(mMutex);
  if (mEncoder) {
    mEncoder->ProcessOutput(aSample, aBuffer);
  }
}

void AndroidDataEncoder::CallbacksSupport::HandleOutputFormatChanged(
    java::sdk::MediaFormat::Param aFormat) {}

void AndroidDataEncoder::CallbacksSupport::HandleError(
    const MediaResult& aError) {
  MutexAutoLock lock(mMutex);
  if (mEncoder) {
    mEncoder->Error(aError);
  }
}

}  // namespace mozilla

#undef AND_ENC_LOG
#undef AND_ENC_LOGE
