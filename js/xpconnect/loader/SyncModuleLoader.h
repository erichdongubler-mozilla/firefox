/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_loader_SyncModuleLoader_h
#define mozilla_loader_SyncModuleLoader_h

#include "js/loader/LoadContextBase.h"
#include "js/loader/ModuleLoaderBase.h"

class mozJSModuleLoader;

namespace mozilla {
namespace loader {

class SyncScriptLoader : public JS::loader::ScriptLoaderInterface {
 public:
  NS_DECL_ISUPPORTS

 private:
  ~SyncScriptLoader() = default;

  nsIURI* GetBaseURI() const override;

  void ReportErrorToConsole(ScriptLoadRequest* aRequest,
                            nsresult aResult) const override;

  void ReportWarningToConsole(ScriptLoadRequest* aRequest,
                              const char* aMessageName,
                              const nsTArray<nsString>& aParams) const override;

  nsresult FillCompileOptionsForRequest(
      JSContext* cx, ScriptLoadRequest* aRequest, JS::CompileOptions* aOptions,
      JS::MutableHandle<JSScript*> aIntroductionScript) override;
};

class SyncModuleLoader : public JS::loader::ModuleLoaderBase {
 public:
  NS_DECL_ISUPPORTS_INHERITED
  NS_DECL_CYCLE_COLLECTION_CLASS_INHERITED(SyncModuleLoader,
                                           JS::loader::ModuleLoaderBase)

  SyncModuleLoader(SyncScriptLoader* aScriptLoader,
                   nsIGlobalObject* aGlobalObject);

  [[nodiscard]] nsresult ProcessRequests();

  void MaybeReportLoadError(JSContext* aCx);

 private:
  ~SyncModuleLoader();

  already_AddRefed<ModuleLoadRequest> CreateStaticImport(
      nsIURI* aURI, JS::ModuleType aModuleType,
      JS::loader::ModuleScript* aReferrerScript,
      const mozilla::dom::SRIMetadata& aSriMetadata,
      JS::loader::LoadContextBase* aLoadContext,
      JS::loader::ModuleLoaderBase* aLoader) override;

  already_AddRefed<ModuleLoadRequest> CreateDynamicImport(
      JSContext* aCx, nsIURI* aURI, LoadedScript* aMaybeActiveScript,
      JS::Handle<JSObject*> aModuleRequestObj,
      JS::Handle<JSObject*> aPromise) override;

  void OnDynamicImportStarted(ModuleLoadRequest* aRequest) override;

  bool CanStartLoad(ModuleLoadRequest* aRequest, nsresult* aRvOut) override;

  nsresult StartFetch(ModuleLoadRequest* aRequest) override;

  nsresult CompileFetchedModule(
      JSContext* aCx, JS::Handle<JSObject*> aGlobal,
      JS::CompileOptions& aOptions, ModuleLoadRequest* aRequest,
      JS::MutableHandle<JSObject*> aModuleScript) override;

  void OnModuleLoadComplete(ModuleLoadRequest* aRequest) override;

  JS::loader::ScriptLoadRequestList mLoadRequests;

  // If any of module scripts failed to load, exception is set here until it's
  // reported by MaybeReportLoadError.
  JS::PersistentRooted<JS::Value> mLoadException;
};

// Data specific to SyncModuleLoader that is associated with each load
// request.
class SyncLoadContext : public JS::loader::LoadContextBase {
 public:
  SyncLoadContext() : LoadContextBase(JS::loader::ContextKind::Sync) {}

 public:
  // The result of compiling a module script. These fields are used temporarily
  // before being passed to the module loader.
  nsresult mRv;

  // The exception thrown during compiling a module script. These fields are
  // used temporarily before being passed to the module loader.
  JS::PersistentRooted<JS::Value> mExceptionValue;

  JS::PersistentRooted<JSScript*> mScript;
};

}  // namespace loader
}  // namespace mozilla

#endif  // mozilla_loader_SyncModuleLoader_h
