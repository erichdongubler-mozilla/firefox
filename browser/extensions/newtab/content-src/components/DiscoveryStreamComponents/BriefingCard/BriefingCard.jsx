/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import React from "react";
import { useSelector, useDispatch } from "react-redux";
import { SafeAnchor } from "../SafeAnchor/SafeAnchor";

/**
 * The BriefingCard component displays "In The Know" headlines.
 * It is the first card in the "Your Briefing" section.
 */
const BriefingCard = () => {
  const dispatch = useDispatch();
  const sections = useSelector(state => state.DiscoveryStream.feeds.data);
  const prefs = useSelector(state => state.Prefs.values);

  const dailyBriefSectionId =
    prefs?.trainhopConfig?.dailyBriefing?.sectionId ||
    prefs?.["discoverystream.dailyBrief.sectionId"];

  const [firstSectionKey] = Object.keys(sections);
  const { data: sectionData } = sections[firstSectionKey];

  const headlines = sectionData.recommendations
    .filter(rec => rec.section === dailyBriefSectionId)
    .slice(0, 3);

  return (
    <div className="briefing-card">
      <div className="briefing-card-header">
        <h3 className="briefing-card-title">In the Know</h3>
      </div>
      <hr />
      <ol className="briefing-card-headlines">
        {headlines.map((headline, index) => (
          <li key={index} className="briefing-card-headline">
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
