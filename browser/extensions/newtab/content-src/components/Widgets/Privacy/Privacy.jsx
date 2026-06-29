/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// eslint-disable-next-line no-unused-vars
import React, { useCallback, useRef, useState } from "react";
import { useSelector, batch } from "react-redux";
import { actionCreators as ac, actionTypes as at } from "common/Actions.mjs";
import { useIntersectionObserver, useSizeSubmenu } from "../../../lib/utils";
import { WIDGET_REGISTRY, resolveWidgetSize } from "common/WidgetsRegistry.mjs";
import { MoveSubmenu } from "../MoveSubmenu";

const USER_ACTION_TYPES = {
  CHANGE_SIZE: "change_size",
};

const PRIVACY_ENTRY = WIDGET_REGISTRY.find(w => w.id === "privacy");

const ICON_BASE_URL = "chrome://newtab/content/data/content/assets/";

// Renders a widget icon by asset filename. The wrapper div is the alignment
// hook. TEMP (Bug 2049390): callers pass a static filename for now; the
// per-message icon mapping (shield/planet/star/bolt/kit) is a follow-up commit.
const privacyImage = filename => (
  <div className="privacy-image">
    <img
      className="privacy-image-icon"
      src={`${ICON_BASE_URL}${filename}`}
      alt=""
    />
  </div>
);

function Privacy({ dispatch, widgetsMayBeMaximized, widgetEnabledMap }) {
  const prefs = useSelector(state => state.Prefs.values);
  const privacyData = useSelector(state => state.PrivacyWidget);

  // Size comes from the registry helper: user-set pref > trainhop suggestion
  // > registry defaultSize. Never read the size pref directly.
  const widgetSize = resolveWidgetSize(PRIVACY_ENTRY, prefs);
  const impressionFired = useRef(false);

  const trackersToday = privacyData?.trackersToday ?? 0;
  const sitesToday = privacyData?.sitesToday ?? 0;
  // Gate the metric UI on a real feed update. Before the first broadcast — or
  // when it's skipped (e.g. the backward-compat guard in PrivacyFeed on older
  // platforms) — show no metric state rather than a misleading empty/zero one.
  const initialized = privacyData?.initialized ?? false;
  // Ceiling the readout at "100+" so the number stays a tidy single line.
  const displayCount = trackersToday > 100 ? "100+" : `${trackersToday}`;

  // TEMP (Bug 2049390): preview override for CSS work. "live" follows the real
  // count (0 => empty, otherwise the tip card); the others force a state.
  // Remove with the tip-rotation / site-count wiring (Bug 2048387).
  const [preview, setPreview] = useState("live");
  const liveState = trackersToday === 0 ? "empty" : "tip";
  const effectiveState = preview === "live" ? liveState : preview;
  const isEmptyState = effectiveState === "empty";
  const showTip = effectiveState === "tip";
  const isLarge = widgetSize === "large";

  const handleIntersection = useCallback(() => {
    if (impressionFired.current) {
      return;
    }
    impressionFired.current = true;
    dispatch(
      ac.AlsoToMain({
        type: at.WIDGETS_IMPRESSION,
        data: {
          widget_name: "privacy",
          widget_size: widgetSize,
        },
      })
    );
  }, [dispatch, widgetSize]);

  const widgetRef = useIntersectionObserver(handleIntersection);

  function handlePrivacyHide() {
    batch(() => {
      dispatch(
        ac.OnlyToMain({
          type: at.SET_PREF,
          data: { name: PRIVACY_ENTRY.enabledPref, value: false },
        })
      );
      dispatch(
        ac.OnlyToMain({
          type: at.WIDGETS_ENABLED,
          data: {
            widget_name: "privacy",
            widget_source: "context_menu",
            enabled: false,
            widget_size: widgetSize,
          },
        })
      );
    });
  }

  const handleChangeSize = useCallback(
    size => {
      batch(() => {
        dispatch(
          ac.OnlyToMain({
            type: at.SET_PREF,
            data: { name: PRIVACY_ENTRY.sizePref, value: size },
          })
        );
        dispatch(
          ac.OnlyToMain({
            type: at.WIDGETS_USER_EVENT,
            data: {
              widget_name: "privacy",
              widget_source: "context_menu",
              user_action: USER_ACTION_TYPES.CHANGE_SIZE,
              action_value: size,
              widget_size: size,
            },
          })
        );
      });
    },
    [dispatch]
  );

  const sizeSubmenuRef = useSizeSubmenu(handleChangeSize);

  function handleLearnMore() {
    batch(() => {
      dispatch(
        ac.OnlyToMain({
          type: at.OPEN_LINK,
          data: {
            url: "https://support.mozilla.org/kb/firefox-new-tab-widgets",
          },
        })
      );
      dispatch(
        ac.OnlyToMain({
          type: at.WIDGETS_USER_EVENT,
          data: {
            widget_name: "privacy",
            widget_source: "context_menu",
            user_action: "learn_more",
            widget_size: widgetSize,
          },
        })
      );
    });
  }

  return (
    <article
      className={`privacy widget col-4 ${widgetSize}-widget${
        initialized && isEmptyState ? " is-empty" : ""
      }${initialized && showTip ? " has-tip-msg" : ""}`}
      ref={el => {
        widgetRef.current = [el];
      }}
    >
      <div className="privacy-title-wrapper">
        <div className="privacy-context-menu-wrapper">
          <moz-button
            className="privacy-context-menu-button"
            iconSrc="chrome://global/skin/icons/more.svg"
            menuId="privacy-context-menu"
            type="ghost"
          />
          <panel-list id="privacy-context-menu">
            {widgetsMayBeMaximized && (
              <panel-item submenu="privacy-size-submenu">
                <span data-l10n-id="newtab-widget-menu-change-size"></span>
                <panel-list
                  ref={sizeSubmenuRef}
                  slot="submenu"
                  id="privacy-size-submenu"
                >
                  {["medium", "large"].map(size => (
                    <panel-item
                      key={size}
                      type="checkbox"
                      checked={widgetSize === size || undefined}
                      data-size={size}
                      data-l10n-id={`newtab-widget-size-${size}`}
                    />
                  ))}
                </panel-list>
              </panel-item>
            )}

            <MoveSubmenu
              widgetId="privacy"
              widgetEnabledMap={widgetEnabledMap}
            />

            <panel-item
              data-l10n-id="newtab-widget-menu-hide"
              onClick={handlePrivacyHide}
            />
            <panel-item
              data-l10n-id="newtab-privacy-menu-learn-more"
              onClick={handleLearnMore}
            />

            {/* TEMP (Bug 2049390): static-state preview switcher. No FTL.
                Remove with the tip-rotation / site-count wiring (Bug 2048387). */}
            <panel-item onClick={() => setPreview("live")}>
              Preview: Live (real count)
            </panel-item>
            <panel-item onClick={() => setPreview("empty")}>
              Preview: Empty
            </panel-item>
            <panel-item onClick={() => setPreview("default")}>
              Preview: Default (no tip)
            </panel-item>
            <panel-item onClick={() => setPreview("tip")}>
              Preview: Default (with tip)
            </panel-item>
          </panel-list>
        </div>
      </div>

      <div className="privacy-body">
        {initialized &&
          (isEmptyState ? (
            <div className="privacy-empty">
              {privacyImage("widget-privacy-shield.svg")}
              <p
                className="privacy-empty-message"
                data-l10n-id="newtab-privacy-empty"
              />
            </div>
          ) : (
            <>
              <div className="privacy-count">
                <div className="privacy-count-number-wrapper">
                  {/* Compact sizes (small, medium): icon beside the count.
                      Keyed off !isLarge so a future "small" needs no change. */}
                  {!isLarge && privacyImage("widget-privacy-shield-check.svg")}
                  <span className="privacy-count-number">{displayCount}</span>
                </div>

                <span
                  className="privacy-count-label"
                  data-l10n-id="newtab-privacy-trackers-blocked-today"
                  data-l10n-args={JSON.stringify({ count: trackersToday })}
                />
                <span
                  className="privacy-count-sites"
                  data-l10n-id="newtab-privacy-across-sites"
                  data-l10n-args={JSON.stringify({ count: sitesToday })}
                />
              </div>
              {showTip && (
                <>
                  <hr className="privacy-divider" />
                  <div className="privacy-tip">
                    {/* Large only: icon sits inside the tip. */}
                    {isLarge && privacyImage("widget-privacy-shield-check.svg")}
                    <p
                      className="privacy-tip-message"
                      data-l10n-id="newtab-privacy-message-informed-5"
                    />
                  </div>
                </>
              )}
            </>
          ))}
      </div>
    </article>
  );
}

export { Privacy };
