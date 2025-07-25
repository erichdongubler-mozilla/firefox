/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "FFmpegLibWrapper.h"
#include "FFmpegLog.h"
#include "mozilla/PodOperations.h"
#ifdef MOZ_FFMPEG
#  include "mozilla/StaticPrefs_media.h"
#endif
#include "mozilla/Types.h"
#include "PlatformDecoderModule.h"
#include "prlink.h"
#ifdef MOZ_WIDGET_GTK
#  include "mozilla/gfx/gfxVars.h"
#  include "mozilla/widget/DMABufDevice.h"
#  include "VALibWrapper.h"
#endif

#define AV_LOG_QUIET -8
#define AV_LOG_PANIC 0
#define AV_LOG_FATAL 8
#define AV_LOG_ERROR 16
#define AV_LOG_WARNING 24
#define AV_LOG_INFO 32
#define AV_LOG_VERBOSE 40
#define AV_LOG_DEBUG 48
#define AV_LOG_TRACE 56

namespace mozilla {

static LazyLogModule sFFmpegLibLog("FFmpegLib");

FFmpegLibWrapper::LinkResult FFmpegLibWrapper::Link() {
  if (!mAVCodecLib || !mAVUtilLib) {
    Unlink();
    return LinkResult::NoProvidedLib;
  }

  avcodec_version =
      (decltype(avcodec_version))PR_FindSymbol(mAVCodecLib, "avcodec_version");
  if (!avcodec_version) {
    Unlink();
    return LinkResult::NoAVCodecVersion;
  }
  uint32_t version = avcodec_version();
  uint32_t macro = (version >> 16) & 0xFFu;
  mVersion = static_cast<int>(macro);
  uint32_t micro = version & 0xFFu;
  // A micro version >= 100 indicates that it's FFmpeg (as opposed to LibAV).
  bool isFFMpeg = micro >= 100;
  if (!isFFMpeg) {
    if (macro == 57) {
      // Due to current AVCodecContext binary incompatibility we can only
      // support FFmpeg 57 at this stage.
      Unlink();
      FFMPEGP_LOG("FFmpeg 57 is banned due to binary incompatibility");
      return LinkResult::CannotUseLibAV57;
    }
#ifdef MOZ_FFMPEG
    if (version < (54u << 16 | 35u << 8 | 1u) &&
        !StaticPrefs::media_libavcodec_allow_obsolete()) {
      // Refuse any libavcodec version prior to 54.35.1.
      // (Unless media.libavcodec.allow-obsolete==true)
      Unlink();
      FFMPEGP_LOG("libavcodec version prior to 54.35.1 is too old");
      return LinkResult::BlockedOldLibAVVersion;
    }
#endif
  }

  enum {
    AV_FUNC_AVUTIL_MASK = 1 << 15,
    AV_FUNC_53 = 1 << 0,
    AV_FUNC_54 = 1 << 1,
    AV_FUNC_55 = 1 << 2,
    AV_FUNC_56 = 1 << 3,
    AV_FUNC_57 = 1 << 4,
    AV_FUNC_58 = 1 << 5,
    AV_FUNC_59 = 1 << 6,
    AV_FUNC_60 = 1 << 7,
    AV_FUNC_61 = 1 << 8,
    AV_FUNC_AVUTIL_53 = AV_FUNC_53 | AV_FUNC_AVUTIL_MASK,
    AV_FUNC_AVUTIL_54 = AV_FUNC_54 | AV_FUNC_AVUTIL_MASK,
    AV_FUNC_AVUTIL_55 = AV_FUNC_55 | AV_FUNC_AVUTIL_MASK,
    AV_FUNC_AVUTIL_56 = AV_FUNC_56 | AV_FUNC_AVUTIL_MASK,
    AV_FUNC_AVUTIL_57 = AV_FUNC_57 | AV_FUNC_AVUTIL_MASK,
    AV_FUNC_AVUTIL_58 = AV_FUNC_58 | AV_FUNC_AVUTIL_MASK,
    AV_FUNC_AVUTIL_59 = AV_FUNC_59 | AV_FUNC_AVUTIL_MASK,
    AV_FUNC_AVUTIL_60 = AV_FUNC_60 | AV_FUNC_AVUTIL_MASK,
    AV_FUNC_AVUTIL_61 = AV_FUNC_61 | AV_FUNC_AVUTIL_MASK,
    AV_FUNC_AVCODEC_ALL = AV_FUNC_53 | AV_FUNC_54 | AV_FUNC_55 | AV_FUNC_56 |
                          AV_FUNC_57 | AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 |
                          AV_FUNC_61,
    AV_FUNC_AVUTIL_ALL = AV_FUNC_AVCODEC_ALL | AV_FUNC_AVUTIL_MASK
  };

  switch (macro) {
    case 53:
      version = AV_FUNC_53;
      break;
    case 54:
      version = AV_FUNC_54;
      break;
    case 55:
      version = AV_FUNC_55;
      break;
    case 56:
      version = AV_FUNC_56;
      break;
    case 57:
      version = AV_FUNC_57;
      break;
    case 58:
      version = AV_FUNC_58;
      break;
    case 59:
      version = AV_FUNC_59;
      break;
    case 60:
      version = AV_FUNC_60;
      break;
    case 61:
      version = AV_FUNC_61;
      break;
    default:
      FFMPEGV_LOG("Unknown avcodec version: %d", macro);
      Unlink();
      return isFFMpeg ? ((macro > 57) ? LinkResult::UnknownFutureFFMpegVersion
                                      : LinkResult::UnknownOlderFFMpegVersion)
                      // All LibAV versions<54.35.1 are blocked, therefore we
                      // must be dealing with a later one.
                      : LinkResult::UnknownFutureLibAVVersion;
  }

  FFMPEGP_LOG("version: 0x%x, macro: %d, micro: %d, isFFMpeg: %s", version,
              macro, micro, isFFMpeg ? "yes" : "no");

#define AV_FUNC_OPTION_SILENT(func, ver)                                \
  if ((ver) & version) {                                                \
    if (!((func) = (decltype(func))PR_FindSymbol(                       \
              ((ver) & AV_FUNC_AVUTIL_MASK) ? mAVUtilLib : mAVCodecLib, \
              #func))) {                                                \
    }                                                                   \
  } else {                                                              \
    (func) = (decltype(func))nullptr;                                   \
  }

#define AV_FUNC_OPTION(func, ver)                             \
  AV_FUNC_OPTION_SILENT(func, ver)                            \
  if ((ver) & version && (func) == (decltype(func))nullptr) { \
    FFMPEGP_LOG("Couldn't load function " #func);             \
  }

#define AV_FUNC(func, ver)                              \
  AV_FUNC_OPTION(func, ver)                             \
  if ((ver) & version && !(func)) {                     \
    Unlink();                                           \
    return isFFMpeg ? LinkResult::MissingFFMpegFunction \
                    : LinkResult::MissingLibAVFunction; \
  }

  AV_FUNC(av_lockmgr_register, AV_FUNC_53 | AV_FUNC_54 | AV_FUNC_55 |
                                   AV_FUNC_56 | AV_FUNC_57 | AV_FUNC_58)
  AV_FUNC(avcodec_alloc_context3, AV_FUNC_AVCODEC_ALL)
  AV_FUNC(avcodec_close, AV_FUNC_AVCODEC_ALL)
  AV_FUNC(avcodec_decode_audio4, AV_FUNC_53 | AV_FUNC_54 | AV_FUNC_55 |
                                     AV_FUNC_56 | AV_FUNC_57 | AV_FUNC_58)
  AV_FUNC(avcodec_decode_video2, AV_FUNC_53 | AV_FUNC_54 | AV_FUNC_55 |
                                     AV_FUNC_56 | AV_FUNC_57 | AV_FUNC_58)
  AV_FUNC(avcodec_find_decoder, AV_FUNC_AVCODEC_ALL)
  AV_FUNC(avcodec_find_decoder_by_name,
          AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC(avcodec_find_encoder, AV_FUNC_AVCODEC_ALL)
  AV_FUNC(avcodec_find_encoder_by_name,
          AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC(avcodec_flush_buffers, AV_FUNC_AVCODEC_ALL)
  AV_FUNC(avcodec_open2, AV_FUNC_AVCODEC_ALL)
  AV_FUNC(avcodec_register_all, AV_FUNC_53 | AV_FUNC_54 | AV_FUNC_55 |
                                    AV_FUNC_56 | AV_FUNC_57 | AV_FUNC_58)
  AV_FUNC(av_init_packet, (AV_FUNC_55 | AV_FUNC_56 | AV_FUNC_57 | AV_FUNC_58 |
                           AV_FUNC_59 | AV_FUNC_60))
  AV_FUNC(av_parser_init, AV_FUNC_AVCODEC_ALL)
  AV_FUNC(av_parser_close, AV_FUNC_AVCODEC_ALL)
  AV_FUNC(av_parser_parse2, AV_FUNC_AVCODEC_ALL)
  AV_FUNC(avcodec_align_dimensions, AV_FUNC_AVCODEC_ALL)
  AV_FUNC(avcodec_alloc_frame, (AV_FUNC_53 | AV_FUNC_54))
  AV_FUNC(avcodec_get_frame_defaults, (AV_FUNC_53 | AV_FUNC_54))
  AV_FUNC(avcodec_free_frame, AV_FUNC_54)
  AV_FUNC(avcodec_send_packet,
          AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC(avcodec_receive_packet,
          AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC(avcodec_send_frame, AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC(avcodec_receive_frame,
          AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC(avcodec_default_get_buffer2,
          (AV_FUNC_55 | AV_FUNC_56 | AV_FUNC_57 | AV_FUNC_58 | AV_FUNC_59 |
           AV_FUNC_60 | AV_FUNC_61))
  AV_FUNC(av_packet_alloc,
          (AV_FUNC_57 | AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61))
  AV_FUNC(av_packet_unref,
          (AV_FUNC_57 | AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61))
  AV_FUNC(av_packet_free,
          (AV_FUNC_57 | AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61))
  AV_FUNC(avcodec_descriptor_get, AV_FUNC_AVCODEC_ALL)
  AV_FUNC(av_log_set_callback, AV_FUNC_AVUTIL_ALL)
  AV_FUNC(av_log_set_level, AV_FUNC_AVUTIL_ALL)
  AV_FUNC(av_malloc, AV_FUNC_AVUTIL_ALL)
  AV_FUNC(av_freep, AV_FUNC_AVUTIL_ALL)
  AV_FUNC(av_frame_alloc,
          (AV_FUNC_AVUTIL_55 | AV_FUNC_AVUTIL_56 | AV_FUNC_AVUTIL_57 |
           AV_FUNC_AVUTIL_58 | AV_FUNC_AVUTIL_59 | AV_FUNC_AVUTIL_60 |
           AV_FUNC_AVUTIL_61))
  AV_FUNC(av_frame_free,
          (AV_FUNC_AVUTIL_55 | AV_FUNC_AVUTIL_56 | AV_FUNC_AVUTIL_57 |
           AV_FUNC_AVUTIL_58 | AV_FUNC_AVUTIL_59 | AV_FUNC_AVUTIL_60 |
           AV_FUNC_AVUTIL_61))
  AV_FUNC(av_frame_unref,
          (AV_FUNC_AVUTIL_55 | AV_FUNC_AVUTIL_56 | AV_FUNC_AVUTIL_57 |
           AV_FUNC_AVUTIL_58 | AV_FUNC_AVUTIL_59 | AV_FUNC_AVUTIL_60 |
           AV_FUNC_AVUTIL_61))
  AV_FUNC(av_frame_get_buffer,
          (AV_FUNC_AVUTIL_55 | AV_FUNC_AVUTIL_56 | AV_FUNC_AVUTIL_57 |
           AV_FUNC_AVUTIL_58 | AV_FUNC_AVUTIL_59 | AV_FUNC_AVUTIL_60 |
           AV_FUNC_AVUTIL_61))
  AV_FUNC(av_frame_make_writable,
          (AV_FUNC_AVUTIL_55 | AV_FUNC_AVUTIL_56 | AV_FUNC_AVUTIL_57 |
           AV_FUNC_AVUTIL_58 | AV_FUNC_AVUTIL_59 | AV_FUNC_AVUTIL_60 |
           AV_FUNC_AVUTIL_61))
  AV_FUNC(av_image_check_size, AV_FUNC_AVUTIL_ALL)
  AV_FUNC(av_image_get_buffer_size, AV_FUNC_AVUTIL_ALL)
  AV_FUNC_OPTION(av_channel_layout_default,
                 AV_FUNC_AVUTIL_60 | AV_FUNC_AVUTIL_61)
  AV_FUNC_OPTION(av_channel_layout_from_mask,
                 AV_FUNC_AVUTIL_60 | AV_FUNC_AVUTIL_61)
  AV_FUNC_OPTION(av_channel_layout_copy, AV_FUNC_AVUTIL_60 | AV_FUNC_AVUTIL_61)
  AV_FUNC_OPTION(av_buffer_get_opaque,
                 (AV_FUNC_AVUTIL_56 | AV_FUNC_AVUTIL_57 | AV_FUNC_AVUTIL_58 |
                  AV_FUNC_AVUTIL_59 | AV_FUNC_AVUTIL_60 | AV_FUNC_AVUTIL_61))
  AV_FUNC(
      av_buffer_create,
      (AV_FUNC_AVUTIL_55 | AV_FUNC_AVUTIL_56 | AV_FUNC_AVUTIL_57 |
       AV_FUNC_AVUTIL_58 | AV_FUNC_AVUTIL_59 | AV_FUNC_AVUTIL_60 | AV_FUNC_61))
  AV_FUNC_OPTION(av_frame_get_colorspace,
                 AV_FUNC_AVUTIL_55 | AV_FUNC_AVUTIL_56 | AV_FUNC_AVUTIL_57 |
                     AV_FUNC_AVUTIL_58)
  AV_FUNC_OPTION(av_frame_get_color_range,
                 AV_FUNC_AVUTIL_55 | AV_FUNC_AVUTIL_56 | AV_FUNC_AVUTIL_57 |
                     AV_FUNC_AVUTIL_58)
  AV_FUNC(av_strerror, AV_FUNC_AVUTIL_58 | AV_FUNC_AVUTIL_59 |
                           AV_FUNC_AVUTIL_60 | AV_FUNC_AVUTIL_61)
  AV_FUNC(av_get_sample_fmt_name, AV_FUNC_AVUTIL_ALL)
  AV_FUNC(av_dict_set, AV_FUNC_AVUTIL_ALL)
  AV_FUNC(av_dict_free, AV_FUNC_AVUTIL_ALL)
  AV_FUNC(av_opt_set, AV_FUNC_AVUTIL_ALL)
  AV_FUNC(av_opt_set_double, AV_FUNC_AVUTIL_ALL)
  AV_FUNC(av_opt_set_int, AV_FUNC_AVUTIL_ALL)
  AV_FUNC(avcodec_free_context,
          AV_FUNC_57 | AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC_OPTION_SILENT(avcodec_get_hw_config,
                        AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC_OPTION_SILENT(av_codec_is_decoder,
                        AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC_OPTION_SILENT(av_codec_is_encoder,
                        AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC_OPTION_SILENT(av_codec_iterate,
                        AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC_OPTION_SILENT(av_hwdevice_ctx_init,
                        AV_FUNC_AVUTIL_58 | AV_FUNC_AVUTIL_59 |
                            AV_FUNC_AVUTIL_60 | AV_FUNC_AVUTIL_61)
  AV_FUNC_OPTION_SILENT(av_hwdevice_ctx_alloc,
                        AV_FUNC_AVUTIL_58 | AV_FUNC_AVUTIL_59 |
                            AV_FUNC_AVUTIL_60 | AV_FUNC_AVUTIL_61)
  AV_FUNC_OPTION_SILENT(av_buffer_ref, AV_FUNC_AVUTIL_58 | AV_FUNC_AVUTIL_59 |
                                           AV_FUNC_AVUTIL_60 |
                                           AV_FUNC_AVUTIL_61)
  AV_FUNC_OPTION_SILENT(av_buffer_unref, AV_FUNC_AVUTIL_58 | AV_FUNC_AVUTIL_59 |
                                             AV_FUNC_AVUTIL_60 |
                                             AV_FUNC_AVUTIL_61)
  AV_FUNC_OPTION_SILENT(av_hwframe_ctx_alloc,
                        AV_FUNC_AVUTIL_58 | AV_FUNC_AVUTIL_59 |
                            AV_FUNC_AVUTIL_60 | AV_FUNC_AVUTIL_61)
  AV_FUNC_OPTION_SILENT(av_hwframe_ctx_init,
                        AV_FUNC_AVUTIL_58 | AV_FUNC_AVUTIL_59 |
                            AV_FUNC_AVUTIL_60 | AV_FUNC_AVUTIL_61)

#ifdef MOZ_WIDGET_GTK
  AV_FUNC_OPTION_SILENT(av_hwdevice_hwconfig_alloc,
                        AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC_OPTION_SILENT(av_hwdevice_get_hwframe_constraints,
                        AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC_OPTION_SILENT(av_hwframe_constraints_free,
                        AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC_OPTION_SILENT(av_hwframe_transfer_get_formats,
                        AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC_OPTION_SILENT(av_hwdevice_ctx_create_derived,
                        AV_FUNC_58 | AV_FUNC_59 | AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC_OPTION_SILENT(avcodec_get_name, AV_FUNC_57 | AV_FUNC_58 | AV_FUNC_59 |
                                              AV_FUNC_60 | AV_FUNC_61)
  AV_FUNC_OPTION_SILENT(av_get_pix_fmt_string,
                        AV_FUNC_AVUTIL_58 | AV_FUNC_AVUTIL_59 |
                            AV_FUNC_AVUTIL_60 | AV_FUNC_AVUTIL_61)
#endif

  AV_FUNC_OPTION(av_tx_init, AV_FUNC_AVUTIL_ALL)
  AV_FUNC_OPTION(av_tx_uninit, AV_FUNC_AVUTIL_ALL)

#undef AV_FUNC
#undef AV_FUNC_OPTION

  if (avcodec_register_all) {
    avcodec_register_all();
  }

  UpdateLogLevel();
  av_log_set_callback(Log);
  return LinkResult::Success;
}

void FFmpegLibWrapper::Unlink() {
  if (av_lockmgr_register) {
    // Registering a null lockmgr cause the destruction of libav* global mutexes
    // as the default lockmgr that allocated them will be deregistered.
    // This prevents ASAN and valgrind to report sizeof(pthread_mutex_t) leaks.
    av_lockmgr_register(nullptr);
  }
#ifndef MOZ_TSAN
  // With TSan, we cannot unload libav once we have loaded it because
  // TSan does not support unloading libraries that are matched from its
  // suppression list. Hence we just keep the library loaded in TSan builds.
  if (mAVUtilLib && mAVUtilLib != mAVCodecLib) {
    PR_UnloadLibrary(mAVUtilLib);
  }
  if (mAVCodecLib) {
    PR_UnloadLibrary(mAVCodecLib);
  }
#endif
  PodZero(this);
}

void FFmpegLibWrapper::UpdateLogLevel() {
  LogModule* mod = sFFmpegLibLog;
  av_log_set_level(ToLibLogLevel(mod->Level()));
}

/* static */ void FFmpegLibWrapper::RegisterCallbackLogLevel(
    PrefChangedFunc aCallback) {
  if (!NS_IsMainThread()) {
    NS_DispatchToMainThread(NS_NewRunnableFunction(
        __func__, [aCallback]() { RegisterCallbackLogLevel(aCallback); }));
    return;
  }

  Preferences::RegisterCallback(aCallback, "logging.FFmpegLib"_ns);
}

/* static */ int FFmpegLibWrapper::ToLibLogLevel(LogLevel aLevel) {
  switch (aLevel) {
    case LogLevel::Disabled:
      return AV_LOG_QUIET;
    case LogLevel::Error:
      return AV_LOG_ERROR;
    case LogLevel::Warning:
      return AV_LOG_WARNING;
    case LogLevel::Info:
      return AV_LOG_INFO;
    case LogLevel::Debug:
      return AV_LOG_DEBUG;
    case LogLevel::Verbose:
      return AV_LOG_TRACE;
    default:
      MOZ_ASSERT_UNREACHABLE("Unhandled log level!");
      break;
  }
  return AV_LOG_QUIET;
}

/* static */ LogLevel FFmpegLibWrapper::FromLibLogLevel(int aLevel) {
  switch (aLevel) {
    case AV_LOG_QUIET:
      return LogLevel::Disabled;
    case AV_LOG_PANIC:
    case AV_LOG_FATAL:
    case AV_LOG_ERROR:
      return LogLevel::Error;
    case AV_LOG_WARNING:
      return LogLevel::Warning;
    case AV_LOG_INFO:
      return LogLevel::Info;
    case AV_LOG_DEBUG:
      return LogLevel::Debug;
    case AV_LOG_VERBOSE:
    case AV_LOG_TRACE:
      return LogLevel::Verbose;
    default:
      MOZ_ASSERT_UNREACHABLE("Unhandled log level!");
      break;
  }
  return LogLevel::Disabled;
}

/* static */ void FFmpegLibWrapper::Log(void* aPtr, int aLevel,
                                        const char* aFmt, va_list aArgs) {
  LogLevel level = FromLibLogLevel(aLevel);
  if (MOZ_LOG_TEST(sFFmpegLibLog, level)) {
    nsAutoCString msg;
    msg.AppendVprintf(aFmt, aArgs);
    MOZ_LOG(sFFmpegLibLog, level, ("[%p] %s", aPtr, msg.get()));
  }
}

#ifdef MOZ_WIDGET_GTK
bool FFmpegLibWrapper::IsVAAPIAvailable() {
#  define VA_FUNC_LOADED(func) ((func) != nullptr)
  return VA_FUNC_LOADED(avcodec_get_hw_config) &&
         VA_FUNC_LOADED(av_hwdevice_ctx_alloc) &&
         VA_FUNC_LOADED(av_hwdevice_ctx_init) &&
         VA_FUNC_LOADED(av_hwdevice_hwconfig_alloc) &&
         VA_FUNC_LOADED(av_hwdevice_get_hwframe_constraints) &&
         VA_FUNC_LOADED(av_hwframe_constraints_free) &&
         VA_FUNC_LOADED(av_buffer_ref) && VA_FUNC_LOADED(av_buffer_unref) &&
         VA_FUNC_LOADED(av_hwframe_transfer_get_formats) &&
         VA_FUNC_LOADED(av_hwdevice_ctx_create_derived) &&
         VA_FUNC_LOADED(av_hwframe_ctx_alloc) && VA_FUNC_LOADED(av_dict_set) &&
         VA_FUNC_LOADED(av_dict_free) && VA_FUNC_LOADED(avcodec_get_name) &&
         VA_FUNC_LOADED(av_get_pix_fmt_string) &&
         VALibWrapper::IsVAAPIAvailable();
}
#endif

}  // namespace mozilla
