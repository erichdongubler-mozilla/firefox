/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "CompilationInfo.h"

#include "CompilationMessage.h"
#include "ShaderModule.h"
#include "mozilla/dom/StructuredCloneTags.h"
#include "mozilla/dom/StructuredCloneUtils.h"
#include "mozilla/dom/WebGPUBinding.h"

namespace mozilla::webgpu {

GPU_IMPL_CYCLE_COLLECTION(CompilationInfo, mMessages)
GPU_IMPL_JS_WRAP(CompilationInfo)

CompilationInfo::CompilationInfo() = default;

bool CompilationInfo::WriteStructuredClone(JSContext* aCx,
                                           JSStructuredCloneWriter* aWriter) {
  if (!JS_WriteUint32Pair(aWriter, SCTAG_DOM_GPUCOMPILATIONINFO, 0)) {
    return false;
  }

  if (!JS_WriteUint32Pair(aWriter, mMessages.Length(), 0)) {
    return false;
  }

  for (const auto& msg : mMessages) {
    if (!msg->WriteStructuredClone(aCx, aWriter)) {
      return false;
    }
  }

  return true;
}

already_AddRefed<CompilationInfo> CompilationInfo::ReadStructuredClone(
    JSContext* aCx, JSStructuredCloneReader* aReader) {
  uint32_t length, unused;
  if (!JS_ReadUint32Pair(aReader, &length, &unused)) {
    return nullptr;
  }

  nsTArray<RefPtr<CompilationMessage>> messages;
  messages.SetCapacity(length);

  for (uint32_t i = 0; i < length; ++i) {
    RefPtr<CompilationMessage> msg =
        CompilationMessage::ReadStructuredClone(aCx, aReader);
    if (!msg) {
      return nullptr;
    }
    messages.AppendElement(std::move(msg));
  }

  RefPtr<CompilationInfo> info = new CompilationInfo(std::move(messages));
  return info.forget();
}

CompilationInfo::~CompilationInfo() = default;

void CompilationInfo::SetMessages(
    nsTArray<mozilla::webgpu::WebGPUCompilationMessage>& aMessages) {
  for (auto& msg : aMessages) {
    auto messageType = dom::GPUCompilationMessageType::Error;
    switch (msg.messageType) {
      case WebGPUCompilationMessageType::Error:
        messageType = dom::GPUCompilationMessageType::Error;
        break;
      case WebGPUCompilationMessageType::Warning:
        messageType = dom::GPUCompilationMessageType::Warning;
        break;
      case WebGPUCompilationMessageType::Info:
        messageType = dom::GPUCompilationMessageType::Info;
        break;
    }
    mMessages.AppendElement(MakeAndAddRef<mozilla::webgpu::CompilationMessage>(
        mParent, messageType, msg.lineNum, msg.linePos, msg.offset, msg.length,
        std::move(msg.message)));
  }
}

void CompilationInfo::GetMessages(
    nsTArray<RefPtr<mozilla::webgpu::CompilationMessage>>& aMessages) {
  for (auto& msg : mMessages) {
    aMessages.AppendElement(msg);
  }
}

}  // namespace mozilla::webgpu
