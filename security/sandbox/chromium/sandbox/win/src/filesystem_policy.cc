// Copyright 2011 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "sandbox/win/src/filesystem_policy.h"

#include <windows.h>
#include <winternl.h>

#include <ntstatus.h>
#include <stdint.h>

#include <algorithm>
#include <string>

#include "base/notreached.h"
#include "base/win/scoped_handle.h"
#include "sandbox/win/src/internal_types.h"
#include "sandbox/win/src/ipc_tags.h"
#include "sandbox/win/src/nt_internals.h"
#include "sandbox/win/src/policy_engine_opcodes.h"
#include "sandbox/win/src/policy_params.h"
#include "sandbox/win/src/sandbox_nt_util.h"
#include "sandbox/win/src/sandbox_types.h"
#include "sandbox/win/src/win_utils.h"

namespace sandbox {

namespace {

struct ObjectAttribs : public OBJECT_ATTRIBUTES {
  UNICODE_STRING uni_name;
  SECURITY_QUALITY_OF_SERVICE security_qos;
  ObjectAttribs(const std::wstring& name, ULONG attributes) {
    ::RtlInitUnicodeString(&uni_name, name.c_str());
    InitializeObjectAttributes(this, &uni_name, attributes, nullptr, nullptr);
    if (IsPipe(name)) {
      security_qos.Length = sizeof(security_qos);
      security_qos.ImpersonationLevel = SecurityAnonymous;
      // Set dynamic tracking to not capture the broker's token
      security_qos.ContextTrackingMode = SECURITY_DYNAMIC_TRACKING;
      security_qos.EffectiveOnly = TRUE;
      SecurityQualityOfService = &security_qos;
    }
  }
};

NTSTATUS NtCreateFileInTarget(HANDLE* target_file_handle,
                              ACCESS_MASK desired_access,
                              OBJECT_ATTRIBUTES* obj_attributes,
                              IO_STATUS_BLOCK* io_status_block,
                              ULONG file_attributes,
                              ULONG share_access,
                              ULONG create_disposition,
                              ULONG create_options,
                              PVOID ea_buffer,
                              ULONG ea_length,
                              HANDLE target_process) {
  HANDLE local_handle = INVALID_HANDLE_VALUE;
  NTSTATUS status = GetNtExports()->CreateFile(
      &local_handle, desired_access, obj_attributes, io_status_block, nullptr,
      file_attributes, share_access, create_disposition, create_options,
      ea_buffer, ea_length);
  if (!NT_SUCCESS(status)) {
    return status;
  }

  if (!::DuplicateHandle(::GetCurrentProcess(), local_handle, target_process,
                         target_file_handle, 0, false,
                         DUPLICATE_CLOSE_SOURCE | DUPLICATE_SAME_ACCESS)) {
    return STATUS_ACCESS_DENIED;
  }
  return STATUS_SUCCESS;
}

}  // namespace.

bool FileSystemPolicy::GenerateRules(const wchar_t* name,
                                     FileSemantics semantics,
                                     LowLevelPolicy* policy) {
  std::wstring mod_name(name);
  if (mod_name.empty()) {
    return false;
  }

  bool is_pipe = IsPipe(mod_name);
  if (!PreProcessName(&mod_name)) {
    // The path to be added might contain a reparse point.
    NOTREACHED();
    return false;
  }

  // TODO(cpu) bug 32224: This prefix add is a hack because we don't have the
  // infrastructure to normalize names. In any case we need to escape the
  // question marks.
  if (_wcsnicmp(mod_name.c_str(), kNTDevicePrefix, kNTDevicePrefixLen)) {
    mod_name = FixNTPrefixForMatch(mod_name);
    name = mod_name.c_str();
  }

  EvalResult result = ASK_BROKER;

  // Rules added for both read-only and write scenarios.
  PolicyRule create(result);
  PolicyRule open(result);
  PolicyRule query(result);
  PolicyRule query_full(result);

  if (semantics == FileSemantics::kAllowReadonly) {
    // We consider all flags that are not known to be readonly as potentially
    // used for write.
    DWORD allowed_flags = FILE_READ_DATA | FILE_READ_ATTRIBUTES | FILE_READ_EA |
                          SYNCHRONIZE | FILE_EXECUTE | GENERIC_READ |
                          GENERIC_EXECUTE | READ_CONTROL;
    DWORD restricted_flags = ~allowed_flags;
    open.AddNumberMatch(IF_NOT, OpenFile::ACCESS, restricted_flags, AND);
    open.AddNumberMatch(IF, OpenFile::OPENONLY, true, EQUAL);
    create.AddNumberMatch(IF_NOT, OpenFile::ACCESS, restricted_flags, AND);
    create.AddNumberMatch(IF, OpenFile::OPENONLY, true, EQUAL);
  }

  // Create and open are not allowed for query.
  if (semantics != FileSemantics::kAllowQuery) {
    if (!create.AddStringMatch(IF, OpenFile::NAME, name, CASE_INSENSITIVE) ||
        !policy->AddRule(IpcTag::NTCREATEFILE, &create)) {
      return false;
    }

    if (!open.AddStringMatch(IF, OpenFile::NAME, name, CASE_INSENSITIVE) ||
        !policy->AddRule(IpcTag::NTOPENFILE, &open)) {
      return false;
    }
  }

  if (!query.AddStringMatch(IF, OpenFile::NAME, name, CASE_INSENSITIVE) ||
      !policy->AddRule(IpcTag::NTQUERYATTRIBUTESFILE, &query)) {
    return false;
  }

  if (!query_full.AddStringMatch(IF, OpenFile::NAME, name, CASE_INSENSITIVE) ||
      !policy->AddRule(IpcTag::NTQUERYFULLATTRIBUTESFILE, &query_full)) {
    return false;
  }

  // Rename is not allowed for read-only and does not make sense for pipes.
  if (semantics == FileSemantics::kAllowAny && !is_pipe) {
    PolicyRule rename(result);
    if (!rename.AddStringMatch(IF, OpenFile::NAME, name, CASE_INSENSITIVE) ||
        !policy->AddRule(IpcTag::NTSETINFO_RENAME, &rename)) {
      return false;
    }
  }

  return true;
}

bool FileSystemPolicy::CreateFileAction(EvalResult eval_result,
                                        const ClientInfo& client_info,
                                        const std::wstring& file,
                                        uint32_t attributes,
                                        uint32_t desired_access,
                                        uint32_t file_attributes,
                                        uint32_t share_access,
                                        uint32_t create_disposition,
                                        uint32_t create_options,
                                        HANDLE* handle,
                                        NTSTATUS* nt_status,
                                        ULONG_PTR* io_information) {
  *handle = nullptr;
  // The only action supported is ASK_BROKER which means create the requested
  // file as specified.
  if (ASK_BROKER != eval_result) {
    *nt_status = STATUS_ACCESS_DENIED;
    return false;
  }
  IO_STATUS_BLOCK io_block = {};
  ObjectAttribs obj_attributes(file, attributes);
  *nt_status =
      NtCreateFileInTarget(handle, desired_access, &obj_attributes, &io_block,
                           file_attributes, share_access, create_disposition,
                           create_options, nullptr, 0, client_info.process);

  *io_information = io_block.Information;
  return true;
}

bool FileSystemPolicy::OpenFileAction(EvalResult eval_result,
                                      const ClientInfo& client_info,
                                      const std::wstring& file,
                                      uint32_t attributes,
                                      uint32_t desired_access,
                                      uint32_t share_access,
                                      uint32_t open_options,
                                      HANDLE* handle,
                                      NTSTATUS* nt_status,
                                      ULONG_PTR* io_information) {
  *handle = nullptr;
  // The only action supported is ASK_BROKER which means open the requested
  // file as specified.
  if (ASK_BROKER != eval_result) {
    *nt_status = STATUS_ACCESS_DENIED;
    return false;
  }
  // An NtOpen is equivalent to an NtCreate with FileAttributes = 0 and
  // CreateDisposition = FILE_OPEN.
  IO_STATUS_BLOCK io_block = {};
  ObjectAttribs obj_attributes(file, attributes);

  *nt_status = NtCreateFileInTarget(
      handle, desired_access, &obj_attributes, &io_block, 0, share_access,
      FILE_OPEN, open_options, nullptr, 0, client_info.process);

  *io_information = io_block.Information;
  return true;
}

bool FileSystemPolicy::QueryAttributesFileAction(
    EvalResult eval_result,
    const ClientInfo& client_info,
    const std::wstring& file,
    uint32_t attributes,
    FILE_BASIC_INFORMATION* file_info,
    NTSTATUS* nt_status) {
  // The only action supported is ASK_BROKER which means query the requested
  // file as specified.
  if (ASK_BROKER != eval_result) {
    *nt_status = STATUS_ACCESS_DENIED;
    return false;
  }

  ObjectAttribs obj_attributes(file, attributes);
  *nt_status = GetNtExports()->QueryAttributesFile(&obj_attributes, file_info);

  return true;
}

bool FileSystemPolicy::QueryFullAttributesFileAction(
    EvalResult eval_result,
    const ClientInfo& client_info,
    const std::wstring& file,
    uint32_t attributes,
    FILE_NETWORK_OPEN_INFORMATION* file_info,
    NTSTATUS* nt_status) {
  // The only action supported is ASK_BROKER which means query the requested
  // file as specified.
  if (ASK_BROKER != eval_result) {
    *nt_status = STATUS_ACCESS_DENIED;
    return false;
  }
  ObjectAttribs obj_attributes(file, attributes);
  *nt_status =
      GetNtExports()->QueryFullAttributesFile(&obj_attributes, file_info);

  return true;
}

bool FileSystemPolicy::SetInformationFileAction(EvalResult eval_result,
                                                const ClientInfo& client_info,
                                                HANDLE target_file_handle,
                                                void* file_info,
                                                uint32_t length,
                                                uint32_t info_class,
                                                IO_STATUS_BLOCK* io_block,
                                                NTSTATUS* nt_status) {
  // The only action supported is ASK_BROKER which means open the requested
  // file as specified.
  if (ASK_BROKER != eval_result) {
    *nt_status = STATUS_ACCESS_DENIED;
    return false;
  }

  HANDLE local_handle = nullptr;
  if (!::DuplicateHandle(client_info.process, target_file_handle,
                         ::GetCurrentProcess(), &local_handle, 0, false,
                         DUPLICATE_SAME_ACCESS)) {
    *nt_status = STATUS_ACCESS_DENIED;
    return false;
  }

  base::win::ScopedHandle handle(local_handle);

  FILE_INFORMATION_CLASS file_info_class =
      static_cast<FILE_INFORMATION_CLASS>(info_class);
  *nt_status = GetNtExports()->SetInformationFile(
      local_handle, io_block, file_info, length, file_info_class);

  return true;
}

bool PreProcessName(std::wstring* path) {
  // We now allow symbolic links to be opened via the broker, so we can no
  // longer rely on the same object check where we checked the path of the
  // opened file against the original. We don't specify a root when creating
  // OBJECT_ATTRIBUTES from file names for brokering so they must be fully
  // qualified and we can just check for the parent directory double dot between
  // two backslashes. NtCreateFile doesn't seem to allow it anyway, but this is
  // just an extra precaution. It also doesn't seem to allow the forward slash,
  // but this is also used for checking policy rules, so we just replace forward
  // slashes with backslashes.
  std::replace(path->begin(), path->end(), L'/', L'\\');
  if (path->find(L"\\..\\") != std::wstring::npos) {
    return false;
  }

  ConvertToLongPath(path);
  return true;
}

std::wstring FixNTPrefixForMatch(const std::wstring& name) {
  std::wstring mod_name = name;

  // NT prefix escaped for rule matcher
  const wchar_t kNTPrefixEscaped[] = L"\\/?/?\\";
  const int kNTPrefixEscapedLen = std::size(kNTPrefixEscaped) - 1;

  if (0 != mod_name.compare(0, kNTPrefixLen, kNTPrefix)) {
    if (0 != mod_name.compare(0, kNTPrefixEscapedLen, kNTPrefixEscaped)) {
      // TODO(nsylvain): Find a better way to do name resolution. Right now we
      // take the name and we expand it.
      mod_name.insert(0, kNTPrefixEscaped);
    }
  } else {
    // Start of name matches NT prefix, replace with escaped format
    // Fixes bug: 334882
    mod_name.replace(0, kNTPrefixLen, kNTPrefixEscaped);
  }

  return mod_name;
}

}  // namespace sandbox
