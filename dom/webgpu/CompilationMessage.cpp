/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "CompilationMessage.h"

#include "CompilationInfo.h"
#include "mozilla/dom/StructuredCloneTags.h"
#include "mozilla/dom/StructuredCloneUtils.h"
#include "mozilla/dom/WebGPUBinding.h"

namespace mozilla::webgpu {

GPU_IMPL_CYCLE_COLLECTION(CompilationMessage)
GPU_IMPL_JS_WRAP(CompilationMessage)

CompilationMessage::CompilationMessage(dom::GPUCompilationMessageType aType,
                                       uint64_t aLineNum, uint64_t aLinePos,
                                       uint64_t aOffset, uint64_t aLength,
                                       nsString&& aMessage)
    : mType(aType),
      mLineNum(aLineNum),
      mLinePos(aLinePos),
      mOffset(aOffset),
      mLength(aLength),
      mMessage(std::move(aMessage)) {}

bool CompilationMessage::WriteStructuredClone(
    JSContext* aCx, JSStructuredCloneWriter* aWriter) {
  if (!JS_WriteUint32Pair(aWriter, dom::SCTAG_DOM_GPUCOMPILATIONMESSAGE, 0)) {
    return false;
  }

  if (!WriteString(aCx, aWriter, mMessage)) {
    return false;
  }

  if (!JS_WriteUint32Pair(aWriter, static_cast<uint32_t>(mType), 0)) {
    return false;
  }

  if (!JS_WriteUint64Pair(aWriter, mLineNum, mLinePos)) {
    return false;
  }

  if (!JS_WriteUint64Pair(aWriter, mOffset, mLength)) {
    return false;
  }

  return true;
}

already_AddRefed<CompilationMessage> CompilationMessage::ReadStructuredClone(
    JSContext* aCx, JSStructuredCloneReader* aReader) {
  nsString message;
  if (!ReadString(aCx, aReader, message)) {
    return nullptr;
  }

  uint32_t type, unused;
  if (!JS_ReadUint32Pair(aReader, &type, &unused)) {
    return nullptr;
  }

  uint64_t lineNum, linePos;
  if (!JS_ReadUint64Pair(aReader, &lineNum, &linePos)) {
    return nullptr;
  }

  uint64_t offset, length;
  if (!JS_ReadUint64Pair(aReader, &offset, &length)) {
    return nullptr;
  }

  RefPtr<CompilationMessage> msg = new CompilationMessage(
      message, static_cast<dom::GPUCompilationMessageType>(type), lineNum,
      linePos, offset, length);

  return msg.forget();
}

}  // namespace mozilla::webgpu
