/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_dom_ModuleLoader_h
#define mozilla_dom_ModuleLoader_h

#include "mozilla/dom/ScriptLoadContext.h"
#include "js/loader/ModuleLoaderBase.h"
#include "js/loader/ScriptLoadRequest.h"
#include "ScriptLoader.h"
#include "mozilla/dom/ScriptLoadRequestType.h"

class nsIURI;

namespace JS {

class CompileOptions;

namespace loader {

class ModuleLoadRequest;

}  // namespace loader
}  // namespace JS

namespace mozilla::dom {

class ScriptLoader;
class SRIMetadata;

//////////////////////////////////////////////////////////////
// DOM Module loader implementation
//////////////////////////////////////////////////////////////

class ModuleLoader final : public JS::loader::ModuleLoaderBase {
 private:
  virtual ~ModuleLoader();

 public:
  enum Kind { Normal, WebExtension };

  ModuleLoader(ScriptLoader* aLoader, nsIGlobalObject* aGlobalObject,
               Kind aKind);

  Kind GetKind() const { return mKind; }

  ScriptLoader* GetScriptLoader();

  bool CanStartLoad(ModuleLoadRequest* aRequest, nsresult* aRvOut) override;

  nsresult StartFetch(ModuleLoadRequest* aRequest) override;

  void OnModuleLoadComplete(ModuleLoadRequest* aRequest) override;

  nsresult CompileFetchedModule(
      JSContext* aCx, JS::Handle<JSObject*> aGlobal,
      JS::CompileOptions& aOptions, ModuleLoadRequest* aRequest,
      JS::MutableHandle<JSObject*> aModuleScript) override;

  // Create a top-level module load request.
  already_AddRefed<ModuleLoadRequest> CreateTopLevel(
      nsIURI* aURI, nsIScriptElement* aElement, ReferrerPolicy aReferrerPolicy,
      ScriptFetchOptions* aFetchOptions, const SRIMetadata& aIntegrity,
      nsIURI* aReferrer, ScriptLoadContext* aContext,
      ScriptLoadRequestType aRequestType);

  // Create a module load request for a static module import.
  already_AddRefed<ModuleLoadRequest> CreateStaticImport(
      nsIURI* aURI, JS::ModuleType aModuleType,
      JS::loader::ModuleScript* aReferrerScript,
      const mozilla::dom::SRIMetadata& aSriMetadata,
      JS::loader::LoadContextBase* aLoadContext,
      JS::loader::ModuleLoaderBase* aLoader) override;

  // Create a module load request for a dynamic module import.
  already_AddRefed<ModuleLoadRequest> CreateDynamicImport(
      JSContext* aCx, nsIURI* aURI, LoadedScript* aMaybeActiveScript,
      JS::Handle<JSObject*> aModuleRequestObj,
      JS::Handle<JSObject*> aPromise) override;

  static ModuleLoader* From(ModuleLoaderBase* aLoader) {
    return static_cast<ModuleLoader*>(aLoader);
  }

  void AsyncExecuteInlineModule(ModuleLoadRequest* aRequest);
  void ExecuteInlineModule(ModuleLoadRequest* aRequest);

 private:
  nsresult CompileJavaScriptModule(JSContext* aCx, JS::CompileOptions& aOptions,
                                   ModuleLoadRequest* aRequest,
                                   JS::MutableHandle<JSObject*> aModuleOut);
  nsresult CompileJsonModule(JSContext* aCx, JS::CompileOptions& aOptions,
                             ModuleLoadRequest* aRequest,
                             JS::MutableHandle<JSObject*> aModuleOut);

 private:
  const Kind mKind;
};

}  // namespace mozilla::dom

#endif  // mozilla_dom_ModuleLoader_h
