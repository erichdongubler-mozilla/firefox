/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/ComputedStyle.h"
#include "mozilla/ComputedStyleInlines.h"
#include "mozilla/StaticPrefs_layout.h"
#include "mozilla/StyleColorInlines.h"
#include "mozilla/dom/BindingDeclarations.h"
#include "nsIFrame.h"
#include "nsStyleStruct.h"

namespace mozilla {

template <>
bool StyleColor::MaybeTransparent() const {
  // We know that the color is opaque when it's a numeric color with
  // alpha == 1.0.
  return !IsAbsolute() || AsAbsolute().alpha != 1.0f;
}

template <>
StyleAbsoluteColor StyleColor::ResolveColor(
    const StyleAbsoluteColor& aForegroundColor) const {
  if (IsAbsolute()) {
    return AsAbsolute();
  }

  if (IsCurrentColor()) {
    return aForegroundColor;
  }

  return Servo_ResolveColor(this, &aForegroundColor);
}

template <>
nscolor StyleColor::CalcColor(nscolor aColor) const {
  return ResolveColor(StyleAbsoluteColor::FromColor(aColor)).ToColor();
}

template <>
nscolor StyleColor::CalcColor(
    const StyleAbsoluteColor& aForegroundColor) const {
  return ResolveColor(aForegroundColor).ToColor();
}

template <>
nscolor StyleColor::CalcColor(const ComputedStyle& aStyle) const {
  return ResolveColor(aStyle.StyleText()->mColor).ToColor();
}

template <>
nscolor StyleColor::CalcColor(const nsIFrame* aFrame) const {
  return ResolveColor(aFrame->StyleText()->mColor).ToColor();
}

StyleAbsoluteColor StyleAbsoluteColor::ToColorSpace(
    StyleColorSpace aColorSpace) const {
  return Servo_ConvertColorSpace(this, aColorSpace);
}

nscolor StyleAbsoluteColor::ToColor() const {
  constexpr StyleColorSpace DEST_COLOR_SPACE = StyleColorSpace::Srgb;

  constexpr float MIN = 0.0f;
  constexpr float MAX = 1.0f;

  auto translatedColor = ToColorSpace(DEST_COLOR_SPACE);

  // We KNOW the values are in srgb so we can do a quick gamut limit check
  // here and avoid calling into Servo_GamutMapColorUsing* and let it
  // return early anyway.
  auto isColorInGamut = translatedColor.components._0 >= MIN &&
                        translatedColor.components._0 <= MAX &&
                        translatedColor.components._1 >= MIN &&
                        translatedColor.components._1 <= MAX &&
                        translatedColor.components._2 >= MIN &&
                        translatedColor.components._2 <= MAX;

  if (!isColorInGamut) {
    switch (StaticPrefs::layout_css_gamut_mapping_method()) {
      case 1:
        translatedColor =
            Servo_GamutMapColorUsingBinarySearchMINDE(this, DEST_COLOR_SPACE);
        break;
      case 2:
        translatedColor =
            Servo_GamutMapColorUsingRaytrace(this, DEST_COLOR_SPACE);
        break;
      default:
        // 0 (default), or any other value
        // If gamut mapping is not enabled, we just naively clip the colors at
        // sRGB gamut limits. This will go away completely when gamut mapping is
        // enabled.
        translatedColor.components._0 =
            std::clamp(translatedColor.components._0, MIN, MAX);
        translatedColor.components._1 =
            std::clamp(translatedColor.components._1, MIN, MAX);
        translatedColor.components._2 =
            std::clamp(translatedColor.components._2, MIN, MAX);
    }
  }

  return NS_RGBA(
      nsStyleUtil::FloatToColorComponent(translatedColor.components._0),
      nsStyleUtil::FloatToColorComponent(translatedColor.components._1),
      nsStyleUtil::FloatToColorComponent(translatedColor.components._2),
      nsStyleUtil::FloatToColorComponent(translatedColor.alpha));
}

}  // namespace mozilla
