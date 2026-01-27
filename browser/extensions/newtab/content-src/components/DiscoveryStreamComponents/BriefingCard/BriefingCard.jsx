/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { SafeAnchor } from "../SafeAnchor/SafeAnchor";
import { LinkMenuOptions } from "content-src/lib/link-menu-options.mjs";

const TIMESTAMP_DISPLAY_DURATION = 15 * 60 * 1000;

/**
 * The BriefingCard component displays "In The Know" headlines.
 * It is the first card in the "Your Briefing" section.
 */
const BriefingCard = ({
  sectionClassNames = "",
  headlines = [],
  lastUpdated,
}) => {
  const [showTimestamp, setShowTimestamp] = useState(false);
  const [timeAgo, setTimeAgo] = useState("");
  const [isDismissed, setIsDismissed] = useState(false);

  const dispatch = useDispatch();

  const handleDismiss = () => {
    setIsDismissed(true);

    const menuOption = LinkMenuOptions.BlockUrls(
      headlines,
      0,
      "DAILY_BRIEFING"
    );

    dispatch(menuOption.action);
  };

  useEffect(() => {
    if (!lastUpdated) {
      setShowTimestamp(false);
      return undefined;
    }

    const updateTimestamp = () => {
      const now = Date.now();
      const timeSinceUpdate = now - lastUpdated;

      // Only show a timestamp for the first 15 minutes after feed refresh.
      // This avoids showing an outdated timestamp for a cached version of the feed.
      if (now - lastUpdated < TIMESTAMP_DISPLAY_DURATION) {
        setShowTimestamp(true);

        const minutes = Math.ceil(timeSinceUpdate / 60000);
        setTimeAgo(minutes);
      } else {
        setShowTimestamp(false);
      }
    };

    updateTimestamp();

    const interval = setInterval(updateTimestamp, 60000);

    return () => clearInterval(interval);
  }, [lastUpdated]);

  if (isDismissed || headlines.length === 0) {
    return null;
  }

  return (
    <div className={`briefing-card ${sectionClassNames}`}>
      <moz-button
        className="briefing-card-context-menu-button"
        iconSrc="chrome://global/skin/icons/more.svg"
        menuId="briefing-card-menu"
        type="ghost"
      />
      <panel-list id="briefing-card-menu">
        <panel-item
          data-l10n-id="newtab-daily-briefing-card-menu-dismiss"
          onClick={handleDismiss}
        ></panel-item>
      </panel-list>
      <div className="briefing-card-header">
        <h3
          className="briefing-card-title"
          data-l10n-id="newtab-daily-briefing-card-title"
        ></h3>
        {showTimestamp && (
          <span
            className="briefing-card-timestamp"
            data-l10n-id="newtab-daily-briefing-card-timestamp"
            data-l10n-args={JSON.stringify({ minutes: timeAgo })}
          ></span>
        )}
      </div>
      <hr />
      <ol className="briefing-card-headlines">
        {headlines.map(headline => (
          <li key={headline.id} className="briefing-card-headline">
            <SafeAnchor
              url={headline.url}
              dispatch={dispatch}
              className="briefing-card-headline-link"
              title={headline.title}
            >
              <div className="briefing-card-headline-title">
                {headline.title}
              </div>
              <div className="briefing-card-headline-footer">
                {headline.icon_src && (
                  <img
                    src={headline.icon_src}
                    alt=""
                    className="briefing-card-headline-icon"
                  />
                )}
                <span className="briefing-card-headline-source">
                  {headline.publisher}
                </span>
              </div>
            </SafeAnchor>
          </li>
        ))}
      </ol>
    </div>
  );
};

export { BriefingCard };
