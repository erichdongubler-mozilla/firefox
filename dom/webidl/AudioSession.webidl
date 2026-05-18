/* -*- Mode: IDL; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * The origin of this IDL file is
 * https://w3c.github.io/audio-session/
 */

[Exposed=Window, Pref="dom.audio_session.enabled"]
interface AudioSession : EventTarget {
  attribute AudioSessionType type;

  readonly attribute AudioSessionState state;
  attribute EventHandler onstatechange;
};

enum AudioSessionType {
  "auto",
  "playback",
  "transient",
  "transient-solo",
  "ambient",
  "play-and-record"
};

enum AudioSessionState {
  "inactive",
  "active",
  "interrupted"
};
