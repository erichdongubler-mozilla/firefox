/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * vim: set ts=8 sts=2 et sw=2 tw=80:
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "builtin/intl/ListFormat.h"

#include "mozilla/Assertions.h"
#include "mozilla/intl/ListFormat.h"

#include <stddef.h>

#include "builtin/Array.h"
#include "builtin/intl/CommonFunctions.h"
#include "builtin/intl/FormatBuffer.h"
#include "builtin/intl/LocaleNegotiation.h"
#include "builtin/intl/ParameterNegotiation.h"
#include "builtin/intl/UsingEnum.h"
#include "gc/GCContext.h"
#include "js/Utility.h"
#include "js/Vector.h"
#include "vm/JSContext.h"
#include "vm/PlainObject.h"
#include "vm/StringType.h"

#include "vm/JSObject-inl.h"
#include "vm/NativeObject-inl.h"
#include "vm/ObjectOperations-inl.h"

using namespace js;
using namespace js::intl;

const JSClassOps ListFormatObject::classOps_ = {
    nullptr,                     // addProperty
    nullptr,                     // delProperty
    nullptr,                     // enumerate
    nullptr,                     // newEnumerate
    nullptr,                     // resolve
    nullptr,                     // mayResolve
    ListFormatObject::finalize,  // finalize
    nullptr,                     // call
    nullptr,                     // construct
    nullptr,                     // trace
};
const JSClass ListFormatObject::class_ = {
    "Intl.ListFormat",
    JSCLASS_HAS_RESERVED_SLOTS(ListFormatObject::SLOT_COUNT) |
        JSCLASS_HAS_CACHED_PROTO(JSProto_ListFormat) |
        JSCLASS_BACKGROUND_FINALIZE,
    &ListFormatObject::classOps_,
    &ListFormatObject::classSpec_,
};

const JSClass& ListFormatObject::protoClass_ = PlainObject::class_;

static bool listFormat_supportedLocalesOf(JSContext* cx, unsigned argc,
                                          Value* vp);

static bool listFormat_resolvedOptions(JSContext* cx, unsigned argc, Value* vp);

static bool listFormat_toSource(JSContext* cx, unsigned argc, Value* vp) {
  CallArgs args = CallArgsFromVp(argc, vp);
  args.rval().setString(cx->names().ListFormat);
  return true;
}

static const JSFunctionSpec listFormat_static_methods[] = {
    JS_FN("supportedLocalesOf", listFormat_supportedLocalesOf, 1, 0),
    JS_FS_END,
};

static const JSFunctionSpec listFormat_methods[] = {
    JS_FN("resolvedOptions", listFormat_resolvedOptions, 0, 0),
    JS_SELF_HOSTED_FN("format", "Intl_ListFormat_format", 1, 0),
    JS_SELF_HOSTED_FN("formatToParts", "Intl_ListFormat_formatToParts", 1, 0),
    JS_FN("toSource", listFormat_toSource, 0, 0),
    JS_FS_END,
};

static const JSPropertySpec listFormat_properties[] = {
    JS_STRING_SYM_PS(toStringTag, "Intl.ListFormat", JSPROP_READONLY),
    JS_PS_END,
};

static bool ListFormat(JSContext* cx, unsigned argc, Value* vp);

const ClassSpec ListFormatObject::classSpec_ = {
    GenericCreateConstructor<ListFormat, 0, gc::AllocKind::FUNCTION>,
    GenericCreatePrototype<ListFormatObject>,
    listFormat_static_methods,
    nullptr,
    listFormat_methods,
    listFormat_properties,
    nullptr,
    ClassSpec::DontDefineConstructor,
};

static constexpr std::string_view TypeToString(ListFormatOptions::Type type) {
#ifndef USING_ENUM
  using enum ListFormatOptions::Type;
#else
  USING_ENUM(ListFormatOptions::Type, Conjunction, Disjunction, Unit);
#endif
  switch (type) {
    case Conjunction:
      return "conjunction";
    case Disjunction:
      return "disjunction";
    case Unit:
      return "unit";
  }
  MOZ_CRASH("invalid list format type");
}

static constexpr std::string_view StyleToString(
    ListFormatOptions::Style style) {
#ifndef USING_ENUM
  using enum ListFormatOptions::Style;
#else
  USING_ENUM(ListFormatOptions::Style, Long, Short, Narrow);
#endif
  switch (style) {
    case Long:
      return "long";
    case Short:
      return "short";
    case Narrow:
      return "narrow";
  }
  MOZ_CRASH("invalid list format style");
}

/**
 * Intl.ListFormat([ locales [, options]])
 */
static bool ListFormat(JSContext* cx, unsigned argc, Value* vp) {
  CallArgs args = CallArgsFromVp(argc, vp);

  // Step 1.
  if (!ThrowIfNotConstructing(cx, args, "Intl.ListFormat")) {
    return false;
  }

  // Step 2 (Inlined 9.1.14, OrdinaryCreateFromConstructor).
  Rooted<JSObject*> proto(cx);
  if (!GetPrototypeFromBuiltinConstructor(cx, args, JSProto_ListFormat,
                                          &proto)) {
    return false;
  }

  Rooted<ListFormatObject*> listFormat(
      cx, NewObjectWithClassProto<ListFormatObject>(cx, proto));
  if (!listFormat) {
    return false;
  }

  // Step 3. (Inlined ResolveOptions)

  // ResolveOptions, step 1.
  Rooted<LocalesList> requestedLocales(cx, cx);
  if (!CanonicalizeLocaleList(cx, args.get(0), &requestedLocales)) {
    return false;
  }

  Rooted<ArrayObject*> requestedLocalesArray(
      cx, LocalesListToArray(cx, requestedLocales));
  if (!requestedLocalesArray) {
    return false;
  }
  listFormat->setRequestedLocales(requestedLocalesArray);

  auto lfOptions = cx->make_unique<ListFormatOptions>();
  if (!lfOptions) {
    return false;
  }

  if (args.hasDefined(1)) {
    // ResolveOptions, steps 2-3.
    Rooted<JSObject*> options(
        cx, RequireObjectArg(cx, "options", "Intl.ListFormat", args[1]));
    if (!options) {
      return false;
    }

    // ResolveOptions, step 4.
    LocaleMatcher matcher;
    if (!GetLocaleMatcherOption(cx, options, &matcher)) {
      return false;
    }

    // ResolveOptions, step 5.
    //
    // This implementation only supports the "lookup" locale matcher, therefore
    // the "localeMatcher" option doesn't need to be stored.

    // ResolveOptions, step 6.
    //
    // Intl.ListFormat doesn't support any Unicode extension keys.

    // ResolveOptions, step 7. (Not applicable)

    // ResolveOptions, step 8. (Performed in ResolveLocale)

    // ResolveOptions, step 9. (Return)

    // Step 4. (Not applicable when ResolveOptions is inlined.)

    // Steps 5-6. (Performed in ResolveLocale)

    // Steps 7-8.
    static constexpr auto types = MapOptions<TypeToString>(
        ListFormatOptions::Type::Conjunction,
        ListFormatOptions::Type::Disjunction, ListFormatOptions::Type::Unit);
    if (!GetStringOption(cx, options, cx->names().type, types,
                         ListFormatOptions::Type::Conjunction,
                         &lfOptions->type)) {
      return false;
    }

    // Steps 9-10.
    static constexpr auto styles = MapOptions<StyleToString>(
        ListFormatOptions::Style::Long, ListFormatOptions::Style::Short,
        ListFormatOptions::Style::Narrow);
    if (!GetStringOption(cx, options, cx->names().style, styles,
                         ListFormatOptions::Style::Long, &lfOptions->style)) {
      return false;
    }
  }
  listFormat->setOptions(lfOptions.release());
  AddCellMemory(listFormat, sizeof(ListFormatOptions), MemoryUse::IntlOptions);

  // Steps 11-13. (Not applicable in our implementation.)

  // Step 14.
  args.rval().setObject(*listFormat);
  return true;
}

void js::ListFormatObject::finalize(JS::GCContext* gcx, JSObject* obj) {
  auto* listFormat = &obj->as<ListFormatObject>();

  if (auto* options = listFormat->getOptions()) {
    gcx->delete_(obj, options, MemoryUse::IntlOptions);
  }

  if (auto* lf = listFormat->getListFormatSlot()) {
    RemoveICUCellMemory(gcx, obj, ListFormatObject::EstimatedMemoryUse);
    delete lf;
  }
}

/**
 * Resolve the actual locale to finish initialization of the ListFormat.
 */
static bool ResolveLocale(JSContext* cx, Handle<ListFormatObject*> listFormat) {
  // Return if the locale was already resolved.
  if (listFormat->isLocaleResolved()) {
    return true;
  }

  Rooted<ArrayObject*> requestedLocales(
      cx, &listFormat->getRequestedLocales()->as<ArrayObject>());

  // %Intl.ListFormat%.[[RelevantExtensionKeys]] is « ».
  mozilla::EnumSet<UnicodeExtensionKey> relevantExtensionKeys{};

  // Initialize locale options from constructor arguments.
  Rooted<LocaleOptions> localeOptions(cx);

  // Use the default locale data.
  auto localeData = LocaleData::Default;

  // Resolve the actual locale.
  Rooted<ResolvedLocale> resolved(cx);
  if (!ResolveLocale(cx, AvailableLocaleKind::ListFormat, requestedLocales,
                     localeOptions, relevantExtensionKeys, localeData,
                     &resolved)) {
    return false;
  }

  // Finish initialization by setting the actual locale.
  auto* locale = resolved.toLocale(cx);
  if (!locale) {
    return false;
  }
  listFormat->setLocale(locale);

  MOZ_ASSERT(listFormat->isLocaleResolved(), "locale successfully resolved");
  return true;
}

static auto ToListFormatType(ListFormatOptions::Type type) {
#ifndef USING_ENUM
  using enum mozilla::intl::ListFormat::Type;
#else
  USING_ENUM(mozilla::intl::ListFormat::Type, Conjunction, Disjunction, Unit);
#endif
  switch (type) {
    case ListFormatOptions::Type::Conjunction:
      return Conjunction;
    case ListFormatOptions::Type::Disjunction:
      return Disjunction;
    case ListFormatOptions::Type::Unit:
      return Unit;
  }
  MOZ_CRASH("invalid list format type");
}

static auto ToListFormatStyle(ListFormatOptions::Style style) {
#ifndef USING_ENUM
  using enum mozilla::intl::ListFormat::Style;
#else
  USING_ENUM(mozilla::intl::ListFormat::Style, Long, Short, Narrow);
#endif
  switch (style) {
    case ListFormatOptions::Style::Long:
      return Long;
    case ListFormatOptions::Style::Short:
      return Short;
    case ListFormatOptions::Style::Narrow:
      return Narrow;
  }
  MOZ_CRASH("invalid list format style");
}

/**
 * Returns a new ListFormat with the locale and list formatting options
 * of the given ListFormat object.
 */
static mozilla::intl::ListFormat* NewListFormat(
    JSContext* cx, Handle<ListFormatObject*> listFormat) {
  if (!ResolveLocale(cx, listFormat)) {
    return nullptr;
  }
  auto lfOptions = *listFormat->getOptions();

  auto locale = EncodeLocale(cx, listFormat->getLocale());
  if (!locale) {
    return nullptr;
  }

  mozilla::intl::ListFormat::Options options = {
      .mType = ToListFormatType(lfOptions.type),
      .mStyle = ToListFormatStyle(lfOptions.style),
  };

  auto result = mozilla::intl::ListFormat::TryCreate(
      mozilla::MakeStringSpan(locale.get()), options);
  if (result.isErr()) {
    ReportInternalError(cx, result.unwrapErr());
    return nullptr;
  }
  return result.unwrap().release();
}

static mozilla::intl::ListFormat* GetOrCreateListFormat(
    JSContext* cx, Handle<ListFormatObject*> listFormat) {
  // Obtain a cached mozilla::intl::ListFormat object.
  if (auto* lf = listFormat->getListFormatSlot()) {
    return lf;
  }

  auto* lf = NewListFormat(cx, listFormat);
  if (!lf) {
    return nullptr;
  }
  listFormat->setListFormatSlot(lf);

  AddICUCellMemory(listFormat, ListFormatObject::EstimatedMemoryUse);
  return lf;
}

/**
 * FormatList ( listFormat, list )
 */
static bool FormatList(JSContext* cx, mozilla::intl::ListFormat* lf,
                       const mozilla::intl::ListFormat::StringList& list,
                       MutableHandleValue result) {
  intl::FormatBuffer<char16_t, intl::INITIAL_CHAR_BUFFER_SIZE> formatBuffer(cx);
  auto formatResult = lf->Format(list, formatBuffer);
  if (formatResult.isErr()) {
    js::intl::ReportInternalError(cx, formatResult.unwrapErr());
    return false;
  }

  JSString* str = formatBuffer.toString(cx);
  if (!str) {
    return false;
  }
  result.setString(str);
  return true;
}

/**
 * FormatListToParts ( listFormat, list )
 */
static bool FormatListToParts(JSContext* cx, mozilla::intl::ListFormat* lf,
                              const mozilla::intl::ListFormat::StringList& list,
                              MutableHandleValue result) {
  intl::FormatBuffer<char16_t, intl::INITIAL_CHAR_BUFFER_SIZE> buffer(cx);
  mozilla::intl::ListFormat::PartVector parts;
  auto formatResult = lf->FormatToParts(list, buffer, parts);
  if (formatResult.isErr()) {
    intl::ReportInternalError(cx, formatResult.unwrapErr());
    return false;
  }

  RootedString overallResult(cx, buffer.toString(cx));
  if (!overallResult) {
    return false;
  }

  Rooted<ArrayObject*> partsArray(
      cx, NewDenseFullyAllocatedArray(cx, parts.length()));
  if (!partsArray) {
    return false;
  }
  partsArray->ensureDenseInitializedLength(0, parts.length());

  RootedObject singlePart(cx);
  RootedValue val(cx);

  size_t index = 0;
  size_t beginIndex = 0;
  for (const mozilla::intl::ListFormat::Part& part : parts) {
    singlePart = NewPlainObject(cx);
    if (!singlePart) {
      return false;
    }

    if (part.first == mozilla::intl::ListFormat::PartType::Element) {
      val = StringValue(cx->names().element);
    } else {
      val = StringValue(cx->names().literal);
    }

    if (!DefineDataProperty(cx, singlePart, cx->names().type, val)) {
      return false;
    }

    // There could be an empty string so the endIndex coule be equal to
    // beginIndex.
    MOZ_ASSERT(part.second >= beginIndex);
    JSLinearString* partStr = NewDependentString(cx, overallResult, beginIndex,
                                                 part.second - beginIndex);
    if (!partStr) {
      return false;
    }
    val = StringValue(partStr);
    if (!DefineDataProperty(cx, singlePart, cx->names().value, val)) {
      return false;
    }

    beginIndex = part.second;
    partsArray->initDenseElement(index++, ObjectValue(*singlePart));
  }

  MOZ_ASSERT(index == parts.length());
  MOZ_ASSERT(beginIndex == buffer.length());
  result.setObject(*partsArray);

  return true;
}

bool js::intl_FormatList(JSContext* cx, unsigned argc, Value* vp) {
  CallArgs args = CallArgsFromVp(argc, vp);
  MOZ_ASSERT(args.length() == 3);

  Rooted<ListFormatObject*> listFormat(
      cx, &args[0].toObject().as<ListFormatObject>());

  bool formatToParts = args[2].toBoolean();

  mozilla::intl::ListFormat* lf = GetOrCreateListFormat(cx, listFormat);
  if (!lf) {
    return false;
  }

  // Collect all strings and their lengths.
  //
  // 'strings' takes the ownership of those strings, and 'list' will be passed
  // to mozilla::intl::ListFormat as a Span.
  Vector<UniqueTwoByteChars, mozilla::intl::DEFAULT_LIST_LENGTH> strings(cx);
  mozilla::intl::ListFormat::StringList list;

  Rooted<ArrayObject*> listObj(cx, &args[1].toObject().as<ArrayObject>());
  RootedValue value(cx);
  uint32_t listLen = listObj->length();
  for (uint32_t i = 0; i < listLen; i++) {
    if (!GetElement(cx, listObj, listObj, i, &value)) {
      return false;
    }

    JSLinearString* linear = value.toString()->ensureLinear(cx);
    if (!linear) {
      return false;
    }

    size_t linearLength = linear->length();

    UniqueTwoByteChars chars = cx->make_pod_array<char16_t>(linearLength);
    if (!chars) {
      return false;
    }
    CopyChars(chars.get(), *linear);

    if (!strings.append(std::move(chars))) {
      return false;
    }

    if (!list.emplaceBack(strings[i].get(), linearLength)) {
      return false;
    }
  }

  if (formatToParts) {
    return FormatListToParts(cx, lf, list, args.rval());
  }
  return FormatList(cx, lf, list, args.rval());
}

static bool IsListFormat(Handle<JS::Value> v) {
  return v.isObject() && v.toObject().is<ListFormatObject>();
}

/**
 * Intl.ListFormat.prototype.resolvedOptions ( )
 */
static bool listFormat_resolvedOptions(JSContext* cx, const CallArgs& args) {
  Rooted<ListFormatObject*> listFormat(
      cx, &args.thisv().toObject().as<ListFormatObject>());

  if (!ResolveLocale(cx, listFormat)) {
    return false;
  }
  auto lfOptions = *listFormat->getOptions();

  // Step 3.
  Rooted<IdValueVector> options(cx, cx);

  // Step 4.
  if (!options.emplaceBack(NameToId(cx->names().locale),
                           StringValue(listFormat->getLocale()))) {
    return false;
  }

  auto* type = NewStringCopy<CanGC>(cx, TypeToString(lfOptions.type));
  if (!type) {
    return false;
  }
  if (!options.emplaceBack(NameToId(cx->names().type), StringValue(type))) {
    return false;
  }

  auto* style = NewStringCopy<CanGC>(cx, StyleToString(lfOptions.style));
  if (!style) {
    return false;
  }
  if (!options.emplaceBack(NameToId(cx->names().style), StringValue(style))) {
    return false;
  }

  // Step 5.
  auto* result = NewPlainObjectWithUniqueNames(cx, options);
  if (!result) {
    return false;
  }
  args.rval().setObject(*result);
  return true;
}

/**
 * Intl.ListFormat.prototype.resolvedOptions ( )
 */
static bool listFormat_resolvedOptions(JSContext* cx, unsigned argc,
                                       Value* vp) {
  // Steps 1-2.
  CallArgs args = CallArgsFromVp(argc, vp);
  return CallNonGenericMethod<IsListFormat, listFormat_resolvedOptions>(cx,
                                                                        args);
}

/**
 * Intl.ListFormat.supportedLocalesOf ( locales [ , options ] )
 */
static bool listFormat_supportedLocalesOf(JSContext* cx, unsigned argc,
                                          Value* vp) {
  CallArgs args = CallArgsFromVp(argc, vp);

  // Steps 1-3.
  auto* array = SupportedLocalesOf(cx, AvailableLocaleKind::ListFormat,
                                   args.get(0), args.get(1));
  if (!array) {
    return false;
  }
  args.rval().setObject(*array);
  return true;
}
